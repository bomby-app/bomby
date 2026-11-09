"""Hosted MCP extensions: a vendor's MCP server that puts the user's apps behind one sign-in,
like Zapier's or Composio's (docs/decisions/hosted-mcp-extensions-with-oauth.md).

The app's core signs the user in and keeps the grant; the call asks it for an access token
as it connects and whenever the one it has is about to expire or is turned away
(`tokens.py`). The server's tools come as one `MCPToolset`, loaded when the session starts,
beside `open_<id>_link`, which opens a sign-in link a tool handed back in the user's
browser, through the app (`<id>.open_link` over RPC, `bridge.py`).

The core includes one in a call only once it's connected, so a call that has it can always
ask for a token. When it can't get one anyway (the sign-in expired, the app didn't answer),
the request goes out without it and the server turns it away, which fails only that request;
the tool then raises the core's line ("Connect Zapier again in Settings.") for the model, and
the connection stays up for when a token comes back.

`TransportStreams` is the MCP SDK's private type for what `MCPServer.client_streams` yields;
LiveKit's own servers import it the same way (`livekit/agents/llm/mcp.py`).
"""

import logging
import time
from collections.abc import AsyncGenerator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from typing import ClassVar, final, override
from urllib.parse import urlsplit

import httpx2
from livekit.agents.llm import ToolError, Toolset, function_tool
from livekit.agents.llm.mcp import MCPServer, MCPTool, MCPToolOptions, MCPToolset
from mcp.client._transport import TransportStreams
from mcp.client.streamable_http import streamable_http_client

from voice_providers import Tools

from .extension import Extension, ExtensionContext, ExtensionError
from .tokens import Token, TokenError, Tokens

logger = logging.getLogger("bomby.extensions")

# A token this close to its expiry is swapped before a request rather than after a 401.
REFRESH_EARLY_S = 60
# Each MCP request's read timeout, tool calls included: a vendor's action can take a while.
REQUEST_TIMEOUT_S = 120
# The MCP SDK's own defaults (`mcp.shared._httpx_utils`): a server may hold a stream open.
HTTP_TIMEOUT = httpx2.Timeout(30.0, read=300.0)


@dataclass(frozen=True)
class Connect:
    """How the app connects a hosted MCP extension, for the catalogue
    (`catalogue.py`)."""

    mcp_url: str
    """The vendor's MCP server, over Streamable HTTP."""
    manage_url: str
    """Where the user manages what Bomby can reach on the vendor's side."""
    link_hosts: tuple[str, ...]
    """The hosts `open_<id>_link` may open, each with its subdomains."""


def allowed(url: str, hosts: tuple[str, ...]) -> bool:
    """Whether `url` is https on one of `hosts` or a subdomain of one."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(
        host == h or host.endswith("." + h) for h in hosts
    )


@final
class BearerAuth(httpx2.Auth):
    """Sends the extension's access token, asking the core for a newer one before it
    expires and once more when the server turns one away. It never raises: without a token
    the request goes out without one, and `failure` keeps the core's line for the tool that
    asked."""

    def __init__(self, tokens: Tokens, extension: str) -> None:
        self._tokens = tokens
        self._extension = extension
        self._token: Token | None = None
        self._expires_at: float | None = None
        self.failure: str | None = None
        """Why the last request had no token, until one comes again."""

    async def _fetch(self, stale: str | None) -> str | None:
        try:
            token = await self._tokens.get(self._extension, stale)
        except TokenError as e:
            self.failure = str(e)
            return None
        self.failure = None
        self._token = token
        self._expires_at = (
            time.monotonic() + token.expires_in
            if token.expires_in is not None
            else None
        )
        return token.token

    async def _current(self) -> str | None:
        if self._token is None:
            return await self._fetch(None)
        if (
            self._expires_at is not None
            and self._expires_at - time.monotonic() < REFRESH_EARLY_S
        ):
            return await self._fetch(self._token.token)
        return self._token.token

    @staticmethod
    def _authorize(request: httpx2.Request, token: str | None) -> None:
        if token is None:
            _ = request.headers.pop("Authorization", None)
        else:
            request.headers["Authorization"] = f"Bearer {token}"

    @override
    async def async_auth_flow(
        self, request: httpx2.Request
    ) -> AsyncGenerator[httpx2.Request, httpx2.Response]:
        sent = await self._current()
        self._authorize(request, sent)
        response = yield request
        if response.status_code == 401 and sent is not None:
            self._authorize(request, await self._fetch(sent))
            yield request


@final
class HostedMcpServer(MCPServer):
    """A vendor's MCP server over Streamable HTTP, with the core's tokens."""

    def __init__(self, url: str, auth: BearerAuth) -> None:
        super().__init__(client_session_timeout_seconds=REQUEST_TIMEOUT_S)
        self.url = url
        self._auth = auth

    @override
    async def list_tools(
        self, *, tool_options: dict[str, MCPToolOptions] | None = None
    ) -> list[MCPTool]:
        tools = await super().list_tools(tool_options=tool_options)
        return [self._explained(tool) for tool in tools]

    def _explained(self, tool: MCPTool) -> MCPTool:
        """`tool`, raising the core's line when its request went out without a token."""
        auth, info = self._auth, tool.info

        async def call(raw_arguments: dict[str, object]) -> object:
            try:
                return await tool(raw_arguments)
            except Exception as e:
                if auth.failure is not None:
                    raise ToolError(auth.failure) from e
                raise

        return function_tool(
            call,
            raw_schema=info.raw_schema,
            flags=info.flags,
            on_duplicate=info.on_duplicate,
            duplicate_scope=info.duplicate_scope,
        )

    @override
    def client_streams(self) -> AbstractAsyncContextManager[TransportStreams]:
        return self._streams()

    @asynccontextmanager
    async def _streams(self) -> AsyncGenerator[TransportStreams]:
        async with (
            httpx2.AsyncClient(auth=self._auth, timeout=HTTP_TIMEOUT) as client,
            streamable_http_client(self.url, http_client=client) as streams,
        ):
            yield streams

    @override
    def __repr__(self) -> str:
        return f"HostedMcpServer(url={self.url})"


class HostedMcp(Extension):
    """An extension whose tools are a vendor's hosted MCP server."""

    connect: ClassVar[Connect]
    default_on: ClassVar[bool] = False

    @property
    def link_tool(self) -> str:
        """The name of the tool that opens the vendor's links: `open_zapier_link`."""
        return f"open_{self.id}_link"

    @override
    def tools(self, context: ExtensionContext) -> Tools:
        if context.tokens is None:
            # Outside the app nothing can sign in; the core leaves it out of calls anyway.
            return []
        server = HostedMcpServer(
            self.connect.mcp_url, BearerAuth(context.tokens, self.id)
        )
        bridge, hosts, name, method = (
            context.bridge,
            self.connect.link_hosts,
            self.name,
            f"{self.id}.open_link",
        )

        async def open_link(url: str) -> str:
            if not allowed(url, hosts):
                raise ToolError(f"That isn't a {name} link, so it wasn't opened.")
            try:
                _ = await bridge.call(method, {"url": url})
            except ExtensionError as e:
                raise ToolError(str(e)) from e
            return "It's open in the user's browser."

        link_tool = function_tool(
            open_link,
            name=self.link_tool,
            description=(
                f"Open a link a {name} tool gave you in the user's browser, such as the "
                "page to sign in to an app. Invoke it instead of reading a link out, "
                "then tell the user to finish in their browser.\n\n"
                f"Args:\n    url: The link, exactly as the {name} tool gave it."
            ),
        )
        return [
            MCPToolset(id=f"{self.id}_mcp", mcp_server=server),
            Toolset(id=self.id, tools=[link_tool]),
        ]


__all__ = [
    "BearerAuth",
    "Connect",
    "HostedMcp",
    "HostedMcpServer",
    "TokenError",
    "allowed",
]

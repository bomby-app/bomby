"""Hosted MCP extensions: a vendor's MCP server that puts the user's apps behind one sign-in,
like Zapier's or Composio's (docs/decisions/hosted-mcp-extensions-with-oauth.md).

The app's core signs the user in and keeps the grant; the call asks it for an access token
as it connects and whenever the one it has is about to expire or is turned away
(`tokens.py`). The server's tools come as one `MCPToolset`, loaded when the session starts,
beside `open_<id>_link`, which opens a sign-in link a tool handed back in the user's
browser, through the app (`<id>.open_link` over RPC, `bridge.py`).

The core includes one in a call only once it's connected, so a call that has it can always
ask for a token.
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
from livekit.agents.llm.mcp import MCPServer, MCPToolset
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
    expires and once more when the server turns one away."""

    def __init__(self, tokens: Tokens, extension: str) -> None:
        self._tokens = tokens
        self._extension = extension
        self._token: Token | None = None
        self._expires_at: float | None = None

    async def _fetch(self, stale: str | None) -> str:
        token = await self._tokens.get(self._extension, stale)
        self._token = token
        self._expires_at = (
            time.monotonic() + token.expires_in
            if token.expires_in is not None
            else None
        )
        return token.token

    async def _current(self) -> str:
        if self._token is None:
            return await self._fetch(None)
        if (
            self._expires_at is not None
            and self._expires_at - time.monotonic() < REFRESH_EARLY_S
        ):
            return await self._fetch(self._token.token)
        return self._token.token

    @override
    async def async_auth_flow(
        self, request: httpx2.Request
    ) -> AsyncGenerator[httpx2.Request, httpx2.Response]:
        sent = await self._current()
        request.headers["Authorization"] = f"Bearer {sent}"
        response = yield request
        if response.status_code == 401:
            request.headers["Authorization"] = f"Bearer {await self._fetch(sent)}"
            yield request


@final
class HostedMcpServer(MCPServer):
    """A vendor's MCP server over Streamable HTTP, with the core's tokens."""

    def __init__(self, url: str, auth: httpx2.Auth) -> None:
        super().__init__(client_session_timeout_seconds=REQUEST_TIMEOUT_S)
        self.url = url
        self._auth = auth

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

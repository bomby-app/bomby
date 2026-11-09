import asyncio
import json
import os
import shutil
import socket
import tempfile
import threading
from collections.abc import Awaitable, Callable, Coroutine, Iterator, Mapping
from typing import cast, final

import httpx2
import pytest
import uvicorn
from livekit.agents.llm import FunctionTool, RawFunctionTool, ToolError, Toolset
from livekit.agents.llm.mcp import MCPToolset
from mcp.server.mcpserver import MCPServer as McpTestServer
from pydantic import JsonValue
from starlette.types import ASGIApp, Receive, Scope, Send

from acp_client.runner import APP_KEYS
from extensions import EXTENSIONS, CallExtensions, ExtensionContext
from extensions.catalogue import render
from extensions.composio import COMPOSIO_EXTENSION
from extensions.hosted_mcp import BearerAuth, HostedMcpServer, allowed
from extensions.tokens import SECRET_ENV, SOCKET_ENV, SocketTokens, Token, TokenError
from extensions.zapier import ZAPIER_EXTENSION
from sections import PLAIN


@final
class FakeTokens:
    """Hands out "t1", "t2", … : a newer token each time it's asked for one newer than the
    one it gave last."""

    def __init__(self, expires_in: float | None = 3600) -> None:
        self.issued = 0
        self.asks: list[tuple[str, str | None]] = []
        self.expires_in = expires_in
        self.refusal: str | None = None
        """While set, the core's line instead of a token."""

    async def get(self, extension: str, stale: str | None = None) -> Token:
        self.asks.append((extension, stale))
        if self.refusal is not None:
            raise TokenError(self.refusal)
        if self.issued == 0 or stale == f"t{self.issued}":
            self.issued += 1
        return Token(token=f"t{self.issued}", expires_in=self.expires_in)


@final
class NoBridge:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Mapping[str, JsonValue]]] = []

    async def call(self, method: str, payload: Mapping[str, JsonValue]) -> JsonValue:
        self.calls.append((method, payload))
        return {}


def test_hosted_extensions_are_off_until_the_user_connects_them() -> None:
    assert EXTENSIONS["zapier"] is ZAPIER_EXTENSION
    assert EXTENSIONS["composio"] is COMPOSIO_EXTENSION
    assert not ZAPIER_EXTENSION.default_on and not COMPOSIO_EXTENSION.default_on


def test_the_catalogue_tells_the_core_how_to_connect_them() -> None:
    by_id = {e["id"]: e for e in json.loads(render())["extensions"]}
    assert by_id["todos"]["connect"] is None
    assert by_id["zapier"]["connect"] == {
        "mcp_url": "https://mcp.zapier.com/api/v1/connect",
        "manage_url": "https://mcp.zapier.com",
        "link_hosts": ["zapier.com"],
    }
    assert by_id["composio"]["connect"]["mcp_url"] == "https://connect.composio.dev/mcp"


def test_links_open_only_on_the_vendors_hosts_over_https() -> None:
    hosts = ("composio.dev",)
    assert allowed("https://connect.composio.dev/link/lk_1", hosts)
    assert allowed("https://composio.dev/x", hosts)
    assert not allowed("http://connect.composio.dev/link", hosts)
    assert not allowed("https://composio.dev.evil.example/x", hosts)
    assert not allowed("https://evilcomposio.dev/x", hosts)
    assert not allowed("javascript:alert(1)", hosts)
    assert not allowed("https://[::1", hosts)


def test_the_note_names_the_link_tool_in_the_calls_style() -> None:
    note = ZAPIER_EXTENSION.note(ExtensionContext(bridge=NoBridge(), style=PLAIN))
    assert "open_zapier_link" in note and "`" not in note and "##" not in note
    assert "## Composio" in COMPOSIO_EXTENSION.note(ExtensionContext(bridge=NoBridge()))


def test_without_the_cores_tokens_there_are_no_tools() -> None:
    assert ZAPIER_EXTENSION.tools(ExtensionContext(bridge=NoBridge())) == []


def link_tool(bridge: NoBridge) -> Callable[..., Coroutine[object, object, str]]:
    context = ExtensionContext(bridge=bridge, tokens=FakeTokens())
    mcp, links = COMPOSIO_EXTENSION.tools(context)
    assert isinstance(mcp, MCPToolset) and isinstance(links, Toolset)
    [tool] = links.tools
    assert isinstance(tool, FunctionTool)
    assert tool.info.name == "open_composio_link"
    return cast(Callable[..., Coroutine[object, object, str]], tool)


def test_the_link_tool_opens_the_vendors_links_through_the_app() -> None:
    bridge = NoBridge()
    tool = link_tool(bridge)
    _ = asyncio.run(tool(url="https://connect.composio.dev/link/lk_1"))
    assert bridge.calls == [
        ("composio.open_link", {"url": "https://connect.composio.dev/link/lk_1"})
    ]
    with pytest.raises(ToolError, match="isn't a Composio link"):
        _ = asyncio.run(tool(url="https://example.com"))
    assert len(bridge.calls) == 1


def test_a_call_hands_its_hosted_extensions_the_tokens() -> None:
    tokens = FakeTokens()
    call = CallExtensions.for_call({"zapier": {}}, NoBridge(), PLAIN, tokens)
    [(extension, context)] = call.on
    assert extension is ZAPIER_EXTENSION and context.tokens is tokens
    assert "open_zapier_link" in call.notes(PLAIN)[0]


def test_coding_agents_never_get_the_token_socket() -> None:
    assert {SOCKET_ENV, SECRET_ENV} <= APP_KEYS
    assert SocketTokens.from_env({}) is None
    assert SocketTokens.from_env({SOCKET_ENV: "/s", SECRET_ENV: ""}) is None
    assert SocketTokens.from_env({SOCKET_ENV: "/s", SECRET_ENV: "x"}) is not None


def bearer_client(
    tokens: FakeTokens, answer: Callable[[str], int]
) -> httpx2.AsyncClient:
    def handle(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(answer(request.headers["Authorization"]))

    return httpx2.AsyncClient(
        auth=BearerAuth(tokens, "zapier"), transport=httpx2.MockTransport(handle)
    )


def test_a_token_turned_away_is_swapped_once_for_a_newer_one() -> None:
    tokens = FakeTokens()

    async def run() -> list[int]:
        async with bearer_client(
            tokens, lambda auth: 200 if auth == "Bearer t2" else 401
        ) as client:
            return [(await client.get("https://mcp.test/")).status_code for _ in "ab"]

    assert asyncio.run(run()) == [200, 200]
    assert tokens.asks == [("zapier", None), ("zapier", "t1")]


def test_a_server_that_keeps_refusing_gets_its_401_after_one_retry() -> None:
    tokens = FakeTokens()

    async def run() -> int:
        async with bearer_client(tokens, lambda _: 401) as client:
            return (await client.get("https://mcp.test/")).status_code

    assert asyncio.run(run()) == 401
    assert len(tokens.asks) == 2


def test_a_token_about_to_expire_is_swapped_before_the_request() -> None:
    tokens = FakeTokens(expires_in=30)

    async def run() -> None:
        async with bearer_client(tokens, lambda _: 200) as client:
            for _ in "ab":
                _ = await client.get("https://mcp.test/")

    asyncio.run(run())
    assert tokens.asks == [("zapier", None), ("zapier", "t1")]


def test_without_a_token_the_request_goes_out_bare_and_the_line_is_kept() -> None:
    tokens = FakeTokens()
    tokens.refusal = "Connect Zapier again in Settings."
    auth = BearerAuth(tokens, "zapier")
    seen: list[str | None] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request.headers.get("Authorization"))
        return httpx2.Response(401)

    async def run() -> int:
        async with httpx2.AsyncClient(
            auth=auth, transport=httpx2.MockTransport(handle)
        ) as client:
            return (await client.get("https://mcp.test/")).status_code

    assert asyncio.run(run()) == 401
    assert seen == [None], "sent once, without a token, and not retried"
    assert auth.failure == "Connect Zapier again in Settings."
    tokens.refusal = None
    _ = asyncio.run(run())
    assert auth.failure is None, "a token again clears the line"


@pytest.fixture
def socket_dir() -> Iterator[str]:
    # Short: a Unix socket's path is limited to 104 bytes on macOS.
    path = tempfile.mkdtemp(prefix="bt", dir="/tmp" if os.path.isdir("/tmp") else None)
    yield path
    shutil.rmtree(path, ignore_errors=True)


def serve_once(
    path: str, reply: bytes
) -> tuple[list[dict[str, JsonValue]], Callable[[], Awaitable[None]]]:
    seen: list[dict[str, JsonValue]] = []

    async def start() -> None:
        async def handle(
            reader: asyncio.StreamReader, writer: asyncio.StreamWriter
        ) -> None:
            seen.append(json.loads(await reader.readline()))
            writer.write(reply + b"\n")
            await writer.drain()
            writer.close()

        _ = await asyncio.start_unix_server(handle, path)

    return seen, start


def test_the_socket_asks_with_the_runs_secret_and_reads_the_token(
    socket_dir: str,
) -> None:
    path = os.path.join(socket_dir, "s")
    seen, start = serve_once(path, b'{"token": "abc", "expires_in": 300}')

    async def run() -> Token:
        await start()
        return await SocketTokens(path, "sekrit").get("zapier", "old")

    assert asyncio.run(run()) == Token(token="abc", expires_in=300)
    assert seen == [{"secret": "sekrit", "extension": "zapier", "stale": "old"}]


def test_the_cores_refusal_comes_back_as_is(socket_dir: str) -> None:
    path = os.path.join(socket_dir, "s")
    _, start = serve_once(path, b'{"error": "Connect Zapier again in Settings."}')

    async def run() -> None:
        await start()
        _ = await SocketTokens(path, "s").get("zapier")

    with pytest.raises(TokenError, match="Connect Zapier again"):
        asyncio.run(run())


def test_no_app_on_the_socket_is_one_short_line(socket_dir: str) -> None:
    with pytest.raises(TokenError, match="couldn't get the sign-in"):
        _ = asyncio.run(
            SocketTokens(os.path.join(socket_dir, "none"), "s").get("zapier")
        )


@final
class RequireBearer:
    """Lets through only requests with the token the test currently accepts."""

    def __init__(self, app: ASGIApp, valid: list[str]) -> None:
        self.app = app
        self.valid = valid
        self.seen: list[str] = []

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = dict(cast(list[tuple[bytes, bytes]], scope["headers"]))
            auth = headers.get(b"authorization", b"").decode()
            self.seen.append(auth)
            if auth != f"Bearer {self.valid[0]}":
                await send(
                    {"type": "http.response.start", "status": 401, "headers": []}
                )
                await send({"type": "http.response.body", "body": b""})
                return
        await self.app(scope, receive, send)


@pytest.fixture
def mcp_server() -> Iterator[tuple[str, list[str], RequireBearer]]:
    """A real MCP server over Streamable HTTP on a local port, with one tool, that wants a
    bearer token."""
    server = McpTestServer("test")

    @server.tool()
    def send_email(to: str) -> str:
        """Send an email."""
        return f"sent to {to}"

    valid = ["t1"]
    app = RequireBearer(server.streamable_http_app(), valid)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = cast(tuple[str, int], sock.getsockname())[1]
    web = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan="on"))
    thread = threading.Thread(target=web.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    while not web.started:
        _ = threading.Event().wait(0.01)
    yield f"http://127.0.0.1:{port}/mcp", valid, app
    web.should_exit = True
    thread.join(5)


def test_the_servers_tools_load_and_run_with_the_cores_token(
    mcp_server: tuple[str, list[str], RequireBearer],
) -> None:
    url, valid, app = mcp_server
    tokens = FakeTokens()

    async def run() -> tuple[list[str], str]:
        toolset = MCPToolset(
            id="zapier_mcp",
            mcp_server=HostedMcpServer(url, BearerAuth(tokens, "zapier")),
        )
        try:
            _ = await toolset.setup()
            tools = cast(
                list[RawFunctionTool[..., Awaitable[str]]],
                [t for t in toolset.tools if isinstance(t, RawFunctionTool)],
            )
            # The vendor turns the first token away mid-call: the next is fetched.
            valid[0] = "t2"
            send = cast(Callable[..., Awaitable[str]], tools[0])
            result = await send({"to": "me@example.com"})
            return [t.info.name for t in tools], result
        finally:
            await toolset.aclose()

    names, result = asyncio.run(run())
    assert names == ["send_email"]
    assert "sent to me@example.com" in result
    assert ("zapier", "t1") in tokens.asks
    assert "Bearer t2" in app.seen


def test_a_lost_sign_in_mid_call_reaches_the_model_and_the_call_recovers(
    mcp_server: tuple[str, list[str], RequireBearer],
) -> None:
    url, valid, _ = mcp_server
    tokens = FakeTokens()

    async def run() -> tuple[str, str]:
        toolset = MCPToolset(
            id="zapier_mcp",
            mcp_server=HostedMcpServer(url, BearerAuth(tokens, "zapier")),
        )
        try:
            _ = await toolset.setup()
            [send] = [
                cast(Callable[..., Awaitable[str]], t)
                for t in toolset.tools
                if isinstance(t, RawFunctionTool)
            ]
            # The vendor turns the token away and the core can't refresh it.
            valid[0] = "t2"
            tokens.refusal = "Zapier's sign-in expired. Connect it again in Settings."
            with pytest.raises(ToolError) as refused:
                _ = await send({"to": "me@example.com"})
            # Connected again: the same connection carries on.
            tokens.refusal = None
            return str(refused.value), await send({"to": "me@example.com"})
        finally:
            await toolset.aclose()

    message, result = asyncio.run(run())
    assert message == "Zapier's sign-in expired. Connect it again in Settings."
    assert "sent to me@example.com" in result

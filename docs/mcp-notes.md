# MCP notes

Facts about the Model Context Protocol servers Bomby's hosted MCP extensions use, and the MCP client in LiveKit Agents ([decision](decisions/hosted-mcp-extensions-with-oauth.md)).

## LiveKit's MCP client

Checked 2026-11-09 against the installed `livekit-agents` 1.8.11 (`livekit/agents/llm/mcp.py`), with the `mcp` extra: `mcp` 2.3.0 and `httpx2` 2.16.0.

- **The extra.** `livekit-agents[mcp]` adds `mcp>=2.2,<3`; without it, importing `livekit.agents.llm.mcp` fails.
- **Servers.** `MCPServerHTTP(url, transport_type="sse" | "streamable_http", headers=, allowed_tools=, timeout=5, sse_read_timeout=300, client_session_timeout_seconds=5)` and `MCPServerStdio(command, args, env=, cwd=)`. Both subclass the abstract `MCPServer`, whose one abstract method is `client_streams()`, an async context manager that yields the transport's streams.
- **No OAuth.** `MCPServerHTTP` sends fixed headers. Its `_create_http_client` takes an `auth`, but `client_streams` never passes one. Bomby subclasses `MCPServer` and builds the client itself: `mcp.shared._httpx_utils.create_mcp_http_client(auth=)` (30 s connect, 300 s read), handed to `mcp.client.streamable_http.streamable_http_client(url, http_client=)`.
- **`httpx2.Auth`.** Override `async_auth_flow(request)`: set the header, `response = yield request`, and on 401 set a new header and yield again.
- **`client_session_timeout_seconds`** is each MCP request's read timeout (`ClientSession(read_timeout_seconds=)`), tool calls included, so 5 s is too short for a tool that does real work.
- **Toolsets.** `MCPToolset(id=, mcp_server=, tool_options=)` is an `AsyncToolset`. `AgentActivity._setup_toolsets` calls `setup()` on every toolset when the activity starts, in parallel, with `return_exceptions=True`: a server that fails to connect is logged, its tools are missing, and the call goes on. `Agent(mcp_servers=)` and `AgentSession(mcp_servers=)` still work but are deprecated for `MCPToolset`.
- **Results.** The default resolver returns one content item's JSON (`model_dump_json`), or a JSON list of several. An error result (`is_error`) raises `ToolError` with its text. A `tool_result_resolver` on the server changes this.

## Authorization

Both servers follow the MCP authorization spec: a 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, protected resource metadata (RFC 9728) naming the authorization server, its metadata at `/.well-known/oauth-authorization-server` (RFC 8414), dynamic client registration (RFC 7591), and PKCE. Checked 2026-11-09 with plain HTTP requests, including one registration each (`client_name` "Bomby", redirect `http://127.0.0.1/callback`, `token_endpoint_auth_method` "none"), which both accepted.

| | Zapier | Composio Connect |
| --- | --- | --- |
| MCP URL | `https://mcp.zapier.com/api/v1/connect` (Streamable HTTP only) | `https://connect.composio.dev/mcp` |
| Resource metadata | `/.well-known/oauth-protected-resource/api/v1/connect`, scopes `openid profile email` | `/.well-known/oauth-protected-resource`, no scopes |
| Authorization server | `https://mcp.zapier.com` | `https://connect.composio.dev` |
| Authorize | `https://mcp.zapier.com/oauth/authorize` | `https://connect.composio.dev/oauth/authorize` |
| Token | `https://mcp.zapier.com/api/v1/oauth/token` | `https://login.composio.dev/oauth2/token` (WorkOS) |
| Register | `https://mcp.zapier.com/api/v1/oauth/register` | `https://login.composio.dev/oauth2/register` |
| Scopes offered | `openid profile email` | `openid profile email offline_access` |
| Client auth | `none`, `client_secret_post`, `client_secret_basic` | `none` |

- **Zapier.** Its docs say OAuth is for MCP clients on its list, and others use a connection token from mcp.zapier.com as `Authorization: Bearer` ([how connections work](https://docs.zapier.com/mcp/overview/how-connections-work)). New servers are "agentic": a fixed set of meta-tools that find, enable and run actions. Each successful tool call costs two Zapier tasks. Bomby's sign-in works although it isn't on the list (owner, 2026-11-09). A new client joins the account's default server, named "MCP Server"; the client's `client_name` shows only in that server's Clients tab, and older servers named after a client ("Claude MCP Server") date from when each client got its own ([how servers work](https://docs.zapier.com/mcp/overview/how-servers-work)). Nothing a client sends names the server; the user renames it.
- **Composio Connect.** One shared MCP server for any client, 7 meta-tools that find apps, sign in to them and run their tools. The first use of an app answers with a sign-in link for it ([Composio Connect](https://docs.composio.dev/docs/composio-connect)). Composio's `client_01…` ids and `login.composio.dev` are WorkOS AuthKit, whose access tokens last minutes, so refresh during a call is expected. Ask for `offline_access` to get a refresh token.

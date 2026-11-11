"""A stand-in for claude-agent-acp: a real ACP agent over stdio, scripted by the prompt.

Every call it receives is appended as a JSON line to the file in FAKE_ACP_LOG, so tests
can check what the client sent. Set FAKE_ACP_NO_STEERING=1 to leave steering out of
initialize, like an adapter without it. Setup scenarios, by environment variable:

- FAKE_ACP_REFUSE_SESSION=<text>: `session/new` fails with <text> as the error's data
- FAKE_ACP_AUTH_REQUIRED=1: `session/new` fails with `auth_required`
- FAKE_ACP_AUTH_METHODS=<description>: initialize offers one auth method with it
- FAKE_ACP_MODEL=<model>: sessions offer a model option set to it, beside "m2", an effort
  option (low, high) and an uncategorized provider (p1, p2; on p2 the only model is
  "p2-model"), all settable, but the provider "p3", listed, is refused; `none` leaves all
  of them out
- FAKE_ACP_AUTH_STATUS=<kind>: advertise `authStatus` and push that kind after initialize
- FAKE_ACP_CAN_DELETE=1: advertise `session/delete`, which it serves either way
- FAKE_ACP_HANG=<step>: never answer `initialize` or `session/new` (the step's name), in
  the first process only, so a fresh one answers
- FAKE_ACP_SLOW_CANCEL=<seconds>: a cancelled "hang" turn takes that long to stop, says
  "late news" and only then answers its prompt, as an agent stopping its tools does

Prompts:

- "reply <text>": narrate, run a tool call, then send "Done: <text>" as the final message
- "stream <text>": what the Agents panel shows and what it leaves out: a thought, a
  message, a tool call with a 300-character title, a big raw input, an update with only
  content and then its completion, a second tool call left running, then "Done: <text>"
- "silent": narrate, run a tool call, then end the turn with no final message
- "permission": ask for permission, then report the option the client chose
- "hang": take steered messages and wait until the client cancels, then stop with
  `cancelled`
- "wait <text>": wait for a steered message, then reply "Done: <text> + <steered text>"
- "cutoff <text>": wait for a steered message, then say <text> and stop with `max_tokens`
- "turns": reply with how many prompts this session has had, e.g. "turn 2"
- "fail <text>": fail the turn with <text> as the error's details
- "crash <text>": print <text> to stderr and exit
"""

import asyncio
import json
import os
import sys
from typing import Any, Literal, final

import acp.agent.connection
from acp import (
    PROTOCOL_VERSION,
    RequestError,
    run_agent,
    start_tool_call,
    text_block,
    tool_content,
    update_agent_message,
    update_agent_thought,
    update_tool_call,
)
from acp.agent.router import build_agent_router
from acp.interfaces import Client
from acp.router import MessageRouter
from acp.schema import (
    AgentCapabilities,
    AgentMessageChunk,
    AllowedOutcome,
    AuthMethodAgent,
    CloseSessionResponse,
    DeleteSessionRequest,
    DeleteSessionResponse,
    EnvVarAuthMethod,
    InitializeResponse,
    NewSessionResponse,
    PermissionOption,
    PromptResponse,
    SessionCapabilities,
    SessionCloseCapabilities,
    SessionConfigOptionBoolean,
    SessionConfigOptionSelect,
    SessionConfigSelectOption,
    SessionDeleteCapabilities,
    SessionMode,
    SessionModeState,
    SetSessionConfigOptionResponse,
    SetSessionModeResponse,
    TerminalAuthMethod,
    ToolCallUpdate,
)


def log(event: str, **fields: Any) -> None:
    with open(os.environ["FAKE_ACP_LOG"], "a") as f:
        _ = f.write(json.dumps({"event": event, **fields}) + "\n")


def first_to_hang() -> bool:
    """Whether this is the first process to hang: a file beside the log marks one has."""
    marker = os.environ["FAKE_ACP_LOG"] + ".hung"
    if os.path.exists(marker):
        return False
    with open(marker, "w"):
        pass
    return True


async def maybe_hang(step: str) -> None:
    """Hangs forever on `step` when FAKE_ACP_HANG names it, in the first process only."""
    if os.getenv("FAKE_ACP_HANG") != step or not first_to_hang():
        return
    log("hang", step=step)
    _ = await asyncio.Event().wait()


def message(text: str, message_id: str) -> AgentMessageChunk:
    chunk = update_agent_message(text_block(text))
    chunk.message_id = message_id
    return chunk


def _select(
    id: str,
    category: Literal["mode", "model", "thought_level"] | None,
    current: str,
    values: list[str],
) -> SessionConfigOptionSelect:
    return SessionConfigOptionSelect(
        id=id,
        name=id.capitalize(),
        category=category,
        type="select",
        current_value=current,
        options=[SessionConfigSelectOption(value=v, name=f"Fake {v}") for v in values],
    )


def config_options(
    values: dict[str, str],
) -> list[SessionConfigOptionSelect | SessionConfigOptionBoolean] | None:
    """The session's options for its current `values` (see FAKE_ACP_MODEL)."""
    model = os.getenv("FAKE_ACP_MODEL")
    if model is None:
        return None
    mode = _select("mode", "mode", "default", ["default"])
    if model == "none":
        return [mode]
    models = ["p2-model"] if values["provider"] == "p2" else [model, "m2"]
    return [
        mode,
        _select("provider", None, values["provider"], ["p1", "p2", "p3"]),
        _select("model", "model", values["model"], models),
        _select("effort", "thought_level", values["effort"], ["low", "high"]),
    ]


@final
class _Session:
    def __init__(self) -> None:
        self.turns = 0
        self.cancelled = asyncio.Event()
        self.values = {
            "provider": "p1",
            "model": os.getenv("FAKE_ACP_MODEL", ""),
            "effort": "low",
        }
        self.steered: asyncio.Queue[str] | None = None  # set while a "wait" turn runs


@final
class FakeClaude:
    def __init__(self) -> None:
        self._client: Client | None = None
        self._sessions: dict[str, _Session] = {}
        self._push: asyncio.Task[None] | None = None

    def on_connect(self, conn: Client) -> None:
        self._client = conn

    async def _push_auth(self, kind: str) -> None:
        await asyncio.sleep(0.05)
        assert self._client is not None
        await self._client.ext_notification(
            "auth/status_update", {"authStatus": {"kind": kind, "label": "Fake Pro"}}
        )

    async def initialize(
        self, protocol_version: int, **_kwargs: Any
    ) -> InitializeResponse:
        log("initialize", protocol_version=protocol_version, pid=os.getpid())
        await maybe_hang("initialize")
        # claude-agent-acp advertises session/close and steering the same way.
        capabilities = AgentCapabilities(
            session_capabilities=SessionCapabilities(
                close=SessionCloseCapabilities(),
                delete=SessionDeleteCapabilities()
                if os.getenv("FAKE_ACP_CAN_DELETE")
                else None,
            )
        )
        if kind := os.getenv("FAKE_ACP_AUTH_STATUS"):
            capabilities.field_meta = {"authStatus": {}}
            # Like claude-agent-acp: pushed once the initialize response is out.
            self._push = asyncio.create_task(self._push_auth(kind))
        meta = (
            None
            if os.getenv("FAKE_ACP_NO_STEERING")
            else {"steering": {"supported": True}}
        )
        description = os.getenv("FAKE_ACP_AUTH_METHODS")
        methods: list[EnvVarAuthMethod | TerminalAuthMethod | AuthMethodAgent] = (
            [AuthMethodAgent(id="fake-login", name="Log in", description=description)]
            if description
            else []
        )
        return InitializeResponse(
            protocol_version=PROTOCOL_VERSION,
            agent_capabilities=capabilities,
            auth_methods=methods,
            field_meta=meta,
        )

    async def new_session(
        self, cwd: str, additional_directories: list[str] | None = None, **kwargs: Any
    ) -> NewSessionResponse:
        if refused := os.getenv("FAKE_ACP_REFUSE_SESSION"):
            raise RequestError(-32603, "Internal error", refused)
        if os.getenv("FAKE_ACP_AUTH_REQUIRED"):
            raise RequestError.auth_required()
        await maybe_hang("new_session")
        session_id = f"s{len(self._sessions) + 1}"
        self._sessions[session_id] = _Session()
        log(
            "new_session",
            session_id=session_id,
            cwd=cwd,
            additional_directories=additional_directories,
            system_prompt=kwargs.get("systemPrompt"),
        )
        modes = SessionModeState(
            current_mode_id="default",
            available_modes=[
                SessionMode(id="default", name="Default"),
                SessionMode(id="bypassPermissions", name="Bypass Permissions"),
            ],
        )
        return NewSessionResponse(
            session_id=session_id,
            modes=modes,
            config_options=config_options(self._sessions[session_id].values),
        )

    async def set_config_option(
        self, config_id: str, session_id: str, value: str | bool, **_kwargs: Any
    ) -> SetSessionConfigOptionResponse:
        log(
            "set_config_option", session_id=session_id, config_id=config_id, value=value
        )
        if value == "p3":
            raise RequestError(-32603, "Internal error", {"details": "no key for p3"})
        values = self._sessions[session_id].values
        values[config_id] = str(value)
        if config_id == "provider":
            values["model"] = (
                "p2-model" if value == "p2" else os.getenv("FAKE_ACP_MODEL", "")
            )
        return SetSessionConfigOptionResponse(
            config_options=config_options(values) or []
        )

    async def set_session_mode(
        self, session_id: str, mode_id: str, **_kwargs: Any
    ) -> SetSessionModeResponse:
        log("set_session_mode", session_id=session_id, mode_id=mode_id)
        return SetSessionModeResponse()

    async def prompt(
        self, session_id: str, prompt: list[Any], **_kwargs: Any
    ) -> PromptResponse:
        assert self._client is not None
        session = self._sessions[session_id]
        session.turns += 1
        session.cancelled.clear()
        text = prompt[-1].text  # the task; a briefing may come before it
        log("prompt", session_id=session_id, text=text, blocks=[b.text for b in prompt])

        async def say(reply: str, message_id: str = "m1") -> None:
            assert self._client is not None
            await self._client.session_update(session_id, message(reply, message_id))

        if text.startswith("reply "):
            await say("Let me look. ")
            await self._client.session_update(
                session_id, start_tool_call("t1", "Read file")
            )
            await say("Done: ", "m2")
            await say(text[6:], "m2")
            return PromptResponse(stop_reason="end_turn")

        if text.startswith("stream "):
            client = self._client
            await client.session_update(
                session_id, update_agent_thought(text_block("Thinking it over."))
            )
            await say("Let me look. ")
            await client.session_update(
                session_id,
                start_tool_call(
                    "t1",
                    "Run " + "x" * 300,
                    kind="execute",
                    raw_input={"secret": "x" * 5000},
                ),
            )
            await client.session_update(
                session_id,
                update_tool_call("t1", content=[tool_content(text_block("output"))]),
            )
            await client.session_update(
                session_id, update_tool_call("t1", status="completed")
            )
            await client.session_update(
                session_id, start_tool_call("t2", "Read file", status="in_progress")
            )
            await say("Done: ", "m2")
            await say(text[7:], "m2")
            return PromptResponse(stop_reason="end_turn")

        if text == "silent":
            await say("Let me look. ")
            await self._client.session_update(
                session_id, start_tool_call("t1", "Read file")
            )
            return PromptResponse(stop_reason="end_turn")

        if text == "permission":
            options = [
                PermissionOption(
                    option_id="always", name="Always", kind="allow_always"
                ),
                PermissionOption(option_id="once", name="Once", kind="allow_once"),
                PermissionOption(option_id="no", name="No", kind="reject_once"),
            ]
            response = await self._client.request_permission(
                session_id, ToolCallUpdate(tool_call_id="t1", title="Run rm"), options
            )
            outcome = response.outcome
            chosen = (
                outcome.option_id
                if isinstance(outcome, AllowedOutcome)
                else "cancelled"
            )
            await say(f"chose {chosen}")
            return PromptResponse(stop_reason="end_turn")

        if text == "hang":
            session.steered = asyncio.Queue()
            try:
                _ = await session.cancelled.wait()
            finally:
                session.steered = None
            if slow := os.getenv("FAKE_ACP_SLOW_CANCEL"):
                await asyncio.sleep(float(slow))
                await say("late news")
            log("stopped", session_id=session_id)
            return PromptResponse(stop_reason="cancelled")

        if text.startswith("wait "):
            session.steered = asyncio.Queue()
            try:
                steered = await session.steered.get()
            finally:
                session.steered = None
            await say(f"Done: {text[5:]} + {steered}")
            return PromptResponse(stop_reason="end_turn")

        if text.startswith("cutoff "):
            session.steered = asyncio.Queue()
            try:
                _ = await session.steered.get()
            finally:
                session.steered = None
            await say(text[7:])
            return PromptResponse(stop_reason="max_tokens")

        if text == "turns":
            await say(f"turn {session.turns}")
            return PromptResponse(stop_reason="end_turn")

        if text.startswith("fail "):
            raise RequestError(-32603, "Internal error", {"details": text[5:]})

        if text.startswith("crash "):
            print(text[6:], file=sys.stderr, flush=True)
            os._exit(1)

        raise ValueError(f"unknown prompt {text!r}")

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if method != "session/steering":
            raise ValueError(f"unknown extension method {method!r}")
        session_id = params["sessionId"]
        text = params["prompt"][0]["text"]
        idle = params.get("_meta", {}).get("steering", {}).get("idleBehavior")
        session = self._sessions[session_id]
        injected = session.steered is not None
        log(
            "steer",
            session_id=session_id,
            text=text,
            idle_behavior=idle,
            injected=injected,
        )
        if session.steered is None:
            return {"outcome": "promptRequired", "reason": "noRunningTurn"}
        session.steered.put_nowait(text)
        return {"outcome": "injected"}

    async def cancel(self, session_id: str, **_kwargs: Any) -> None:
        log("cancel", session_id=session_id)
        self._sessions[session_id].cancelled.set()

    async def close_session(
        self, session_id: str, **_kwargs: Any
    ) -> CloseSessionResponse:
        log("close_session", session_id=session_id)
        return CloseSessionResponse()

    async def delete_session(
        self, session_id: str, **_kwargs: Any
    ) -> DeleteSessionResponse:
        log("delete_session", session_id=session_id)
        return DeleteSessionResponse()


def _router_with_delete(
    agent: Any, use_unstable_protocol: bool = False
) -> MessageRouter:
    """The SDK's router, plus `session/delete`, which SDK 0.12.1 doesn't route."""
    router = build_agent_router(agent, use_unstable_protocol)
    _ = router.route_request(
        "session/delete", DeleteSessionRequest, agent, "delete_session"
    )
    return router


if __name__ == "__main__":
    # The connection builds its router by this name; swapping it adds `session/delete`.
    acp.agent.connection.build_agent_router = _router_with_delete  # pyright: ignore[reportPrivateImportUsage]
    # session/close is "unstable" in the Python SDK's agent router; claude-agent-acp
    # serves it on ACP v1.
    asyncio.run(run_agent(FakeClaude(), use_unstable_protocol=True))  # pyright: ignore[reportArgumentType]

"""A stand-in for claude-agent-acp: a real ACP agent over stdio, scripted by the prompt.

Every call it receives is appended as a JSON line to the file in FAKE_ACP_LOG, so tests
can check what the client sent. Set FAKE_ACP_NO_STEERING=1 to leave steering out of
initialize, like an adapter without it. Setup scenarios, by environment variable:

- FAKE_ACP_REFUSE_SESSION=<text>: `session/new` fails with <text> as the error's data
- FAKE_ACP_AUTH_REQUIRED=1: `session/new` fails with `auth_required`
- FAKE_ACP_AUTH_METHODS=<description>: initialize offers one auth method with it
- FAKE_ACP_MODEL=<model>: sessions offer a model option set to it; `none` leaves it out
- FAKE_ACP_AUTH_STATUS=<kind>: advertise `authStatus` and push that kind on `session/new`

Prompts:

- "reply <text>": narrate, run a tool call, then send "Done: <text>" as the final message
- "permission": ask for permission, then report the option the client chose
- "hang": wait until the client cancels, then stop with `cancelled`
- "wait <text>": wait for a steered message, then reply "Done: <text> + <steered text>"
- "turns": reply with how many prompts this session has had, e.g. "turn 2"
- "fail <text>": fail the turn with <text> as the error's details
- "crash <text>": print <text> to stderr and exit
"""

import asyncio
import json
import os
import sys
from typing import Any, final

from acp import (
    PROTOCOL_VERSION,
    RequestError,
    run_agent,
    start_tool_call,
    text_block,
    update_agent_message,
)
from acp.interfaces import Client
from acp.schema import (
    AgentCapabilities,
    AgentMessageChunk,
    AllowedOutcome,
    AuthMethodAgent,
    CloseSessionResponse,
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
    SessionMode,
    SessionModeState,
    SetSessionModeResponse,
    TerminalAuthMethod,
    ToolCallUpdate,
)


def log(event: str, **fields: Any) -> None:
    with open(os.environ["FAKE_ACP_LOG"], "a") as f:
        _ = f.write(json.dumps({"event": event, **fields}) + "\n")


def message(text: str, message_id: str) -> AgentMessageChunk:
    chunk = update_agent_message(text_block(text))
    chunk.message_id = message_id
    return chunk


def config_options() -> (
    list[SessionConfigOptionSelect | SessionConfigOptionBoolean] | None
):
    model = os.getenv("FAKE_ACP_MODEL")
    if model is None:
        return None
    mode = SessionConfigOptionSelect(
        id="mode",
        name="Mode",
        category="mode",
        type="select",
        current_value="default",
        options=[SessionConfigSelectOption(value="default", name="Default")],
    )
    if model == "none":
        return [mode]
    chosen = SessionConfigOptionSelect(
        id="model",
        name="Model",
        category="model",
        type="select",
        current_value=model,
        options=[SessionConfigSelectOption(value=model, name=f"Fake {model}")],
    )
    return [mode, chosen]


@final
class _Session:
    def __init__(self) -> None:
        self.turns = 0
        self.cancelled = asyncio.Event()
        self.steered: asyncio.Queue[str] | None = None  # set while a "wait" turn runs


@final
class FakeClaude:
    def __init__(self) -> None:
        self._client: Client | None = None
        self._sessions: dict[str, _Session] = {}

    def on_connect(self, conn: Client) -> None:
        self._client = conn

    async def initialize(
        self, protocol_version: int, **_kwargs: Any
    ) -> InitializeResponse:
        log("initialize", protocol_version=protocol_version)
        # claude-agent-acp advertises session/close and steering the same way.
        capabilities = AgentCapabilities(
            session_capabilities=SessionCapabilities(close=SessionCloseCapabilities())
        )
        if os.getenv("FAKE_ACP_AUTH_STATUS"):
            capabilities.field_meta = {"authStatus": {}}
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
        if kind := os.getenv("FAKE_ACP_AUTH_STATUS"):
            assert self._client is not None
            await self._client.ext_notification(
                "auth/status_update",
                {"authStatus": {"kind": kind, "label": "Fake Pro"}},
            )
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
            session_id=session_id, modes=modes, config_options=config_options()
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
            _ = await session.cancelled.wait()
            return PromptResponse(stop_reason="cancelled")

        if text.startswith("wait "):
            session.steered = asyncio.Queue()
            try:
                steered = await session.steered.get()
            finally:
                session.steered = None
            await say(f"Done: {text[5:]} + {steered}")
            return PromptResponse(stop_reason="end_turn")

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


if __name__ == "__main__":
    # session/close is "unstable" in the Python SDK's agent router; claude-agent-acp
    # serves it on ACP v1.
    asyncio.run(run_agent(FakeClaude(), use_unstable_protocol=True))  # pyright: ignore[reportArgumentType]

"""What went wrong with a harness, in words the voice model can say and Settings can show.

Every agent reports trouble through ACP the same way, so none of this is per agent: the
details are in a JSON-RPC error's `data`, and the fix is in the agent's `authMethods`
(docs/acp-notes.md#setup-signals).
"""

import re
from collections.abc import Sequence

from acp import RequestError
from acp.schema import AuthMethodAgent, EnvVarAuthMethod, TerminalAuthMethod

from harnesses.harness import Harness

AuthMethod = AuthMethodAgent | EnvVarAuthMethod | TerminalAuthMethod

AUTH_REQUIRED = -32000
_COMMAND = re.compile(r"`([^`]+)`")
_MAX_TEXT = 300


def _clip(text: str) -> str:
    text = text.strip().rstrip(".")
    return text if len(text) <= _MAX_TEXT else text[: _MAX_TEXT - 3] + "..."


def detail(error: BaseException) -> str:
    """The agent's own words for `error`. A JSON-RPC error's message is generic ("Internal
    error"); what the agent said is in its `data`."""
    text = ""
    if isinstance(error, RequestError):
        data: object = error.data
        if isinstance(data, dict):
            fields: dict[str, object] = data  # pyright: ignore[reportUnknownVariableType]
            data = next(
                (fields[k] for k in ("details", "message", "error") if k in fields),
                None,
            )
        if isinstance(data, str):
            text = data
    elif isinstance(error, OSError):
        text = error.strerror or ""
    return _clip(text or str(error) or type(error).__name__)


def setup_command(harness: Harness, auth_methods: Sequence[AuthMethod]) -> str | None:
    """What the user runs in Terminal to set the agent up: the harness's own, or the first
    command an auth method names ("Run `goose configure` to set up ...")."""
    if harness.setup_command:
        return harness.setup_command
    for method in auth_methods:
        found = _COMMAND.search(method.description or "")
        if found:
            return found.group(1)
    return None


def _how_to_fix(harness: Harness, auth_methods: Sequence[AuthMethod]) -> str:
    command = setup_command(harness, auth_methods)
    where = (
        f"run {command} in Terminal"
        if command
        else f"set it up in {harness.short_name} itself"
    )
    return f"To fix it, {where}; Settings, Agents can then check again."


def _said(last_output: str | None) -> str:
    return (
        f", saying: {_clip(last_output)}" if last_output and last_output.strip() else ""
    )


def start_failed(
    harness: Harness,
    error: BaseException,
    auth_methods: Sequence[AuthMethod],
    last_output: str | None = None,
) -> str:
    """Why a harness couldn't take work, for the voice model to tell the user.
    `last_output` is the agent's last stderr line, for when its process quit."""
    name = harness.short_name
    if isinstance(error, OSError):
        return (
            f"{name} couldn't be started: {detail(error)}. It may have moved or been "
            "uninstalled; Settings, Agents can look for it again."
        )
    if isinstance(error, RequestError) and error.code == AUTH_REQUIRED:
        return f"{name} needs the user to sign in. {_how_to_fix(harness, auth_methods)}"
    if isinstance(error, RequestError):
        return f"{name} isn't set up: {detail(error)}. {_how_to_fix(harness, auth_methods)}"
    return f"{name} quit while starting{_said(last_output)}."


def turn_failed(
    harness: Harness,
    error: BaseException,
    auth_methods: Sequence[AuthMethod],
    last_output: str | None = None,
) -> str:
    """Why a running task failed, for the voice model to tell the user."""
    name = harness.short_name
    if isinstance(error, RequestError) and error.code == AUTH_REQUIRED:
        return f"{name} needs the user to sign in. {_how_to_fix(harness, auth_methods)}"
    if isinstance(error, RequestError):
        return f"{name} hit an error: {detail(error)}."
    return (
        f"{name} stopped unexpectedly{_said(last_output)}. The next task starts it "
        "again, in a new session without this one's context."
    )

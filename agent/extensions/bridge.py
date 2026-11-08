"""The app as extensions reach it during a call: LiveKit RPC to the app's page, the room's
`user` participant, which asks the core and answers (docs/livekit-notes.md, RPC).

A method is `bomby.<extension>.<op>` ("bomby.todos.add") with a JSON payload, and the page
answers with JSON. When the core refuses (a to-do that isn't there, a title too long), the
page answers with `RpcError` code `REFUSED` and a message for the user, which the voice model
hears as is. Any other failure is one short line, and the details go to the log: that
nothing changed when the page never got to the request, or that it may have when the page
had it and its answer never came back (the page acknowledges a request before running it,
livekit-client 2.23 `handleIncomingRpcRequest`; docs/livekit-notes.md, RPC).
"""

import json
import logging
from collections.abc import Mapping
from typing import final

from livekit import rtc
from pydantic import JsonValue

from .extension import ExtensionError

logger = logging.getLogger("bomby.extensions")

# The app's page in every call's room (`token` in app/src-tauri/src/calls.rs).
APP_IDENTITY = "user"
METHOD_PREFIX = "bomby."
# Ours: LiveKit reserves 1001 to 1999 for its own errors.
REFUSED = 2000
UNREACHABLE = "The app didn't answer, so that didn't change. Try again in a moment."
UNCONFIRMED = (
    "The app didn't confirm that, so it may have gone through. "
    "Read the list again before trying it again."
)

_Code = rtc.RpcError.ErrorCode
# The failures where the page never ran the request: no one there to ask, no handler for
# it, or it never left. After any other (a timeout, the page leaving, a failed handler) it
# may have run.
NOT_RUN = frozenset(
    {
        _Code.UNSUPPORTED_METHOD,
        _Code.RECIPIENT_NOT_FOUND,
        _Code.REQUEST_PAYLOAD_TOO_LARGE,
        _Code.UNSUPPORTED_SERVER,
        _Code.UNSUPPORTED_VERSION,
        _Code.SEND_FAILED,
    }
)


@final
class RoomBridge:
    """Calls the app's page in `room`."""

    def __init__(self, room: rtc.Room, identity: str = APP_IDENTITY) -> None:
        self._room = room
        self._identity = identity

    async def call(self, method: str, payload: Mapping[str, JsonValue]) -> JsonValue:
        name = METHOD_PREFIX + method
        try:
            reply = await self._room.local_participant.perform_rpc(
                destination_identity=self._identity,
                method=name,
                payload=json.dumps(payload),
            )
        except rtc.RpcError as e:
            if e.code == REFUSED:
                raise ExtensionError(e.message) from e
            logger.warning("%s failed: %s (%s)", name, e.message, e.code)
            raise ExtensionError(
                UNREACHABLE if e.code in NOT_RUN else UNCONFIRMED
            ) from e
        try:
            answer: JsonValue = json.loads(reply)
        except json.JSONDecodeError as e:
            logger.warning(
                "%s answered with something that isn't JSON: %r", name, reply
            )
            raise ExtensionError(UNCONFIRMED) from e
        return answer

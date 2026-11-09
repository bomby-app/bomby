"""Access tokens for the hosted MCP extensions, from the app's core over a local socket
(docs/decisions/hosted-mcp-extensions-with-oauth.md).

The core signs the user in and keeps the grants; the worker asks it for an extension's
token when a call starts and again when the one it has is about to expire or the server
turned it away. The core starts the worker with the socket's path in `BOMBY_TOKENS` and the
run's secret in `BOMBY_TOKENS_SECRET` (`app/src-tauri/src/extensions/tokens.rs`).

One request per connection, each a line of JSON:

    → {"secret": "…", "extension": "zapier", "stale": "<the token it has, or null>"}
    ← {"token": "…", "expires_in": 3600}   or   {"error": "Connect Zapier again in Settings."}

With `stale`, the core refreshes unless it already has a newer token than that one.
"""

import asyncio
import json
import logging
import os
from collections.abc import Mapping
from typing import ClassVar, Protocol, final

from pydantic import BaseModel, ConfigDict, ValidationError

logger = logging.getLogger("bomby.extensions")

SOCKET_ENV = "BOMBY_TOKENS"
SECRET_ENV = "BOMBY_TOKENS_SECRET"
# The core may refresh with the vendor first, which it gives up on after 15 s
# (`REQUEST_TIMEOUT` in `oauth.rs`), so a slow vendor comes back as its line, not a timeout.
TIMEOUT_S = 30
# The most a reply may weigh: a token and its expiry, or a line for the user.
MAX_REPLY = 64 * 1024


class TokenError(Exception):
    """No token: the extension isn't connected, the vendor refused a refresh, or the app
    didn't answer. The message is a line for the voice model."""


class Token(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="ignore")

    token: str
    """Never logged."""
    expires_in: float | None = None
    """Seconds from when the core answered; None when the vendor didn't say."""


class _Reply(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="ignore")

    token: str | None = None
    expires_in: float | None = None
    error: str | None = None


class Tokens(Protocol):
    """Where an extension's tokens come from."""

    async def get(self, extension: str, stale: str | None = None) -> Token:
        """A token for `extension`; with `stale`, a newer one than that. Raises
        `TokenError`."""
        ...


UNREACHABLE = "Bomby couldn't get the sign-in from the app. Try again in a moment."


@final
class SocketTokens:
    """Asks the core over its socket."""

    def __init__(self, path: str, secret: str) -> None:
        self._path = path
        self._secret = secret

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> "SocketTokens | None":
        """The core's socket, or None outside the app (console runs)."""
        path, secret = environ.get(SOCKET_ENV), environ.get(SECRET_ENV)
        if not path or not secret:
            return None
        return cls(path, secret)

    async def get(self, extension: str, stale: str | None = None) -> Token:
        request = {"secret": self._secret, "extension": extension, "stale": stale}
        try:
            async with asyncio.timeout(TIMEOUT_S):
                reader, writer = await asyncio.open_unix_connection(
                    self._path, limit=MAX_REPLY
                )
                try:
                    writer.write(json.dumps(request).encode() + b"\n")
                    await writer.drain()
                    line = await reader.readline()
                finally:
                    writer.close()
        except (OSError, TimeoutError, ValueError) as e:
            logger.warning("no token for %s from the app: %r", extension, e)
            raise TokenError(UNREACHABLE) from e
        try:
            reply = _Reply.model_validate_json(line)
        except ValidationError as e:
            logger.warning("the app's token reply for %s wasn't readable", extension)
            raise TokenError(UNREACHABLE) from e
        if reply.error is not None:
            raise TokenError(reply.error)
        if not reply.token:
            raise TokenError(UNREACHABLE)
        return Token(token=reply.token, expires_in=reply.expires_in)

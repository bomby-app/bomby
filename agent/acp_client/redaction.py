"""Taking the user's saved keys out of what a coding agent says, before it goes anywhere:
the app's page, the voice model, the Agents panel or a log. An agent can echo a key it was
given ("Credential rejected: sk-or-...")."""

import logging
from collections.abc import Collection, Mapping
from typing import final, override

from .environment import every_saved_key

REDACTED = "[redacted]"

MIN_SECRET = 8
"""A saved value shorter than this isn't taken out: a placeholder for a local gateway
("test", "none", "e") would otherwise cut into every word that holds it. Real keys are
far longer."""


def secrets_to_redact(environ: Mapping[str, str]) -> tuple[str, ...]:
    """Every agent's saved key worth taking out, longest first, so one that contains
    another goes whole."""
    return tuple(
        sorted(
            (s for s in every_saved_key(environ) if len(s) >= MIN_SECRET),
            key=len,
            reverse=True,
        )
    )


def scrub(text: str, secrets: Collection[str]) -> str:
    """`text` with each of `secrets` (from `secrets_to_redact`) replaced."""
    for secret in secrets:
        if len(secret) >= MIN_SECRET:
            text = text.replace(secret, REDACTED)
    return text


@final
class RedactingFilter(logging.Filter):
    """Takes `secrets` out of every record a handler writes: its message with its arguments
    applied, and a traceback's text. Install it on the handlers, so records from every
    logger pass it."""

    def __init__(self, secrets: Collection[str]) -> None:
        super().__init__()
        self._secrets = tuple(secrets)

    @override
    def filter(self, record: logging.LogRecord) -> bool:
        if not self._secrets:
            return True
        message = record.getMessage()
        clean = scrub(message, self._secrets)
        if clean != message:
            record.msg, record.args = clean, None
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = scrub(record.exc_text, self._secrets)
        return True

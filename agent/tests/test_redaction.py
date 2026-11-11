import json
import logging

from acp_client.environment import AGENT_KEYS_ENV
from acp_client.redaction import (
    REDACTED,
    RedactingFilter,
    redact_logs,
    scrub,
    secrets_to_redact,
)

KEY = "sk-or-v1-0123456789abcdef"


def test_only_keys_of_real_length_are_taken_out_longest_first() -> None:
    environ = {
        AGENT_KEYS_ENV: json.dumps(
            {"goose": {"A": KEY, "B": "test"}, "codex": {"C": KEY + "-longer"}}
        )
    }
    secrets = secrets_to_redact(environ)
    assert secrets == (KEY + "-longer", KEY)
    assert scrub(f"bad {KEY}-longer and {KEY}, test", secrets) == (
        f"bad {REDACTED} and {REDACTED}, test"
    )


def test_a_log_record_loses_the_key_in_its_message_arguments_and_traceback() -> None:
    record = logging.LogRecord(
        "bomby", logging.WARNING, __file__, 1, "turn failed: %r", (KEY,), None
    )
    try:
        raise ValueError(f"Credential rejected: {KEY}")
    except ValueError:
        import sys

        record.exc_info = sys.exc_info()
    assert RedactingFilter((KEY,)).filter(record)
    text = logging.Formatter().format(record)
    assert KEY not in text
    assert REDACTED in record.getMessage()


def test_logs_are_redacted_once_per_handler_whatever_the_job() -> None:
    handler = logging.NullHandler()
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        redact_logs((KEY,))
        redact_logs((KEY,))
        assert sum(isinstance(f, RedactingFilter) for f in handler.filters) == 1
    finally:
        root.removeHandler(handler)

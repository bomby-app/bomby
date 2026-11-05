import json

import pytest

from call_options import DEFAULT_VOICE, CallOptions
from job import JobMetadata, Line, read_metadata


def test_console_runs_use_the_environment_or_the_defaults() -> None:
    assert CallOptions.from_job(None, {}) == CallOptions(voice=DEFAULT_VOICE)
    environ = {"GEMINI_VOICE": "Puck", "BOMBY_USER_NAME": " Sam "}
    assert CallOptions.from_job(None, environ) == CallOptions(
        voice="Puck", user_name="Sam"
    )


def test_reads_the_voice_and_history_from_the_app() -> None:
    metadata = json.dumps(
        {
            "project": "samba",
            "voice": "Kore",
            "user_name": "  Sam ",
            "history": [
                {"role": "user", "text": " fix the login "},
                {"role": "agent", "text": "Claude's on it."},
                {"role": "user", "text": "  "},
            ],
        }
    )
    options = CallOptions.from_job(read_metadata(metadata), {"GEMINI_VOICE": "Puck"})
    assert options.voice == "Kore"
    assert options.user_name == "Sam"
    assert options.history == (
        Line("user", "fix the login"),
        Line("agent", "Claude's on it."),
    )
    assert options.resumed


def test_a_call_without_history_is_new() -> None:
    assert not CallOptions.from_job(JobMetadata(voice="Kore"), {}).resumed


@pytest.mark.parametrize(
    "metadata",
    [
        json.dumps({"voice": 3}),
        json.dumps({"voice": " "}),
        json.dumps({"user_name": 3}),
        json.dumps({"history": "hello"}),
        json.dumps({"history": [{"role": "system", "text": "x"}]}),
        json.dumps({"history": [{"role": "user"}]}),
    ],
)
def test_rejects_bad_metadata(metadata: str) -> None:
    with pytest.raises(ValueError):
        _ = CallOptions.from_job(read_metadata(metadata), {})

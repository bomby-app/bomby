import json

import pytest

from call_options import DEFAULT_VOICE, CallOptions, Line
from job import read_metadata


def test_console_runs_use_the_env_voice_or_the_default() -> None:
    assert CallOptions.from_job(None, {}) == CallOptions(voice=DEFAULT_VOICE)
    assert CallOptions.from_job(None, {"GEMINI_VOICE": "Puck"}).voice == "Puck"


def test_reads_the_voice_and_history_from_the_app() -> None:
    metadata = json.dumps(
        {
            "project": "samba",
            "voice": "Kore",
            "history": [
                {"role": "user", "text": " fix the login "},
                {"role": "agent", "text": "Claude's on it."},
                {"role": "user", "text": "  "},
            ],
        }
    )
    options = CallOptions.from_job(read_metadata(metadata), {"GEMINI_VOICE": "Puck"})
    assert options.voice == "Kore"
    assert options.history == (
        Line("user", "fix the login"),
        Line("agent", "Claude's on it."),
    )
    assert options.resumed


def test_a_new_call_keeps_the_instructions_as_they_are() -> None:
    options = CallOptions.from_job({"voice": "Kore", "history": []}, {})
    assert not options.resumed
    assert options.instructions("Be brief.") == "Be brief."


def test_a_resumed_call_appends_the_previous_conversation() -> None:
    options = CallOptions(
        voice="Kore",
        history=(Line("user", "fix the login"), Line("agent", "Done.")),
    )
    text = options.instructions("Be brief.")
    assert text.startswith("Be brief.\n\n## Previous conversation\n\n")
    assert text.endswith("User: fix the login\nYou: Done.")


@pytest.mark.parametrize(
    "metadata",
    [
        json.dumps({"voice": 3}),
        json.dumps({"voice": " "}),
        json.dumps({"history": "hello"}),
        json.dumps({"history": [{"role": "system", "text": "x"}]}),
        json.dumps({"history": [{"role": "user"}]}),
    ],
)
def test_rejects_bad_metadata(metadata: str) -> None:
    with pytest.raises(ValueError):
        _ = CallOptions.from_job(read_metadata(metadata), {})

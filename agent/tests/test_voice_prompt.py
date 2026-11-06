from datetime import UTC, datetime
from pathlib import Path

from call_options import CallOptions
from harnesses import HARNESSES
from job import Line
from project import Project
from tools import agents_note
from voice_prompt import PROMPTS, local_zone, the_time, voice_instructions

NOW = datetime(2026, 11, 6, 0, 2, tzinfo=UTC)
# The tone prompt, then when and where the call starts.
VOICE = f"{PROMPTS['sharp']}\n\n{the_time(NOW, local_zone())}"

AGENTS = [HARNESSES["claude"]]


def project(instructions: str = "") -> Project:
    return Project(name="samba", folders=(Path.home(),), instructions=instructions)


def test_a_plain_call_gets_the_prompt_and_its_agents() -> None:
    text = voice_instructions(project(), CallOptions(voice="Kore"), AGENTS, now=NOW)

    assert text == f"{VOICE}\n\n{agents_note(AGENTS)}"


def test_a_named_user_comes_before_the_agents() -> None:
    text = voice_instructions(
        project(), CallOptions(voice="Kore", user_name="Sam"), AGENTS, now=NOW
    )

    assert text == (
        f"{VOICE}\n\n## The user\n\nYou're talking to Sam. Address the user by their "
        f"name when needed.\n\n{agents_note(AGENTS)}"
    )


def test_the_project_context_follows_the_agents() -> None:
    text = voice_instructions(
        project("A music app."), CallOptions(voice="Kore"), AGENTS, now=NOW
    )

    assert text == (
        f"{VOICE}\n\n{agents_note(AGENTS)}\n\n## Project context\n\n"
        "The user's description of the project this call works on:\n\nA music app."
    )


def test_a_resumed_call_ends_with_the_previous_conversation() -> None:
    options = CallOptions(
        voice="Kore",
        history=(Line("user", "fix the login"), Line("agent", "Done.")),
    )

    text = voice_instructions(project("A music app."), options, AGENTS)

    assert text.index("## Project context") < text.index("## Previous conversation")
    assert text.endswith("User: fix the login\nYou: Done.")


def test_each_tone_gets_its_own_prompt() -> None:
    for tone in ("sharp", "chatty", "playful"):
        text = voice_instructions(
            project(), CallOptions(voice="Kore", tone=tone), AGENTS, now=NOW
        )
        assert text.startswith(PROMPTS[tone])
    assert len(set(PROMPTS.values())) == 3


def test_every_tone_keeps_the_same_rules_and_sections() -> None:
    def rules(prompt: str) -> str:
        return prompt[prompt.index("## Non-negotiable rules") :]

    def headings(prompt: str) -> list[str]:
        return [line for line in prompt.splitlines() if line.startswith("## ")]

    for tone in ("chatty", "playful"):
        assert rules(PROMPTS[tone]) == rules(PROMPTS["sharp"])
        assert headings(PROMPTS[tone]) == headings(PROMPTS["sharp"])


def test_the_call_knows_the_date_time_and_place() -> None:
    now = datetime(2026, 11, 6, 0, 2, tzinfo=UTC)
    assert the_time(now, "Region/Some_City") == (
        "## Date and time\n\nIt's Friday 6 November 2026, 12:02 AM in Some City "
        "(Region/Some_City) as this call starts."
    )
    assert the_time(now, "Region/Sub/Other").endswith(
        "in Other (Region/Sub/Other) as this call starts."
    )
    assert the_time(now, "").endswith("12:02 AM as this call starts.")

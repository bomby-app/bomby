from pathlib import Path

from call_options import CallOptions
from harnesses import HARNESSES
from job import Line
from project import Project
from tools import agents_note
from voice_prompt import PROMPTS, voice_instructions

VOICE = PROMPTS["sharp"]

AGENTS = [HARNESSES["claude"]]


def project(instructions: str = "") -> Project:
    return Project(name="samba", folders=(Path.home(),), instructions=instructions)


def test_a_plain_call_gets_the_prompt_and_its_agents() -> None:
    text = voice_instructions(project(), CallOptions(voice="Kore"), AGENTS)

    assert text == f"{VOICE}\n\n{agents_note(AGENTS)}"


def test_a_named_user_comes_before_the_agents() -> None:
    text = voice_instructions(
        project(), CallOptions(voice="Kore", user_name="Sam"), AGENTS
    )

    assert text == (
        f"{VOICE}\n\n## The user\n\nYou're talking to Sam. Address the user by their "
        f"name when needed.\n\n{agents_note(AGENTS)}"
    )


def test_the_project_context_follows_the_agents() -> None:
    text = voice_instructions(
        project("A music app."), CallOptions(voice="Kore"), AGENTS
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
            project(), CallOptions(voice="Kore", tone=tone), AGENTS
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

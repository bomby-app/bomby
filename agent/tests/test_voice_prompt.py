from datetime import UTC, datetime
from pathlib import Path

from call_options import CallOptions
from harnesses import HARNESSES
from job import Line
from project import Project
from sections import PLAIN
from tools import agents_note
from voice_prompt import PROMPTS, local_zone, the_time, voice_instructions
from voice_providers import PROVIDERS, RIME

NOW = datetime(2026, 11, 6, 0, 2, tzinfo=UTC)
# Gemini's tone prompt, then when and where the call starts.
VOICE = f"{PROMPTS['gemini', 'sharp']}\n\n{the_time(NOW, local_zone())}"
TONES = ("sharp", "chatty", "playful")
# Where each provider's shared rules start; everything from there is word for word.
RULES = {"gemini": "## Non-negotiable rules", "rime": "Whatever happens in the call"}

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


def test_each_provider_and_tone_gets_its_own_prompt() -> None:
    for provider in PROVIDERS.values():
        for tone in TONES:
            options = CallOptions(voice="v", provider=provider, tone=tone)
            text = voice_instructions(project(), options, AGENTS, now=NOW)
            assert text.startswith(PROMPTS[provider.id, tone])
    assert len(set(PROMPTS.values())) == len(PROVIDERS) * len(TONES)


def test_every_tone_keeps_its_providers_rules_and_sections() -> None:
    def rules(prompt: str, provider: str) -> str:
        return prompt[prompt.index(RULES[provider]) :]

    def headings(prompt: str) -> list[str]:
        return [line for line in prompt.splitlines() if line.startswith("## ")]

    assert set(RULES) == set(PROVIDERS)
    for provider in PROVIDERS:
        sharp = PROMPTS[provider, "sharp"]
        for tone in ("chatty", "playful"):
            assert rules(PROMPTS[provider, tone], provider) == rules(sharp, provider)
            assert headings(PROMPTS[provider, tone]) == headings(sharp)


def test_rime_hears_plain_sentences_only() -> None:
    # Prism speaks in the style its prompt is written in, so nothing in it is Markdown.
    options = CallOptions(
        voice="aurora",
        provider=RIME,
        user_name="Sam",
        history=(Line("user", "fix the login"), Line("agent", "Done.")),
    )
    text = voice_instructions(project("A music app."), options, AGENTS, "Likes tea.")

    for mark in ("#", "`", "*", "\n- "):
        assert mark not in text
    assert f"{agents_note(AGENTS, PLAIN)}\n\nThe user's description" in text
    assert "claude (Claude)" in text


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

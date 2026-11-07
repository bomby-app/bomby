from datetime import UTC, datetime
from pathlib import Path

from call_options import CallOptions
from extensions import CallExtensions, ExtensionContext
from extensions.todos import TODOS_EXTENSION
from harnesses import HARNESSES
from job import Line
from project import Project
from sections import MARKDOWN, PLAIN, Style
from tools import agents_note
from voice_prompt import (
    PROMPTS,
    backend_instructions,
    local_zone,
    the_time,
    voice_instructions,
)
from voice_providers import GEMINI, OPENAI, PROVIDERS, RIME

NOW = datetime(2026, 11, 6, 0, 2, tzinfo=UTC)
# Gemini's tone prompt, then when and where the call starts.
VOICE = f"{PROMPTS['gemini', 'sharp']}\n\n{the_time(NOW, local_zone())}"
TONES = ("sharp", "chatty", "playful")
# Where each provider's shared rules start; everything from there is word for word.
RULES = {
    "gemini": "## Non-negotiable rules",
    "openai": "Interruption policy:",
    "rime": "Whatever happens in the call",
}

AGENTS = [HARNESSES["claude"]]


def project(instructions: str = "") -> Project:
    return Project(name="samba", folders=(Path.home(),), instructions=instructions)


PROJECT = (
    "## Project\n\nThis call works on the project samba, in the user's home folder. "
    'When the user says "the project", they mean this one.'
)


def test_a_plain_call_gets_the_prompt_its_agents_and_the_project() -> None:
    text = voice_instructions(project(), CallOptions(voice="Kore"), AGENTS, now=NOW)

    assert text == f"{VOICE}\n\n{agents_note(AGENTS)}\n\n{PROJECT}"


def test_a_named_user_comes_before_the_agents() -> None:
    text = voice_instructions(
        project(), CallOptions(voice="Kore", user_name="Sam"), AGENTS, now=NOW
    )

    assert text == (
        f"{VOICE}\n\n## The user\n\nYou're talking to Sam. Address the user by their "
        f"name when needed.\n\n{agents_note(AGENTS)}\n\n{PROJECT}"
    )


def test_the_project_names_its_folders_and_carries_its_description(
    tmp_path: Path,
) -> None:
    (tmp_path / "api").mkdir()
    (tmp_path / "site").mkdir()
    samba = Project(
        name="samba",
        folders=(tmp_path / "api", tmp_path / "site"),
        instructions="A music app.",
    )

    text = voice_instructions(samba, CallOptions(voice="Kore"), AGENTS, now=NOW)

    expected = (
        "## Project\n\nThis call works on the project samba, in the folders api and "
        + 'site. When the user says "the project", they mean this one.\n\n'
        + "The user's description of it:\n\nA music app."
    )
    assert text.endswith(expected)


def test_a_resumed_call_ends_with_the_previous_conversation() -> None:
    options = CallOptions(
        voice="Kore",
        history=(Line("user", "fix the login"), Line("agent", "Done.")),
    )

    text = voice_instructions(project("A music app."), options, AGENTS)

    assert text.index("## Project") < text.index("## Previous conversation")
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
    assert f"{agents_note(AGENTS, PLAIN)}\n\nThis call works on the project" in text
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


def test_only_a_provider_that_delegates_briefs_a_backend() -> None:
    for chosen in (GEMINI, RIME):
        options = CallOptions(voice=chosen.default_voice, provider=chosen)
        assert backend_instructions(project(), options, AGENTS, now=NOW) == ""

    options = CallOptions(voice="gleam", provider=OPENAI, user_name="Sam")
    backend = backend_instructions(project("A music app."), options, AGENTS, now=NOW)

    assert backend.startswith("# Working behind Bomby")
    # The backend picks the agent by id, and knows the project.
    assert f"\n\n{agents_note(AGENTS)}\n\n" in backend
    assert "## Project" in backend
    assert backend.endswith("A music app.")
    # It writes the coding agents' tasks: the user's name stays with the voice.
    assert "Sam" not in backend


def test_gpt_live_hears_its_persona_and_plain_sections() -> None:
    options = CallOptions(
        voice="gleam",
        provider=OPENAI,
        user_name="Sam",
        history=(Line("user", "fix the login"), Line("agent", "Done.")),
    )
    text = voice_instructions(project("A music app."), options, AGENTS, "Likes tea.")

    for mark in ("#", "`", "*"):
        assert mark not in text
    for policy in ("Backchannel policy:", "Interruption policy:", "Delegation policy:"):
        assert policy in text
    # It can't call recall itself, so it asks its backend.
    assert "recall_about_user" not in text
    assert "generate <|SpawnThinking|> to look up anything else" in text
    assert text.endswith("User: fix the login\nYou: Done.")


def test_the_calls_extensions_add_their_notes_after_the_project() -> None:
    class NoBridge:
        async def call(self, method: str, payload: object) -> None:
            raise AssertionError(f"{method} {payload}")

    def todos(style: Style) -> CallExtensions:
        return CallExtensions.for_call({"todos": {}}, NoBridge(), style)

    text = voice_instructions(
        project(), CallOptions(voice="Kore"), AGENTS, now=NOW, extensions=todos(PLAIN)
    )
    assert text.startswith(
        f"{VOICE}\n\n{agents_note(AGENTS)}\n\n{PROJECT}\n\n## To-dos"
    )

    # GPT-Live's backend calls the tools, so it hears the note in its own style too.
    options = CallOptions(voice="gleam", provider=OPENAI)
    backend = backend_instructions(
        project(), options, AGENTS, now=NOW, extensions=todos(MARKDOWN)
    )
    assert backend.endswith(TODOS_EXTENSION.note(ExtensionContext(NoBridge())))

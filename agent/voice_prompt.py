"""The voice model's instructions for one call: the voice provider's prompt for the
user's tone (`prompts/<provider>/sharp.md`, `chatty.md` or `playful.md`), then what this
call adds, in the provider's style (`sections.py`). Each added section is left out when
it has nothing to say."""

import os
from datetime import datetime
from pathlib import Path

from call_options import TONES, CallOptions, Tone
from harnesses.harness import Harness
from job import Line, Speaker
from project import Project
from sections import MARKDOWN, Style, join
from tools import agents_note
from voice_providers import PROVIDERS

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
# Each provider's own tone prompts, by provider id and tone: each model is prompted for
# how it behaves (owner, 2026-11-06).
PROMPTS: dict[tuple[str, Tone], str] = {
    (p, t): (PROMPTS_DIR / p / f"{t}.md").read_text().rstrip()
    for p in PROVIDERS
    for t in TONES
}

SPEAKER_LABEL: dict[Speaker, str] = {"user": "User", "agent": "You"}


def remembered_note(style: Style) -> str:
    return (
        "From earlier conversations with the user. Each fact says when it held true. Use "
        f"what helps, and look up anything else with {style.code('recall_about_user')}."
    )


RESUME_NOTE = (
    "You're picking up an earlier conversation with the user; its last lines are "
    "below. Carry on as if it never stopped. The agents don't remember it, though "
    "anything they did then is still done, so when you hand off a follow-up, tell "
    "the agent what it needs to know."
)


def voice_instructions(
    project: Project,
    options: CallOptions,
    agents: list[Harness],
    remembered: str = "",
    now: datetime | None = None,
) -> str:
    style = options.provider.prompt_style
    return join(
        PROMPTS[options.provider.id, options.tone],
        the_time(now or datetime.now().astimezone(), local_zone(), style),
        the_user(options.user_name, style),
        what_you_remember(remembered, style),
        agents_note(agents, style),
        project_context(project, style),
        previous_conversation(options.history, style),
    )


def local_zone() -> str:
    """The Mac's IANA time zone ("Region/City"), from /etc/localtime; "" if it can't tell."""
    _, found, zone = os.path.realpath("/etc/localtime").partition("zoneinfo/")
    return zone if found else ""


def the_time(now: datetime, zone: str, style: Style = MARKDOWN) -> str:
    """When the call starts, where the user is."""
    hour = now.strftime("%I").lstrip("0")
    when = f"{now:%A} {now.day} {now:%B %Y}, {hour}:{now:%M %p}"
    where = f" in {zone.rsplit('/', 1)[-1].replace('_', ' ')} ({zone})" if zone else ""
    return style.section("Date and time", f"It's {when}{where} as this call starts.")


def the_user(name: str, style: Style = MARKDOWN) -> str:
    """Who the user is, if they said what to call them."""
    if not name:
        return ""
    return style.section(
        "The user",
        f"You're talking to {name}. Address the user by their name when needed.",
    )


def what_you_remember(remembered: str, style: Style = MARKDOWN) -> str:
    """What memory across calls knows about the user, if it knows anything yet."""
    if not remembered:
        return ""
    return style.section(
        "What you remember",
        join(
            remembered_note(style),
            remembered,
        ),
    )


def project_context(project: Project, style: Style = MARKDOWN) -> str:
    """What the user wrote about the project, if anything."""
    if not project.instructions:
        return ""
    return style.section(
        "Project context",
        join(
            "The user's description of the project this call works on:",
            project.instructions,
        ),
    )


def previous_conversation(history: tuple[Line, ...], style: Style = MARKDOWN) -> str:
    """The last lines of the call this one resumes, if it resumes one."""
    if not history:
        return ""
    lines = "\n".join(f"{SPEAKER_LABEL[l.role]}: {l.text}" for l in history)
    return style.section("Previous conversation", join(RESUME_NOTE, lines))

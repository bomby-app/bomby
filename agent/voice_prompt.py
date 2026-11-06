"""The voice model's instructions for one call: the prompt for the user's tone
(`prompts/sharp.md`, `chatty.md` or `playful.md`), then what this call adds. Each added
section is left out when it has nothing to say."""

import os
from datetime import datetime
from pathlib import Path

from call_options import TONES, CallOptions, Tone
from harnesses.harness import Harness
from job import Line, Speaker
from project import Project
from sections import join, section
from tools import agents_note

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
PROMPTS: dict[Tone, str] = {
    t: (PROMPTS_DIR / f"{t}.md").read_text().rstrip() for t in TONES
}

SPEAKER_LABEL: dict[Speaker, str] = {"user": "User", "agent": "You"}
REMEMBERED_NOTE = (
    "From earlier conversations with the user. Each fact says when it held true. Use "
    "what helps, and look up anything else with `recall_about_user`."
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
    return join(
        PROMPTS[options.tone],
        the_time(now or datetime.now().astimezone(), local_zone()),
        the_user(options.user_name),
        what_you_remember(remembered),
        agents_note(agents),
        project_context(project),
        previous_conversation(options.history),
    )


def local_zone() -> str:
    """The Mac's IANA time zone ("Region/City"), from /etc/localtime; "" if it can't tell."""
    _, found, zone = os.path.realpath("/etc/localtime").partition("zoneinfo/")
    return zone if found else ""


def the_time(now: datetime, zone: str) -> str:
    """When the call starts, where the user is."""
    hour = now.strftime("%I").lstrip("0")
    when = f"{now:%A} {now.day} {now:%B %Y}, {hour}:{now:%M %p}"
    where = f" in {zone.rsplit('/', 1)[-1].replace('_', ' ')} ({zone})" if zone else ""
    return section("Date and time", f"It's {when}{where} as this call starts.")


def the_user(name: str) -> str:
    """Who the user is, if they said what to call them."""
    if not name:
        return ""
    return section(
        "The user",
        f"You're talking to {name}. Address the user by their name when needed.",
    )


def what_you_remember(remembered: str) -> str:
    """What memory across calls knows about the user, if it knows anything yet."""
    if not remembered:
        return ""
    return section(
        "What you remember",
        join(
            REMEMBERED_NOTE,
            remembered,
        ),
    )


def project_context(project: Project) -> str:
    """What the user wrote about the project, if anything."""
    if not project.instructions:
        return ""
    return section(
        "Project context",
        join(
            "The user's description of the project this call works on:",
            project.instructions,
        ),
    )


def previous_conversation(history: tuple[Line, ...]) -> str:
    """The last lines of the call this one resumes, if it resumes one."""
    if not history:
        return ""
    lines = "\n".join(f"{SPEAKER_LABEL[l.role]}: {l.text}" for l in history)
    return section("Previous conversation", join(RESUME_NOTE, lines))

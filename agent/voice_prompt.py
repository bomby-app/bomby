"""The voice model's instructions for one call: `prompts/voice.md`, then what this call
adds. Each added section is left out when it has nothing to say."""

from pathlib import Path

from call_options import CallOptions, Line
from harnesses.harness import Harness
from job import Speaker
from project import Project
from sections import join, section
from tools import agents_note

VOICE = (Path(__file__).resolve().parent / "prompts" / "voice.md").read_text().rstrip()

SPEAKER_LABEL: dict[Speaker, str] = {"user": "User", "agent": "You"}
RESUME_NOTE = (
    "You're picking up an earlier conversation with the user; its last lines are "
    "below. Carry on as if it never stopped. The agents don't remember it, though "
    "anything they did then is still done, so when you hand off a follow-up, tell "
    "the agent what it needs to know."
)


def voice_instructions(
    project: Project, options: CallOptions, agents: list[Harness]
) -> str:
    return join(
        VOICE,
        the_user(options.user_name),
        agents_note(agents),
        project_context(project),
        previous_conversation(options.history),
    )


def the_user(name: str) -> str:
    """Who the user is, if they said what to call them."""
    if not name:
        return ""
    return section(
        "The user",
        f"You're talking to {name}. Address the user by their name when needed.",
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
    lines = "\n".join(f"{SPEAKER_LABEL[l.speaker]}: {l.text}" for l in history)
    return section("Previous conversation", join(RESUME_NOTE, lines))

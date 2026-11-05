import asyncio
import json
from pathlib import Path

import pytest

from call_options import CallOptions
from harnesses import HARNESSES
from job import read_metadata
from memory import Memory
from project import Project
from voice_prompt import PROMPTS, voice_instructions

AGENTS = [HARNESSES["claude"]]


@pytest.mark.parametrize(
    ("user_id", "environ"),
    [("", {"ZEP_API_KEY": "key"}), ("bomby-1", {}), ("bomby-1", {"ZEP_API_KEY": " "})],
)
def test_memory_is_off_without_a_user_or_a_key(
    user_id: str, environ: dict[str, str]
) -> None:
    assert asyncio.run(Memory.open(user_id, environ)) is None


def test_the_memory_user_comes_from_the_app_or_the_console() -> None:
    fields = read_metadata(
        json.dumps({"memory_user": " bomby-0123 ", "memory_incognito": True})
    )
    options = CallOptions.from_job(fields, {})
    assert options.memory_user == "bomby-0123"
    assert options.memory_incognito
    assert CallOptions.from_job(read_metadata("{}"), {}).memory_user == ""
    console = CallOptions.from_job(None, {"BOMBY_MEMORY_USER": "bomby-console"})
    assert console.memory_user == "bomby-console"


def test_what_is_remembered_follows_the_user_section() -> None:
    project = Project(name="samba", folders=(Path.home(),))
    options = CallOptions(voice="Leda", user_name="Sam")
    plain = voice_instructions(project, options, AGENTS)
    remembered = voice_instructions(
        project, options, AGENTS, "- Sam ships on Fridays (2026-11-01 to now)"
    )

    assert "## What you remember" not in plain
    assert remembered.startswith(PROMPTS["sharp"])
    assert remembered.index("## The user") < remembered.index("## What you remember")
    assert "Sam ships on Fridays" in remembered


def test_only_a_call_with_memory_can_recall() -> None:
    from acp_client import CallRunners
    from agent import Assistant
    from job import JobMetadata

    runners = CallRunners.for_job(JobMetadata(folders=(Path.home(),)))
    options = CallOptions(voice="Leda")

    def names(assistant: Assistant) -> list[str]:
        return [getattr(tool, "id", "") for tool in assistant.tools]

    assert "recall_about_user" not in names(Assistant(options, runners))
    assert "recall_about_user" in names(Assistant(options, runners, remembers=True))
    # Every call can search the web with Gemini's own Google Search.
    assert "gemini_google_search" in names(Assistant(options, runners))


def test_a_call_that_saves_nothing_never_writes() -> None:
    class NoZep:
        """Fails any request, so a write would show."""

        def __getattr__(self, name: str) -> object:
            raise AssertionError(f"wrote through {name}")

    memory = Memory(NoZep(), "bomby-1", "user-uuid", None)  # pyright: ignore[reportArgumentType]
    asyncio.run(memory._write("my son loves strawberry", None))  # pyright: ignore[reportPrivateUsage]

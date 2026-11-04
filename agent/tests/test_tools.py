from typing import get_args

from harnesses import CLAUDE_CODE, HARNESSES, OMP, OPENCODE, AgentName
from tools import agents_note


def test_start_task_offers_exactly_the_known_harnesses() -> None:
    assert set(get_args(AgentName)) == set(HARNESSES)


def test_the_agents_note_lists_what_is_installed_with_claude_first() -> None:
    note = agents_note([CLAUDE_CODE, OPENCODE, OMP])

    assert "`claude` (Claude), `opencode` (OpenCode) and `omp` (omp)" in note
    assert "Use `claude` unless" in note


def test_without_claude_the_first_installed_agent_is_the_default() -> None:
    assert "Use `opencode` unless" in agents_note([OPENCODE])


def test_with_no_agents_the_note_says_work_cant_start() -> None:
    assert "can't start" in agents_note([])

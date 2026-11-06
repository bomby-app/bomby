"""`start_task`: the voice model's one way to hand work to an agent (a harness).

The agents are defined in `harnesses/`; running them (adapter, sessions, steering) is
`acp_client/`'s job.
"""

import asyncio

from livekit.agents import RunContext
from livekit.agents.llm import ToolError, ToolFlag, function_tool

from acp_client import session_name
from call import Call
from harnesses import DEFAULT_AGENT, HARNESSES, AgentName, Harness
from sections import MARKDOWN, Style


@function_tool(flags=ToolFlag.CANCELLABLE)
async def start_task(
    context: RunContext[Call], task: str, session: str, agent: AgentName
) -> str:
    """Hand a task to an agent that works on this computer, with full access to its
    files, shell, git and the web. It runs in the background and can take minutes; its
    final report arrives as this tool's result.

    Invoke this when the user asks for anything that needs real work: reading or changing
    files, running commands, building or fixing something, researching, organizing,
    writing. Do not invoke it for small talk, for questions you can answer from the
    conversation, or to ask the user something.

    Work is organized in named sessions. Each session is one conversation with the agent
    that remembers everything it did in this call; sessions run in parallel. A task sent to
    a session that is still working reaches it mid-task and returns when that task ends,
    beside its result, which covers both; with an agent that can't take it mid-task, it
    waits and runs next as a task of its own. Every result means that work is finished.

    Args:
        task: What the user wants, with every detail they gave, as one clear request. The
            agent cannot hear this conversation, but a session remembers its own work.
        session: A short name for the piece of work, like "landing-page". Reuse it for
            follow-ups and changes to that work; pick a new name for unrelated work.
        agent: Which agent does the work, from the ones listed for this call under
            Agents. Use the default there unless the user names another.
    """
    harness = HARNESSES.get(agent)
    if harness is None:
        raise ToolError(f"There's no agent called {agent}.")
    runner = context.userdata.runners.get(harness)
    board = context.userdata.board
    name = session_name(session)
    who = harness.short_name
    if runner.is_busy(name) and runner.can_steer:
        await context.update(
            f"Sent to {who} mid-task, in session {name}: {task}. It joins the task that's "
            + "running, and the result comes when that task is done."
        )
    elif runner.is_busy(name):
        await context.update(
            f"{who} is still busy in session {name}, so this waits and runs next as a "
            + f"task of its own, with its own result: {task}"
        )
    else:
        await context.update(f"{who} has started on this, in session {name}: {task}")
    # Recorded before anything can be cancelled, so the cleanup below always finds it. A
    # busy session takes it once its running task ends (or at once, when it's steered in).
    id = board.add(harness, name, task, "queued" if runner.is_busy(name) else "working")

    async def started() -> None:
        await board.start(id)

    try:
        await board.publish()
        turn = await runner.run(task, name, on_start=started)
    except asyncio.CancelledError:
        await board.finish(id, "stopped")
        raise
    except Exception:
        await board.finish(id, "failed")
        raise
    await board.finish(id, "added" if turn.steered else "done")
    return turn.text


def agents_note(
    available: list[Harness], style: Style = MARKDOWN, agents_off: bool = False
) -> str:
    """The prompt's Agents section for one call: which agents `start_task` can use, and the
    default."""
    if agents_off:
        return style.section(
            "Agents",
            (
                "The user turned agents off for this project, so work can't start on "
                "this call. You can still talk. When the user asks for work, tell them "
                "briefly they can turn agents on in the project's settings, and the next "
                "call picks it up. Never pretend a task started."
            ),
        )
    if not available:
        supported = ", ".join(h.short_name for h in HARNESSES.values())
        return style.section(
            "Agents",
            (
                "No coding agent is ready on this computer yet, so work can't "
                "start on this call. You can still talk. When the user asks for work, or "
                "early in the call, tell them kindly and briefly: you need one of the agents "
                f"Bomby supports ({supported}) installed and signed in. Suggest Claude Code "
                "as a good first one. They install it from its own page, through Settings, "
                "Agents in Bomby, and the next call picks it up. Never pretend a task started."
            ),
        )
    names = [f"{style.code(h.id)} ({h.short_name})" for h in available]
    listed = (
        names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" and {names[-1]}"
    )
    default = next((h for h in available if h.id == DEFAULT_AGENT), available[0])
    return style.section(
        "Agents",
        (
            f"The agents you can use on this call: {listed}. Use {style.code(default.id)} "
            "unless the user asks for another one by name."
        ),
    )

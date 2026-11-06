import asyncio
import logging
import os
from typing import override

from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli

import dev_env
import lifeline
from acp_client import CallRunners
from call import Call
from call_options import CallOptions
from job import read_metadata
from memory import ATTRIBUTE as MEMORY_ATTRIBUTE
from memory import UNAVAILABLE, Memory, MemoryUnavailable
from memory import notify as notify_memory
from task_board import TaskBoard
from tools import ALL_TOOLS, MEMORY_TOOLS
from voice_prompt import local_zone, voice_instructions

dev_env.load()

logger = logging.getLogger("bomby")


class Assistant(Agent):
    def __init__(
        self,
        options: CallOptions,
        runners: CallRunners,
        remembers: bool = False,
        remembered: str = "",
    ) -> None:
        self._resumed: bool = options.resumed
        instructions = voice_instructions(
            runners.project, options, runners.available, remembered
        )
        # Bomby's tools, the voice provider's own, then recall for calls that remember.
        tools = [
            *ALL_TOOLS,
            *options.provider.tools(options.options),
            *(MEMORY_TOOLS if remembers else []),
        ]
        # LiveKit's own signatures are partially untyped; the ignores below are theirs.
        super().__init__(  # pyright: ignore[reportUnknownMemberType]
            instructions=instructions, tools=tools
        )

    @override
    async def on_enter(self) -> None:
        greeting = (
            # Neutral, so the tone prompt decides how.
            "Welcome the user back and pick up where you left off."
            if self._resumed
            else "Greet the user."
        )
        _ = self.session.generate_reply(instructions=greeting)  # pyright: ignore[reportUnknownMemberType]


# One user, one call at a time: keep one job process warm instead of the default pool
# (livekit-agents warms several in production mode; 17 on this Mac, each a full Python).
# Its health check server listens on this machine only, on any free port, so it never
# clashes with another worker or shows up on the network.
server = AgentServer(num_idle_processes=1, host="127.0.0.1", port=0)

# Explicit dispatch: the app names this agent in each call's token, with the project in
# the dispatch metadata. Rooms without it get no agent.
AGENT_NAME = "bomby"


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    # A call works on one project, set in the dispatch metadata by the app. Each harness
    # the app found gets one ACP process per call, started on its first task, to
    # run its named sessions. Shutting the job down closes every session and process.
    job = read_metadata(ctx.job.metadata)
    runners = CallRunners.for_job(job)
    # The voice model, its voice and, on a resumed call, the conversation so far.
    options = CallOptions.from_job(job, os.environ)
    model_name = options.provider.model
    ctx.log_context_fields = {"room": ctx.room.name, "model": model_name}
    logger.info("using %s, options %s", model_name, options.options)
    logger.info(
        "project %s in %s, agents %s, voice %s, tone %s, %d earlier lines",
        runners.project.name,
        ", ".join(str(f) for f in runners.project.folders),
        ", ".join(h.id for h in runners.available) or "none",
        options.voice,
        options.tone,
        len(options.history),
    )

    # The room's own participant only exists once the session has connected, so it's
    # looked up when a task is published (always after connecting), not here.
    async def publish(attributes: dict[str, str]) -> None:
        await ctx.room.local_participant.set_attributes(attributes)

    # The app shows the user a card; the call goes on either way.
    async def memory_unavailable() -> None:
        await publish({MEMORY_ATTRIBUTE: UNAVAILABLE})

    # Read while the room connects: the voice model's instructions are final once it does.
    connecting = asyncio.create_task(ctx.connect())
    memory: Memory | None = None
    remembered = ""
    unavailable = False
    try:
        memory, remembered = await Memory.open(options, local_zone(), os.environ)
    except MemoryUnavailable:
        unavailable = True
    await connecting
    if unavailable:
        notify_memory(memory_unavailable)
    if memory:
        memory.on_unavailable(memory_unavailable)
    call = Call(runners, TaskBoard(publish), memory, options.provider)
    ctx.add_shutdown_callback(call.aclose)

    # Which audio the agent gets, from whom: the first thing to check on an audio problem.
    def on_track_subscribed(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        logger.info(
            "subscribed to %s (%s) from %s, kind %s",
            publication.source,
            track.kind,
            participant.identity,
            participant.kind,
        )

    _ = ctx.room.on("track_subscribed", on_track_subscribed)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]

    model = options.provider.realtime_model(options.voice, options.options)
    session: AgentSession[Call] = AgentSession(userdata=call, llm=model)

    if memory:
        memory.attach(session)
    assistant = Assistant(options, runners, memory is not None, remembered)
    await session.start(agent=assistant, room=ctx.room)  # pyright: ignore[reportUnknownMemberType]

    # Keeps a provider that closes quiet conversations open until the call ends.
    keeping = asyncio.create_task(options.provider.keep_alive(model))

    async def stop_keeping() -> None:
        _ = keeping.cancel()

    ctx.add_shutdown_callback(stop_keeping)


def main() -> None:
    """Runs the worker's CLI (`start`, `dev`, `console`, ...), from `sys.argv`."""
    lifeline.exit_with_app()
    cli.run_app(server)


if __name__ == "__main__":
    main()

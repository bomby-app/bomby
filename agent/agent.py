import asyncio
import logging
import os
from typing import override

from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli

import dev_env
import lifeline
from acp_client.runner import CallRunners
from call import Call
from call_options import CallOptions
from extensions import CallExtensions
from extensions.bridge import APP_IDENTITY, REFUSED, RoomBridge
from extensions.tokens import SocketTokens
from job import read_metadata
from memory import ATTRIBUTE as MEMORY_ATTRIBUTE
from memory import UNAVAILABLE, Memory, MemoryUnavailable
from memory import notify as notify_memory
from task_board import REQUEST_METHOD, TaskBoard
from tools import ALL_TOOLS, MEMORY_TOOLS
from voice_prompt import backend_instructions, local_zone, voice_instructions
from voice_providers import Tools

dev_env.load()

logger = logging.getLogger("bomby")


class Assistant(Agent):
    def __init__(
        self,
        options: CallOptions,
        instructions: str,
        remembers: bool = False,
        extension_tools: Tools | None = None,
    ) -> None:
        self._resumed: bool = options.resumed
        # Bomby's tools, the voice provider's own, recall for calls that remember, then the
        # call's extensions'.
        tools = [
            *ALL_TOOLS,
            *options.provider.tools(options.options),
            *(MEMORY_TOOLS if remembers else []),
            *(extension_tools or []),
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
    # The voice model, its voice and, on a resumed call, the conversation so far.
    options = CallOptions.from_job(job, os.environ)
    runners = CallRunners.for_job(
        job, short_reports=options.provider.late_result_tokens is not None
    )
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
    board = TaskBoard(publish)
    call = Call(runners, board, memory, options.provider)
    ctx.add_shutdown_callback(call.aclose)

    # The page asks for a task's full request when the user opens it: `bomby.tasks` carries
    # each shortened.
    async def task_request(data: rtc.RpcInvocationData) -> str:
        request = (
            board.request(data.payload)
            if data.caller_identity == APP_IDENTITY
            else None
        )
        if request is None:
            raise rtc.RpcError(REFUSED, "That task isn't kept anymore.")
        return request

    _ = ctx.room.local_participant.register_rpc_method(REQUEST_METHOD, task_request)

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

    # The call's extensions reach the app's page in the room, and the hosted MCP ones get
    # their tokens from the core (`extensions/tokens.py`). Their tools' results go to
    # whichever model calls them: the backend, for a provider that delegates.
    provider = options.provider
    extensions = CallExtensions.for_call(
        job.extensions if job else {},
        RoomBridge(ctx.room),
        provider.tool_style,
        SocketTokens.from_env(),
    )
    logger.info("extensions %s", ", ".join(extensions.ids) or "none")

    # The voice model's instructions and, for a provider that delegates, its backend's.
    instructions = voice_instructions(
        runners.project,
        options,
        runners.available,
        remembered,
        extensions=extensions,
    )
    backend = backend_instructions(
        runners.project, options, runners.available, extensions=extensions
    )
    model = options.provider.realtime_model(options.voice, options.options, backend)
    session: AgentSession[Call] = AgentSession(userdata=call, llm=model)

    if memory:
        memory.attach(session)
    assistant = Assistant(options, instructions, memory is not None, extensions.tools())
    await session.start(agent=assistant, room=ctx.room)  # pyright: ignore[reportUnknownMemberType]

    # Keeps a provider that closes quiet conversations open until the call ends.
    keeping = asyncio.create_task(options.provider.keep_alive(model))

    # Once it stops, the provider ends a quiet call on its own: the log says why.
    def keeping_ended(task: asyncio.Task[None]) -> None:
        if not task.cancelled() and (error := task.exception()) is not None:
            logger.warning("keeping the conversation open stopped: %r", error)

    keeping.add_done_callback(keeping_ended)

    async def stop_keeping() -> None:
        _ = keeping.cancel()

    ctx.add_shutdown_callback(stop_keeping)


def main() -> None:
    """Runs the worker's CLI (`start`, `dev`, `console`, ...), from `sys.argv`."""
    lifeline.exit_with_app()
    cli.run_app(server)


if __name__ == "__main__":
    main()

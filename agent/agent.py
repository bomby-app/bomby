import logging
import os
from typing import override

from google.genai import types
from livekit import rtc
from livekit.agents import NOT_GIVEN, Agent, AgentServer, AgentSession, JobContext, cli
from livekit.plugins import google

import dev_env
import lifeline
from acp_client import CallRunners
from call import Call
from call_options import CallOptions
from job import read_metadata
from task_board import TaskBoard
from tools import ALL_TOOLS
from voice_prompt import voice_instructions

dev_env.load()

logger = logging.getLogger("bomby")

MODELS = {
    "fast": "gemini-3.8-live",
    "thinking": "gemini-3.8-live-extended-thinking",
}
MODEL_KEY = os.getenv("MODEL", "fast")
if MODEL_KEY not in MODELS:
    raise ValueError(f"MODEL must be one of {sorted(MODELS)}, got {MODEL_KEY!r}")
MODEL = MODELS[MODEL_KEY]

# Extended Thinking requires a thinking level (low, medium or high); the server closes the
# session with 1007 without one. gemini-3.8-live rejects one, so send it only for "thinking".
THINKING_LEVELS = ("low", "medium", "high")
THINKING_LEVEL = os.getenv("THINKING_LEVEL", "low")
if THINKING_LEVEL not in THINKING_LEVELS:
    raise ValueError(
        f"THINKING_LEVEL must be one of {THINKING_LEVELS}, got {THINKING_LEVEL!r}"
    )
THINKING_CONFIG = (
    types.ThinkingConfig(thinking_level=types.ThinkingLevel(THINKING_LEVEL.upper()))
    if MODEL_KEY == "thinking"
    else NOT_GIVEN
)

# The language the user speaks. Gemini's native-audio models pick their spoken language
# themselves (no language code), so the prompt holds them to it; the transcription takes a
# hint, which stops noise being written down as Portuguese or Russian (2026-11-04).
LANGUAGE_CODES = ["en-US"]


class Assistant(Agent):
    def __init__(self, options: CallOptions, runners: CallRunners) -> None:
        self._resumed: bool = options.resumed
        instructions = voice_instructions(runners.project, options, runners.available)
        # LiveKit's own signatures are partially untyped; the ignores below are theirs.
        super().__init__(  # pyright: ignore[reportUnknownMemberType]
            instructions=instructions, tools=ALL_TOOLS
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
    ctx.log_context_fields = {"room": ctx.room.name, "model": MODEL}
    logger.info("using model %s", MODEL)

    # A call works on one project, set in the dispatch metadata by the app. Each harness
    # the app found gets one ACP process per call, started on its first task, to
    # run its named sessions. Shutting the job down closes every session and process.
    job = read_metadata(ctx.job.metadata)
    runners = CallRunners.for_job(job)
    # The voice and, on a resumed call, the conversation so far.
    options = CallOptions.from_job(job, os.environ)
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

    call = Call(runners, TaskBoard(publish))
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

    # Everything Gemini gets at connect time is final for the session. The plugin reconnects
    # on a tool change and can only inject later instructions as a conversation turn.
    session: AgentSession[Call] = AgentSession(
        userdata=call,
        llm=google.realtime.RealtimeModel(
            model=MODEL,
            voice=options.voice,
            input_audio_transcription=types.AudioTranscriptionConfig(
                language_codes=LANGUAGE_CODES
            ),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            thinking_config=THINKING_CONFIG,
        ),
    )

    await session.start(agent=Assistant(options, runners), room=ctx.room)  # pyright: ignore[reportUnknownMemberType]


def main() -> None:
    """Runs the worker's CLI (`start`, `dev`, `console`, ...), from `sys.argv`."""
    lifeline.exit_with_app()
    cli.run_app(server)


if __name__ == "__main__":
    main()

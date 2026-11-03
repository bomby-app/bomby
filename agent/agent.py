import logging
import os
from pathlib import Path
from typing import override

from dotenv import load_dotenv
from google.genai import types
from livekit.agents import NOT_GIVEN, Agent, AgentServer, AgentSession, JobContext, cli
from livekit.plugins import google

from tools import ALL_TOOLS
from tools.claude import ClaudeRunner

_ = load_dotenv()

logger = logging.getLogger("claudible")

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

INSTRUCTIONS = (Path(__file__).resolve().parent / "prompts" / "voice.md").read_text()


class Assistant(Agent):
    def __init__(self) -> None:
        # LiveKit's own signatures are partially untyped; the ignores below are theirs.
        super().__init__(instructions=INSTRUCTIONS, tools=ALL_TOOLS)  # pyright: ignore[reportUnknownMemberType]

    @override
    async def on_enter(self) -> None:
        _ = self.session.generate_reply(instructions="Greet the user briefly.")  # pyright: ignore[reportUnknownMemberType]


server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name, "model": MODEL}
    logger.info("using model %s", MODEL)

    # A call works on one project, set in the dispatch metadata by the app. One
    # claude-agent-acp process per call, started on the first task, runs the named Claude
    # sessions. Shutting the job down closes every session and the process.
    claude = ClaudeRunner.from_env(ctx.job.metadata)
    logger.info(
        "project %s in %s",
        claude.project.name,
        ", ".join(str(f) for f in claude.project.folders),
    )
    ctx.add_shutdown_callback(claude.aclose)

    # Everything Gemini gets at connect time is final for the session. The plugin reconnects
    # on a tool change and can only inject later instructions as a conversation turn.
    session: AgentSession[ClaudeRunner] = AgentSession(
        userdata=claude,
        llm=google.realtime.RealtimeModel(
            model=MODEL,
            voice=os.getenv("GEMINI_VOICE", "Charon"),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            thinking_config=THINKING_CONFIG,
        ),
    )

    await session.start(agent=Assistant(), room=ctx.room)  # pyright: ignore[reportUnknownMemberType]


if __name__ == "__main__":
    cli.run_app(server)

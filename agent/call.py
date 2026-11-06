"""What a call's tools share: the runners that drive the agents, the task board the
app's agents panel shows, the call's memory, if it remembers across calls, and its voice
provider."""

import asyncio
from dataclasses import dataclass

from acp_client import CallRunners
from memory import Memory
from task_board import TaskBoard
from voice_providers import GEMINI, VoiceProvider


@dataclass(frozen=True)
class Call:
    runners: CallRunners
    board: TaskBoard
    memory: Memory | None = None
    # The voice model the call talks through, for what only some providers need.
    provider: VoiceProvider = GEMINI

    async def aclose(self) -> None:
        # Side by side: closing the agents mustn't eat the time saving the call needs.
        if self.memory is None:
            await self.runners.aclose()
            return
        closed, _ = await asyncio.gather(
            self.runners.aclose(), self.memory.aclose(), return_exceptions=True
        )
        if isinstance(closed, BaseException):
            raise closed

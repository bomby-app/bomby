"""What a call's tools share: the runners that drive the agents, the task board the
app's agents panel shows, and the call's memory, if it remembers across calls."""

import asyncio
from dataclasses import dataclass

from acp_client import CallRunners
from memory import Memory
from task_board import TaskBoard


@dataclass
class Call:
    runners: CallRunners
    board: TaskBoard
    memory: Memory | None = None

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

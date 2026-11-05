"""What a call's tools share: the runners that drive the agents, the task board the
app's agents panel shows, and the call's memory, if it remembers across calls."""

from dataclasses import dataclass

from acp_client import CallRunners
from memory import Memory
from task_board import TaskBoard


@dataclass(frozen=True)
class Call:
    runners: CallRunners
    board: TaskBoard
    memory: Memory | None = None

    async def aclose(self) -> None:
        await self.runners.aclose()
        if self.memory:
            await self.memory.aclose()

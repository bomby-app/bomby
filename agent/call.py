"""What a call's tools share: the runners that drive the agents, and the task board the
app's agents panel shows."""

from dataclasses import dataclass

from acp_client import CallRunners
from task_board import TaskBoard


@dataclass(frozen=True)
class Call:
    runners: CallRunners
    board: TaskBoard

    async def aclose(self) -> None:
        await self.runners.aclose()

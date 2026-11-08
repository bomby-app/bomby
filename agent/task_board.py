"""The call's tasks, as the app's agents panel shows them: which agent, which session,
what it was asked, and how it's going. Published as one attribute on the agent's own
LiveKit participant (`bomby.tasks`, JSON), which the page reads with `useAgent()`.
LiveKit allows 64 KiB of attributes in all, so only the latest tasks are kept, each
shortened; the page asks for one's full request when the user opens it (`REQUEST_METHOD`)."""

import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from itertools import count
from typing import Literal, final

from harnesses import Harness

logger = logging.getLogger("bomby.task_board")

ATTRIBUTE = "bomby.tasks"
# The page's RPC for a task's full request: the task's id in, its words out.
REQUEST_METHOD = "bomby.tasks.request"
KEEP = 20
TASK_CHARS = 160
# The most of a request one RPC answer carries: LiveKit's limit is 15 KiB each way.
REQUEST_BYTES = 14_000
# How soon the same request again counts as a repeat (`repeat_of`).
REPEAT_MS = 10_000

Status = Literal["queued", "working", "added", "done", "failed", "stopped"]
"""`queued`: waiting for its session's running task to end before the agent starts on it.
`added`: sent to a session that was still working, so it joined that task."""


@dataclass
class Task:
    id: str
    agent: str
    agentName: str
    session: str
    task: str
    status: Status
    startedAt: int
    endedAt: int | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _short(task: str) -> str:
    return task if len(task) <= TASK_CHARS else task[: TASK_CHARS - 1] + "…"


@final
class TaskBoard:
    """Keeps the call's latest tasks and publishes them whenever one starts or ends."""

    def __init__(self, publish: Callable[[dict[str, str]], Awaitable[None]]) -> None:
        self._publish = publish
        self._tasks: list[Task] = []
        # Each kept task's full request, by id: the published text is shortened.
        self._requests: dict[str, str] = {}
        self._ids = count(1)

    @property
    def tasks(self) -> list[Task]:
        return list(self._tasks)

    def request(self, id: str) -> str | None:
        """What the agent was asked in task `id`, word for word, if it's still kept; one
        past `REQUEST_BYTES` is cut there."""
        text = self._requests.get(id)
        if text is None:
            return None
        raw = text.encode()
        if len(raw) <= REQUEST_BYTES:
            return text
        return raw[: REQUEST_BYTES - 3].decode(errors="ignore") + "…"

    def add(
        self, harness: Harness, session: str, task: str, status: Status = "working"
    ) -> str:
        """Records a new task, `working` or `queued`, without publishing it yet (see
        `publish`)."""
        entry = Task(
            id=str(next(self._ids)),
            agent=harness.id,
            agentName=harness.short_name,
            session=session,
            task=_short(task),
            status=status,
            startedAt=_now_ms(),
        )
        self._tasks = [*self._tasks, entry][-KEEP:]
        kept = {t.id for t in self._tasks}
        self._requests = {i: r for i, r in self._requests.items() if i in kept}
        self._requests[entry.id] = task
        return entry.id

    def repeat_of(self, harness: Harness, session: str, task: str) -> Task | None:
        """The same request, word for word, to the same agent and session, not yet started
        or still running, and asked for under `REPEAT_MS` ago, if any. Prism doesn't deduplicate its tool calls, and can
        call one again before the first has run (docs/rime-notes.md#the-plugin)."""
        since = _now_ms() - REPEAT_MS
        return next(
            (
                entry
                for entry in reversed(self._tasks)
                if entry.agent == harness.id
                and entry.session == session
                and self._requests.get(entry.id) == task
                # `added` is set once the task it joined has ended: that's finished.
                and entry.status in ("queued", "working")
                and entry.endedAt is None
                and entry.startedAt >= since
            ),
            None,
        )

    async def start(self, id: str) -> None:
        """A queued task is now being worked on."""
        for entry in self._tasks:
            if entry.id == id and entry.status == "queued":
                entry.status = "working"
                await self.publish()

    async def finish(self, id: str, status: Status) -> None:
        for entry in self._tasks:
            if entry.id == id:
                entry.status, entry.endedAt = status, _now_ms()
        await self.publish()

    async def publish(self) -> None:
        """Sends the latest tasks to the app."""
        payload = json.dumps([asdict(t) for t in self._tasks], ensure_ascii=False)
        try:
            await self._publish({ATTRIBUTE: payload})
        # The panel is a view: a failed update never stops the work.
        except (RuntimeError, ConnectionError, OSError) as e:
            logger.warning("couldn't publish the task list: %s", e)

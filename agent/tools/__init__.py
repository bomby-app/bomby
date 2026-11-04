from livekit.agents.llm import Tool, Toolset

from .start_task import agents_note, start_task

# One module per tool; register each one here. Gemini Live gets these once, when the
# session connects, so the list is fixed for the call.
ALL_TOOLS: list[Tool | Toolset] = [start_task]

__all__ = ["ALL_TOOLS", "agents_note", "start_task"]

from livekit.agents.llm import Tool, Toolset

from .recall import recall_about_user
from .start_task import agents_note, start_task

# One module per tool; register each one here. Gemini Live gets these once, when the
# session connects, so the list is fixed for the call. A voice provider's own tools, like
# Gemini's Google Search, come from its definition (`voice_providers/`).
ALL_TOOLS: list[Tool | Toolset] = [start_task]
# Only for calls that remember across conversations.
MEMORY_TOOLS: list[Tool | Toolset] = [recall_about_user]

__all__ = [
    "ALL_TOOLS",
    "MEMORY_TOOLS",
    "agents_note",
    "recall_about_user",
    "start_task",
]

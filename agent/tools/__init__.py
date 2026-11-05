from livekit.agents.llm import Tool, Toolset
from livekit.plugins.google.tools import GoogleSearch

from .recall import recall_about_user
from .start_task import agents_note, start_task

# One module per tool; register each one here. Gemini Live gets these once, when the
# session connects, so the list is fixed for the call.
# Google Search is Gemini's own: it runs on Google's side, so it needs no module here.
ALL_TOOLS: list[Tool | Toolset] = [start_task, GoogleSearch()]
# Only for calls that remember across conversations.
MEMORY_TOOLS: list[Tool | Toolset] = [recall_about_user]

__all__ = [
    "ALL_TOOLS",
    "MEMORY_TOOLS",
    "agents_note",
    "recall_about_user",
    "start_task",
]

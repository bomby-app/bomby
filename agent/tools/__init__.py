from livekit.agents.llm import Tool, Toolset

from .claude import claude

# One module per tool; register each one here.
ALL_TOOLS: list[Tool | Toolset] = [claude]

__all__ = ["ALL_TOOLS", "claude"]

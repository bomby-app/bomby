"""`recall_about_user`: what memory across calls knows, on demand (`memory.py`)."""

from livekit.agents import RunContext
from livekit.agents.llm import function_tool

from call import Call


@function_tool()
async def recall_about_user(context: RunContext[Call], query: str) -> str:
    """Look up what you remember about the user from earlier conversations.

    Invoke this when the user refers to something from a past call, or when knowing their
    history would help and it isn't under What you remember. Do not invoke it for what this
    call already covered.

    Args:
        query: What you want to remember, in plain words.
    """
    memory = context.userdata.memory
    if memory is None:
        return "You don't remember earlier conversations."
    return await memory.recall(query)

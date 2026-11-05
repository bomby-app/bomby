"""The Markdown sections of the prompts built when a call starts: the voice model's
instructions (`voice_prompt.py`) and the coding agents' briefing (`acp_client/runner.py`).
"""


def section(title: str, body: str) -> str:
    """One `## title` section."""
    return f"## {title}\n\n{body}"


def join(*parts: str) -> str:
    """The parts one after another, leaving out empty ones, so an optional section that
    has nothing to say leaves no trace."""
    return "\n\n".join(part for part in parts if part)

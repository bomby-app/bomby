"""The sections of the prompts built when a call starts: the voice model's instructions
(`voice_prompt.py`) and the coding agents' briefing (`acp_client/runner.py`).

The briefing and Gemini's instructions are Markdown. Rime's are plain sentences, since
Prism speaks in the style its prompt is written in (`voice_providers/rime.py`). Anything
that reaches the voice model, in its prompt or a tool's result, is written with the call's
`Style`, never with Markdown of its own.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Style:
    """How a prompt is written: Markdown, with `## title` sections and names in code, or
    plain sentences, where each section opens with its own sentence instead."""

    markdown: bool = True

    def section(self, title: str, body: str) -> str:
        return f"## {title}\n\n{body}" if self.markdown else body

    def code(self, name: str) -> str:
        """A name the model must pass on exactly, like an agent's id."""
        return f"`{name}`" if self.markdown else name

    def item(self, text: str) -> str:
        """One line of a list, like a remembered fact: a bullet, or the line alone."""
        return f"- {text}" if self.markdown else text


MARKDOWN = Style()
PLAIN = Style(markdown=False)


def section(title: str, body: str) -> str:
    """One `## title` section."""
    return MARKDOWN.section(title, body)


def join(*parts: str) -> str:
    """The parts one after another, leaving out empty ones, so an optional section that
    has nothing to say leaves no trace."""
    return "\n\n".join(part for part in parts if part)

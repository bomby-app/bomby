"""Composio: the user's apps through Composio Connect, a hosted MCP server whose
meta-tools find apps, sign in to them and run their tools (docs/mcp-notes.md). The first
use of an app answers with a sign-in link for it."""

from typing import final, override

from sections import join

from .extension import ExtensionContext
from .hosted_mcp import Connect, HostedMcp


@final
class Composio(HostedMcp):
    id = "composio"
    name = "Composio"
    description = (
        "Your apps through Composio: Gmail, GitHub, Notion, Linear and a thousand more."
    )
    connect = Connect(
        mcp_url="https://connect.composio.dev/mcp",
        manage_url="https://connect.composio.dev",
        link_hosts=("composio.dev",),
    )

    @override
    def note(self, context: ExtensionContext) -> str:
        style = context.style
        what = (
            "Composio's tools reach the user's other apps: Gmail, GitHub, Notion, "
            "Linear, Slack, calendars and a thousand more. Use them when the user wants "
            "something read or done in one of those apps, not for work on this "
            "project's code, which goes to an agent. Search for the tool first, then "
            "run it."
        )
        rules = (
            "Reading needs no permission. Before an action that sends, posts, books, "
            "deletes or changes something, say in a few words what it will do and wait "
            "for the user's yes. The first time an app is used, Composio hands you a "
            f"link to sign in to it: open it with {style.code(self.link_tool)}, tell "
            "the user to finish in their browser, and carry on once they say it's done."
        )
        return style.section("Composio", join(what, rules))


COMPOSIO_EXTENSION = Composio()

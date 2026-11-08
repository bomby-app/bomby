"""Zapier: the user's apps through Zapier's hosted MCP server, which finds, enables and
runs Zapier actions with the app connections in the user's Zapier account
(docs/mcp-notes.md). Each successful tool call counts two tasks on the user's plan."""

from typing import final, override

from sections import join

from .extension import ExtensionContext
from .hosted_mcp import Connect, HostedMcp


@final
class Zapier(HostedMcp):
    id = "zapier"
    name = "Zapier"
    description = (
        "Your apps through Zapier: mail, calendar, Slack, sheets and thousands more."
    )
    connect = Connect(
        mcp_url="https://mcp.zapier.com/api/v1/connect",
        manage_url="https://mcp.zapier.com",
        link_hosts=("zapier.com",),
    )

    @override
    def note(self, context: ExtensionContext) -> str:
        style = context.style
        what = (
            "Zapier's tools reach the user's other apps: mail, calendar, Slack, "
            "spreadsheets, CRMs and thousands more. Use them when the user wants "
            "something read or done in one of those apps, not for work on this "
            "project's code, which goes to an agent. Find the action first, then run it."
        )
        rules = (
            "Reading needs no permission. Before an action that sends, posts, books, "
            "deletes or changes something, say in a few words what it will do and wait "
            "for the user's yes. When a tool says an app isn't connected or hands you a "
            f"link, open it with {style.code(self.link_tool)} and tell the user to "
            "finish in their browser. Each action counts against the user's Zapier plan."
        )
        return style.section("Zapier", join(what, rules))


ZAPIER_EXTENSION = Zapier()

import asyncio
import dataclasses
from typing import cast

from acp.client.connection import ClientSideConnection
from acp.schema import SessionConfigOptionSelect, SessionConfigSelectOption

from acp_client.settings import apply, needs_pick
from harnesses import CLAUDE_CODE
from job import Pick

PICK_REQUIRED = dataclasses.replace(CLAUDE_CODE, model_selection_required=True)


def test_a_pick_already_current_holds_even_when_the_agent_doesnt_list_it() -> None:
    # The agent runs a model it doesn't offer (one set outside it, say).
    model = SessionConfigOptionSelect(
        id="model",
        name="Model",
        category="model",
        type="select",
        current_value="unlisted",
        options=[SessionConfigSelectOption(value="m1", name="M1")],
    )
    picks = (Pick("model", "unlisted"),)
    # Nothing is sent for a current pick, so no connection is needed.
    conn = cast(ClientSideConnection, object())

    applied = asyncio.run(apply(conn, "s1", PICK_REQUIRED, [model], picks))

    assert applied.skipped == ()
    assert not needs_pick(PICK_REQUIRED, applied, picks)

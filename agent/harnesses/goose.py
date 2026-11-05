"""goose, which speaks ACP itself: `goose acp` ("Run goose as an ACP agent server on
stdio", goose 1.57.0). It runs on the user's own goose setup: their provider, model and
extensions. Its session modes are `auto` ("Automatically approve tool calls"), `approve`,
`smart_approve` and `chat`; Bomby sets `auto`, so permissions are bypassed. It has no
steering, so a request sent mid-task waits for the running turn. Its models depend on its
`provider` setting, which it lists without a category, so it's named to be pickable.
"""

from .harness import Harness

GOOSE = Harness(
    id="goose",
    short_name="goose",
    program="goose",
    args=("acp",),
    bypass_mode="auto",
    setup_settings=frozenset({"provider"}),
)

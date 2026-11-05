"""An agent's session settings the user can pick: its model and how hard it thinks, plus any
its harness names (goose's provider). Every agent lists them the same way, as
`configOptions` in `session/new`, and takes a change with `session/set_config_option`,
which answers with the whole list again, so a setting that depends on another (goose's
models on its provider) comes back up to date (docs/acp-notes.md#session-settings).

Picking is optional: an agent runs on its own defaults until the user picks something, and
a pick it no longer offers is skipped, leaving that default
(docs/decisions/pick-agent-settings-like-buzz-and-zed.md). The runner applies the picks to
every session it opens; the probe applies them too, to show what a session runs on.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import cast

from acp.client.connection import ClientSideConnection
from acp.schema import (
    SessionConfigOptionBoolean,
    SessionConfigOptionSelect,
    SessionConfigSelectGroup,
)

from harnesses.harness import Harness
from job import JobFields

type ConfigOptions = Sequence[SessionConfigOptionSelect | SessionConfigOptionBoolean]

# What every agent offers to pick, by ACP's own categories. `mode` stays out: Bomby sets the
# mode itself, for permissions.
CATEGORIES = frozenset({"model", "thought_level"})


@dataclass(frozen=True)
class Option:
    """One value a setting can take."""

    value: str
    name: str
    group: str | None = None
    """The heading the agent files it under, if it groups its options."""


@dataclass(frozen=True)
class Setting:
    """A setting the user can pick, as the agent offers it now."""

    id: str
    name: str
    category: str | None
    current: str
    options: tuple[Option, ...]

    def option(self, value: str) -> Option | None:
        return next((o for o in self.options if o.value == value), None)


@dataclass(frozen=True)
class Choice:
    """A value the user picked for one setting."""

    setting: str
    value: str


@dataclass(frozen=True)
class Applied:
    """A session's settings once the picks are applied."""

    settings: tuple[Setting, ...]
    gone: tuple[Choice, ...]
    """Picks the agent no longer offers (a model removed or renamed): skipped, so the
    session keeps the agent's default for them."""


def saved_choices(fields: JobFields) -> dict[str, list[Choice]]:
    """Each agent's picks from the job's metadata (`job.py`), in the order they're applied:
    `{"choices": {"goose": [{"setting": "provider", "value": "openrouter"}]}}`."""
    raw: object = (fields or {}).get("choices", {})
    by_agent = cast(dict[str, object], raw) if isinstance(raw, dict) else None
    if by_agent is None:
        raise ValueError("choices must be an object, by agent id")
    choices: dict[str, list[Choice]] = {}
    for agent, entries in by_agent.items():
        items = cast(list[object], entries) if isinstance(entries, list) else None
        if items is None:
            raise ValueError(f"{agent}'s choices must be a list")
        choices[agent] = [_choice(item) for item in items]
    return choices


def pickable(harness: Harness, options: ConfigOptions | None) -> tuple[Setting, ...]:
    """The settings the user can pick, in the agent's own order, which is also the order
    they're applied in."""
    return tuple(
        _setting(o)
        for o in options or []
        if isinstance(o, SessionConfigOptionSelect)
        and (_category(o) in CATEGORIES or o.id in harness.setup_settings)
    )


async def apply(
    conn: ClientSideConnection,
    session_id: str,
    harness: Harness,
    options: ConfigOptions | None,
    choices: Sequence[Choice],
) -> Applied:
    """Sets each pick on the session, in order, skipping one the agent no longer offers and
    one that's already current."""
    settings = pickable(harness, options)
    gone: list[Choice] = []
    for choice in choices:
        setting = next((s for s in settings if s.id == choice.setting), None)
        if setting is None or setting.option(choice.value) is None:
            gone.append(choice)
            continue
        if setting.current == choice.value:
            continue
        response = await conn.set_config_option(
            config_id=choice.setting, session_id=session_id, value=choice.value
        )
        settings = pickable(harness, response.config_options)
    return Applied(settings, tuple(gone))


def model_name(settings: Sequence[Setting]) -> str | None:
    """The model a session runs, by the name the agent gives it."""
    model = next((s for s in settings if s.category == "model"), None)
    if model is None:
        return None
    chosen = model.option(model.current)
    return chosen.name if chosen else model.current


def _choice(item: object) -> Choice:
    entry = cast(dict[str, object], item) if isinstance(item, dict) else {}
    setting, value = entry.get("setting"), entry.get("value")
    if isinstance(setting, str) and isinstance(value, str):
        return Choice(setting, value)
    raise ValueError(f"not a choice: {item!r}")


def _category(option: SessionConfigOptionSelect) -> str | None:
    # ACP allows custom categories as objects; only the named ones mean anything here.
    return option.category if isinstance(option.category, str) else None


def _setting(option: SessionConfigOptionSelect) -> Setting:
    choices = tuple(
        choice
        for entry in option.options
        for choice in (
            [Option(o.value, o.name, entry.name) for o in entry.options]
            if isinstance(entry, SessionConfigSelectGroup)
            else [Option(entry.value, entry.name)]
        )
    )
    return Setting(
        id=option.id,
        name=option.name,
        category=_category(option),
        current=option.current_value,
        options=choices,
    )

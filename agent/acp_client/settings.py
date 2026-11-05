"""An agent's session settings the user can pick: its model and how hard it thinks, plus any
its harness names (goose's provider). Every agent lists them the same way, as
`configOptions` in `session/new`, and takes a change with `session/set_config_option`,
which answers with the whole list again, so a setting that depends on another (goose's
models on its provider) comes back up to date (docs/acp-notes.md#session-settings).

Picking is optional: an agent runs on its own defaults until the user picks something, and
a pick it no longer offers, or refuses, is skipped, leaving that default
(docs/decisions/pick-agent-settings-like-buzz-and-zed.md). The runner applies the picks to
every session it opens; the probe applies them too, to show what a session runs on.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, cast

from acp import RequestError
from acp.client.connection import ClientSideConnection
from acp.schema import (
    SessionConfigOptionBoolean,
    SessionConfigOptionSelect,
    SessionConfigSelectGroup,
)

from harnesses.harness import Harness
from job import JobFields

logger = logging.getLogger("bomby.acp_client.settings")

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
class Pick:
    """A value the user picked for one setting."""

    setting: str
    value: str


@dataclass(frozen=True)
class Skipped:
    """A pick that didn't apply, so the session keeps the agent's default for it."""

    setting: str
    name: str
    """The setting's name, as the agent gives it ("Model"), or its id if it's gone."""
    value: str
    why: Literal["gone", "refused"]
    """`gone`: the agent no longer offers it (a model removed or renamed). `refused`: it
    offers it but wouldn't take it (a provider with no key, say)."""


@dataclass(frozen=True)
class Applied:
    """A session's settings once the picks are applied."""

    settings: tuple[Setting, ...]
    skipped: tuple[Skipped, ...]

    def holds(self, pick: Pick) -> bool:
        """Whether `pick` was applied, or already current."""
        return not any(
            s.setting == pick.setting and s.value == pick.value for s in self.skipped
        )


def saved_picks(fields: JobFields) -> dict[str, list[Pick]]:
    """Each agent's picks from the job's metadata (`job.py`), in the order they're applied:
    `{"picks": {"goose": [{"setting": "provider", "value": "openrouter"}]}}`."""
    raw: object = (fields or {}).get("picks", {})
    by_agent = cast(dict[str, object], raw) if isinstance(raw, dict) else None
    if by_agent is None:
        raise ValueError("picks must be an object, by agent id")
    picks: dict[str, list[Pick]] = {}
    for agent, entries in by_agent.items():
        items = cast(list[object], entries) if isinstance(entries, list) else None
        if items is None:
            raise ValueError(f"{agent}'s picks must be a list")
        picks[agent] = [_pick(item) for item in items]
    return picks


def pickable(harness: Harness, options: ConfigOptions | None) -> tuple[Setting, ...]:
    """The settings the user can pick, in the agent's own order, which is also the order
    they're applied in."""
    return tuple(
        _setting(o)
        for o in options or []
        if isinstance(o, SessionConfigOptionSelect)
        and (_category(o) in CATEGORIES or o.id in harness.pickable_settings)
    )


async def apply(
    conn: ClientSideConnection,
    session_id: str,
    harness: Harness,
    options: ConfigOptions | None,
    picks: Sequence[Pick],
) -> Applied:
    """Sets each pick on the session, in order, skipping one the agent no longer offers or
    refuses, and one that's already current. A refused pick never fails the session: the
    user can always change it."""
    settings = pickable(harness, options)
    skipped: list[Skipped] = []
    for pick in picks:
        setting = next((s for s in settings if s.id == pick.setting), None)
        if setting is None or setting.option(pick.value) is None:
            name = setting.name if setting else pick.setting
            skipped.append(Skipped(pick.setting, name, pick.value, "gone"))
            continue
        if setting.current == pick.value:
            continue
        try:
            response = await conn.set_config_option(
                config_id=pick.setting, session_id=session_id, value=pick.value
            )
        except RequestError as e:
            logger.warning(
                "%s refused %s %s: %s", harness.id, pick.setting, pick.value, e
            )
            skipped.append(Skipped(pick.setting, setting.name, pick.value, "refused"))
            continue
        settings = pickable(harness, response.config_options)
    return Applied(settings, tuple(skipped))


def model_setting(settings: Sequence[Setting]) -> Setting | None:
    """The setting that picks the session's model, if the agent lists one."""
    return next((s for s in settings if s.category == "model"), None)


def model_name(settings: Sequence[Setting]) -> str | None:
    """The model a session runs, by the name the agent gives it."""
    model = model_setting(settings)
    if model is None:
        return None
    chosen = model.option(model.current)
    return chosen.name if chosen else model.current


def _pick(item: object) -> Pick:
    entry = cast(dict[str, object], item) if isinstance(item, dict) else {}
    setting, value = entry.get("setting"), entry.get("value")
    if isinstance(setting, str) and isinstance(value, str):
        return Pick(setting, value)
    raise ValueError(f"not a pick: {item!r}")


def _category(option: SessionConfigOptionSelect) -> str | None:
    # ACP allows custom categories as objects; only the named ones mean anything here.
    return option.category if isinstance(option.category, str) else None


def _setting(option: SessionConfigOptionSelect) -> Setting:
    picks = tuple(
        pick
        for entry in option.options
        for pick in (
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
        options=picks,
    )

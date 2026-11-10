"""Tests never read the developer's `agent/.env`: importing `agent` would load it into the
environment for every later test, and CI has none."""

from collections.abc import Iterator

import pytest

import dev_env


@pytest.fixture(autouse=True, scope="session")
def no_dotenv() -> Iterator[None]:
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(dev_env, "load", lambda: None)
        yield

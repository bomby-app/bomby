# /// script
# requires-python = ">=3.13"
# ///
"""Bomby's one version number, in every place that has to carry it.

`app/src-tauri/tauri.conf.json` is the source: Tauri builds the app's version from it and the
Release workflow names the release after it. The others can't read it, so they hold a copy:
the Rust crate (Cargo.toml and Cargo.lock), the voice agent's project (pyproject.toml and
uv.lock) and `CLIENT_INFO`, the version Bomby reports to every coding agent over ACP. The
agent is a virtual uv project, never installed, so `importlib.metadata` can't see its version.

    version.py check         fail unless every place says the same as tauri.conf.json
    version.py set X.Y.Z     write X.Y.Z into tauri.conf.json, Cargo.toml and CLIENT_INFO

`just version` runs `set`, then uv and cargo for the rest, then `check` (docs/releasing.md).
"""

import json
import re
import sys
import tomllib
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAURI_CONF = ROOT / "app/src-tauri/tauri.conf.json"
CARGO_TOML = ROOT / "app/src-tauri/Cargo.toml"
CARGO_LOCK = ROOT / "app/src-tauri/Cargo.lock"
PACKAGE_JSON = ROOT / "app/package.json"
PYPROJECT = ROOT / "agent/pyproject.toml"
UV_LOCK = ROOT / "agent/uv.lock"
CLIENT = ROOT / "agent/acp_client/client.py"

# Plain MAJOR.MINOR.PATCH: semver for Tauri and cargo, and already normal for PEP 440, so
# uv writes it as given.
VERSION = re.compile(r"\d+\.\d+\.\d+")
# The line in each file `set` rewrites, the version in group 2.
TAURI_LINE = re.compile(r'^(  "version": ")([^"]*)(",?)$', re.MULTILINE)
CARGO_LINE = re.compile(r'(\A\[package\]\n(?:[^\[\n].*\n|\n)*?version = ")([^"]*)(")')
CLIENT_LINE = re.compile(r'^(CLIENT_INFO = Implementation\(name="bomby", version=")([^"]*)("\))$', re.MULTILINE)


def toml(path: Path) -> dict:
    return tomllib.loads(path.read_text())


def locked(path: Path, name: str) -> str | None:
    return next((p["version"] for p in toml(path)["package"] if p["name"] == name), None)


def in_line(pattern: re.Pattern[str], path: Path) -> str | None:
    match = pattern.search(path.read_text())
    return match.group(2) if match else None


# Where each copy is, and how to read it.
COPIES: dict[str, Callable[[], str | None]] = {
    "app/src-tauri/Cargo.toml": lambda: toml(CARGO_TOML)["package"]["version"],
    "app/src-tauri/Cargo.lock": lambda: locked(CARGO_LOCK, "bomby"),
    "agent/pyproject.toml": lambda: toml(PYPROJECT)["project"]["version"],
    "agent/uv.lock": lambda: locked(UV_LOCK, "bomby-agent"),
    "agent/acp_client/client.py (CLIENT_INFO)": lambda: in_line(CLIENT_LINE, CLIENT),
}


def check() -> int:
    version = json.loads(TAURI_CONF.read_text())["version"]
    wrong = [f"{place} says {found}" for place, read in COPIES.items() if (found := read()) != version]
    # The frontend's package.json carries no version, so it can't drift.
    if "version" in json.loads(PACKAGE_JSON.read_text()):
        wrong.append("app/package.json has a version; leave it out, tauri.conf.json holds it")
    if wrong:
        print(f"tauri.conf.json is {version}, but:", *wrong, sep="\n  ", file=sys.stderr)
        print("Set them all with `just version X.Y.Z`.", file=sys.stderr)
        return 1
    print(f"Every place says {version}.")
    return 0


def rewrite(path: Path, pattern: re.Pattern[str], version: str) -> None:
    text, count = pattern.subn(lambda m: f"{m.group(1)}{version}{m.group(3)}", path.read_text(), count=1)
    if count != 1:
        sys.exit(f"{path.relative_to(ROOT)}: the version line isn't where version.py looks for it")
    path.write_text(text)


def set_version(version: str) -> int:
    if not VERSION.fullmatch(version):
        print(f"{version!r} isn't a version: use MAJOR.MINOR.PATCH, like 0.3.0", file=sys.stderr)
        return 1
    rewrite(TAURI_CONF, TAURI_LINE, version)
    rewrite(CARGO_TOML, CARGO_LINE, version)
    rewrite(CLIENT, CLIENT_LINE, version)
    return 0


def main(args: list[str]) -> int:
    match args:
        case ["check"]:
            return check()
        case ["set", version]:
            return set_version(version)
        case _:
            print(__doc__, file=sys.stderr)
            return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

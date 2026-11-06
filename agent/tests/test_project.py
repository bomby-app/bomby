import json
import os
from pathlib import Path

import pytest

from job import read_metadata
from project import Project


def test_project_comes_from_job_metadata(tmp_path: Path) -> None:
    metadata = json.dumps({"project": "samba", "folders": [str(tmp_path)]})

    project = Project.from_job(read_metadata(metadata), {})

    assert project == Project(name="samba", folders=(tmp_path,))


def test_project_instructions_come_trimmed_from_the_metadata(tmp_path: Path) -> None:
    metadata = json.dumps(
        {"folders": [str(tmp_path)], "instructions": "  A music app.\n"}
    )

    assert Project.from_job(read_metadata(metadata), {}).instructions == "A music app."


def test_project_falls_back_to_the_environment(tmp_path: Path) -> None:
    other = tmp_path / "other"
    other.mkdir()
    environ = {
        "BOMBY_PROJECT": "console",
        "BOMBY_FOLDERS": os.pathsep.join([str(tmp_path), str(other)]),
        "BOMBY_INSTRUCTIONS": "A music app.",
    }

    project = Project.from_job(None, environ)

    assert project.name == "console"
    assert project.cwd == tmp_path
    assert project.extra_folders == [str(other)]
    assert project.instructions == "A music app."


def test_a_project_with_its_agents_off_says_so() -> None:
    metadata = json.dumps({"project": "samba", "agents_off": True})
    assert Project.from_job(read_metadata(metadata), {}).agents_off
    assert not Project.from_job(read_metadata("{}"), {}).agents_off


def test_project_defaults_to_the_home_folder() -> None:
    assert Project.from_job(None, {}) == Project(name="home", folders=(Path.home(),))


@pytest.mark.parametrize(
    ("metadata", "error"),
    [
        ('{"folders": "/tmp"}', "folders\n  Input should be a valid array"),
        ('{"folders": ""}', "folders\n  Input should be a valid array"),
        ('{"folders": ["relative/path"]}', "absolute path"),
        ('{"folders": ["~/Dev"]}', "absolute path"),
        ('{"folders": ["/no/such/folder"]}', "does not exist"),
        ('{"instructions": 3}', "instructions\n  Input should be a valid string"),
    ],
)
def test_bad_project_metadata_is_rejected(metadata: str, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        _ = Project.from_job(read_metadata(metadata), {})

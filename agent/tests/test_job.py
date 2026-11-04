import pytest

from job import read_metadata


def test_reads_the_metadata_object() -> None:
    assert read_metadata('{"project": "samba"}') == {"project": "samba"}


def test_console_runs_have_none() -> None:
    assert read_metadata("") is None
    assert read_metadata("  ") is None


@pytest.mark.parametrize("metadata", ["[]", "3", '"samba"'])
def test_metadata_must_be_an_object(metadata: str) -> None:
    with pytest.raises(ValueError, match="JSON object"):
        _ = read_metadata(metadata)

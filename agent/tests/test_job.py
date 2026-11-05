import pytest

from job import JobMetadata, Line, read_metadata


def test_reads_the_metadata_object() -> None:
    fields = read_metadata(
        '{"project": " samba ", "history": [{"role": "user", "text": "hi"}]}'
    )
    assert fields == JobMetadata(project="samba", history=(Line("user", "hi"),))


def test_null_and_unknown_fields_take_the_defaults() -> None:
    fields = read_metadata('{"agents": null, "voice": null, "theme": "dark"}')
    assert fields == JobMetadata()


def test_console_runs_have_none() -> None:
    assert read_metadata("") is None
    assert read_metadata("  ") is None


@pytest.mark.parametrize("metadata", ["[]", "3", '"samba"'])
def test_metadata_must_be_an_object(metadata: str) -> None:
    with pytest.raises(ValueError, match="job metadata\\n  Input should be an object"):
        _ = read_metadata(metadata)


def test_metadata_must_be_json() -> None:
    with pytest.raises(ValueError, match="Invalid JSON"):
        _ = read_metadata("{")

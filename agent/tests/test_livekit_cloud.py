import pytest

from livekit_cloud import noise_cancellation_for


@pytest.mark.parametrize(
    "url",
    ["wss://my-project-abc123.livekit.cloud", "wss://agent-xyz.livekit.run"],
)
def test_noise_cancellation_is_on_for_livekit_cloud(url: str) -> None:
    assert noise_cancellation_for(url) is not None


@pytest.mark.parametrize(
    "url",
    [
        "ws://127.0.0.1:41000",  # the server on this Mac
        "wss://livekit.example.com",  # a server the user runs
        "wss://livekit.cloud.example.com",
        "",  # `lk agent console`, with no server
    ],
)
def test_noise_cancellation_is_off_anywhere_else(url: str) -> None:
    assert noise_cancellation_for(url) is None

"""What a call gets only on LiveKit Cloud (docs/decisions/livekit-on-this-mac-or-cloud.md).

The app runs calls on the LiveKit server on the user's Mac or on their own; only LiveKit Cloud
has Krisp noise cancellation, so it's on only there. Whether the server is LiveKit Cloud is
decided from `LIVEKIT_URL`, as livekit-agents decides it for its own Cloud-only features
(`utils/misc.py`, `is_cloud`: `*.livekit.cloud` and `*.livekit.run`), so a self-hosted server
gets none either. Every Cloud-only switch lives here.
"""

from livekit import rtc
from livekit.agents.utils.misc import is_cloud
from livekit.plugins import noise_cancellation


def noise_cancellation_for(livekit_url: str) -> rtc.NoiseCancellationOptions | None:
    """Krisp background noise suppression (NC) on LiveKit Cloud, where it's included on every
    plan; none elsewhere, where the page's WebRTC noise suppression is all there is."""
    return noise_cancellation.NC() if is_cloud(livekit_url) else None

"""omp (oh-my-pi), which speaks ACP itself: `omp acp` ("Run omp as an ACP (Agent Client
Protocol) server over stdio", omp 18.16.0). It runs on the user's own omp setup and has no
permission prompts by design. It implements claude-agent-acp's steering extension
(`_session/steering`, advertised as `_meta.steering.supported`), so a request sent mid-task
reaches the running turn.
"""

from .harness import Harness

OMP = Harness(
    id="omp",
    name="omp",
    short_name="omp",
    program="omp",
    args=("acp",),
    # The SDK sends it as `_session/steering`.
    steer_method="session/steering",
)

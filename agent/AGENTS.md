# Voice agent

A LiveKit Agents worker on Gemini 3.8 Live. It talks with the user, hands work to the coding agents over ACP through one tool, `start_task`, and speaks their result when they finish. `just agent` lists its commands.

## Where things are

- `agent.py`: the entrypoint.
- `harnesses/`: one definition per coding agent. To add one, follow [these steps](../docs/decisions/detect-acp-native-agents.md#adding-an-agent).
- `acp_client/`: the ACP client and runner every harness shares (sessions, steering, the briefing).
- `tools/start_task.py`: the voice model's one tool. `task_board.py`: the call's tasks, sent to the app.
- `prompts/`: `voice.md` (Gemini's instructions) and `harness-briefing.md` (what every coding agent is told).
- `tests/`: unit tests, with a fake ACP agent.

## Rules

- Python dependencies only through `uv`.
- A coding agent's output reaches Gemini only as the `start_task` result, never through `session.generate_reply` ([why](../docs/decisions/results-only-as-tool-results.md)).
- `prompts/voice.md` is the owner's. Change it only when asked, and show the exact text. How it's written: [gemini-notes.md](../docs/gemini-notes.md#prompting).
- No secret reaches a coding agent: `child_environment` in `acp_client/runner.py` strips the `.env` keys, the app's keys and each harness's `blocked_env`. Block a new secret the same way.

## Library facts

[acp-notes.md](../docs/acp-notes.md), [livekit-notes.md](../docs/livekit-notes.md), [gemini-notes.md](../docs/gemini-notes.md).

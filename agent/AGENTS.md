# Voice agent

A LiveKit Agents worker on Gemini 3.8 Live. It talks with the user, hands work to the coding agents over ACP through one tool, `start_task`, and speaks their result when they finish. `just agent` lists its commands.

## Where things are

- `agent.py`: the entrypoint. `probe.py`: checks whether the agents the app found are set up, for Settings (`acp_client/probe.py`, [decision](../docs/decisions/check-agent-setup-with-an-acp-probe.md)).
- `bundle.py`: the packaged agent's one program, which `just agent freeze` freezes with PyInstaller into `dist/bomby-agent/` for the app to ship. `bomby-agent start` is the worker, `bomby-agent probe` the probe ([decision](../docs/decisions/ship-the-agent-and-adapter-as-sidecars.md)). `dev_env.py`: loads `.env` for runs from source only; the packaged agent gets its keys from the app.
- `harnesses/`: one definition per coding agent. To add one, follow [these steps](../docs/decisions/detect-acp-native-agents.md#adding-an-agent).
- `adapters/`: the ACP adapters for agents without ACP of their own (Claude Code, Codex), pinned in `package.json`. The app installs them on Set up; `just agent install` builds them into `adapters/bin` for console runs ([decision](../docs/decisions/install-adapters-on-setup.md)).
- `acp_client/`: the ACP client and runner every harness shares (sessions, steering, the briefing). A failing harness reaches the voice as one short line (`not_ready`, `stopped`, `no_report` for a turn with no final message, `no_model_picked` for an agent whose harness requires a model pick and has none); the details go to the log.
- `tools/start_task.py`: the voice model's one tool. At the top level, `call.py`: what a call's tools share (the runners and the task board); `task_board.py`: the call's tasks, sent to the app; `lifeline.py`: stops the worker when the app does; `livekit_cloud.py`: what a call gets only on LiveKit Cloud (Krisp noise cancellation), the one place for such switches.
- `prompts/`: `voice.md` (Gemini's instructions) and `harness-briefing.md` (what every coding agent is told). `voice_prompt.py` adds what each call brings to `voice.md`, and `briefing` in `acp_client/runner.py` adds the project to `harness-briefing.md`; both build their sections with `sections.py`, leaving out the empty ones.
- `project.py`, `call_options.py`: what the app sends with each call, read once from the job's metadata. `job.py`'s `JobMetadata` is its one typed contract (pydantic): a new field is one typed line there.
- `check_frozen.py`: checks a frozen agent runs (`just agent check-frozen`).
- `tests/`: unit tests, with a fake ACP agent.

## Rules

- Python dependencies only through `uv`. PyInstaller is in its own `freeze` group, outside `uv sync`.
- Find bundled files through `__file__`, like `prompts/`; frozen, it points inside the folder. A new data folder also needs `--add-data` in `just agent freeze`.
- A coding agent's output reaches Gemini only as the `start_task` result, never through `session.generate_reply` ([why](../docs/decisions/results-only-as-tool-results.md)).
- `prompts/voice.md` is the owner's. Change it only when asked, and show the exact text. How it's written: [gemini-notes.md](../docs/gemini-notes.md#prompting).
- No secret reaches a coding agent: `child_environment` in `acp_client/runner.py` strips the `.env` keys, the app's keys and each harness's `blocked_env`. Block a new secret the same way.

## Library facts

[acp-notes.md](../docs/acp-notes.md), [livekit-notes.md](../docs/livekit-notes.md), [gemini-notes.md](../docs/gemini-notes.md).

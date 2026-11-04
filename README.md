# claude-livekit

Talk to Claude Code. You speak to a voice agent (LiveKit Agents and Gemini 3.8 Live); it hands real work to a Claude Code session on your machine over ACP and tells you the result when Claude is done. A call works on one project and can run several Claude sessions in parallel, one per piece of work; each remembers what it did during the call.

A desktop app to manage projects and run calls is planned: see [docs/roadmap.md](docs/roadmap.md).

## Setup

```bash
just install                        # lk and claude-agent-acp (mise), agent deps (uv)
claude                              # sign in to Claude Code once, if you haven't
cp agent/.env.example agent/.env    # fill in GOOGLE_API_KEY
```

Claude runs on your Claude plan login. It gets your shell environment minus `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDECODE` and everything in `agent/.env`, and it runs with permissions bypassed: it can reach your whole machine.

## Run

```bash
just agent console          # talk to the agent in the terminal
just agent console-text     # type instead of talking
just agent console-debug    # also dump raw Gemini Live messages
```

Pick the project for a console call in `agent/.env` with `CLAUDE_PROJECT` and `CLAUDE_FOLDERS` (absolute paths, `:`-separated; the first is Claude's working directory). Without them, Claude works from your home folder. Pick the Gemini model with `MODEL` (`fast` is the one to use; see [the model decision](docs/decisions/gemini-3-8-live-not-extended-thinking.md)).

## Develop

```bash
just check    # lint, types, tests in every part: what every change must pass
just          # the repo-wide commands
just agent    # the agent's commands
```

Start with [docs/README.md](docs/README.md).

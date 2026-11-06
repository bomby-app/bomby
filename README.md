<p align="center">
  <img src=".github/assets/cover.jpg" alt="Bomby: stop typing, start talking" width="100%">
</p>

# Bomby

**Stop typing. Start talking.**

Bomby is a desktop app you talk to. Say what you want done, and Bomby hands it to the agent on your computer, keeps the conversation going while it works, and tells you how it went. You can start several things at once, add to a task while it's running, and pick up an earlier call where you left off.

Bomby is in beta and runs on Apple Silicon Macs.

## How it works

1. **You talk.** Start a call on a project. Bomby listens and answers out loud, through the voice model you pick, Gemini Live, OpenAI's GPT-Live or Rime's Prism, over LiveKit. Give the project instructions, and Bomby and your agent know what it is before you say a word.
2. **Your agent works.** Real work goes to an agent installed on your computer, in the project's folders, over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP). Each piece of work gets its own session, and sessions run side by side.
3. **You hear the result.** When the agent finishes, Bomby tells you what happened. The tasks panel in the call shows what each agent is doing.

Every call is saved with its transcript, so you can read it back or resume it later.

## Agents

Bomby finds these on your computer by itself and lists them in Settings > Agents:

| Agent | How Bomby runs it |
| --- | --- |
| [Claude Code](https://claude.com/product/claude-code) | through `claude-agent-acp`, on your own Claude plan |
| [Codex](https://developers.openai.com/codex/cli) | through `codex-acp`, on your own login |
| [OpenCode](https://opencode.ai) | `opencode acp` |
| [goose](https://goose-docs.ai) | `goose acp` |
| [omp](https://github.com/can1357/oh-my-pi) | `omp acp` |

Claude is the default; ask for another one by name ("ask goose to..."). Each agent works with your own setup: your accounts, models and rules.

## What you need

- A Mac with Apple Silicon
- An API key for the voice: [Gemini](https://aistudio.google.com/apikey), [OpenAI](https://platform.openai.com/api-keys) (on a paid tier) or [Rime](https://app.rime.ai/tokens)
- Nothing for LiveKit: calls run on your Mac. Or use your own [LiveKit Cloud](https://cloud.livekit.io) project (the free tier is enough): its URL, API key and API secret
- At least one agent from the list above. No agent yet? Install Claude Code:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

Your keys stay in your macOS keychain. Bomby never sees or stores your agents' logins.

## Run it

Download the DMG from [Releases](https://github.com/bomby-app/bomby/releases), open it and drag Bomby to Applications. Bomby keeps itself up to date from there.

Until the first release is out, or to work on Bomby, run it from source. You need [mise](https://mise.jdx.dev) and [just](https://just.systems).

```bash
just install    # the pinned tools (mise) and every part's dependencies
just app dev    # start the app
```

The first run sets up an agent and your keys; Settings has them all after that. Tell Bomby what to call you under Intro if you like. Add a project with its folders (and, if you want, a few words about it) and start a call.

To see a state your Mac isn't in, without installing or signing out of anything (development builds only):

```bash
just app dev --splash                 # the first-run splash at every launch
just app dev --agents=none            # as if no agent were installed (or --agents=codex,goose)
just app dev --signed-out             # Claude Code signed out, on an empty config folder
just app dev --no-keys                # no LiveKit or voice keys; any you add last for the run
```

### Without the app

You can also talk to the voice agent straight from your terminal, with no app and no LiveKit project:

```bash
cp agent/.env.example agent/.env    # add your GOOGLE_API_KEY
just agent console                  # talk out loud
just agent console-text             # or type
```

## Good to know

- **Agents run with full access.** Permissions are bypassed in every agent, so they can work anywhere on your computer. A project's folders tell an agent where to work; they don't fence it in.
- **Use wired headphones or speakers.** With Bluetooth headphones as the output, the voice can pick itself up and answer itself.
- **Long calls.** Gemini Live sessions are limited in length, and a dropped Prism session doesn't resume; a very long call may drop and need resuming.

## For developers

| Path | What's there |
| --- | --- |
| `app/` | The desktop app: Tauri v2, a React frontend in `src/`, a Rust core in `src-tauri/` |
| `agent/` | The voice agent: Python, LiveKit Agents, and Gemini Live, OpenAI's GPT-Live or Rime's Prism (`voice_providers/`). `harnesses/` defines each agent, `acp_client/` runs them, `tools/` is what the voice can do |
| `docs/` | Architecture, roadmap, decisions and notes on every library we rely on |

```bash
just          # every command
just check    # lint, types and tests in every part: what each change must pass
```

Start with [docs/AGENTS.md](docs/AGENTS.md), then [docs/architecture.md](docs/architecture.md) and [docs/roadmap.md](docs/roadmap.md). Adding another ACP agent is a few lines; see [the decision on detecting agents](docs/decisions/detect-acp-native-agents.md).

Bomby is built on [LiveKit](https://livekit.io), with [Gemini Live](https://ai.google.dev/gemini-api/docs/live), [OpenAI's GPT-Live](https://developers.openai.com/api/docs/guides/live) or [Rime's Prism](https://docs.rime.ai/docs/prism/overview), and works with the agents above. It isn't affiliated with any of them.

## License

The code is [MIT](LICENSE). Bomby™, its wordmark, the Dot Dot logo and the app icons are trademarks and aren't covered by the license: a fork you share needs its own name and brand. See [TRADEMARKS.md](TRADEMARKS.md).

<p align="center">
  <!-- The cover is being redesigned: the new one replaces .github/assets/cover.jpg (docs/brand.md). -->
  <img src=".github/assets/cover.jpg" alt="Bomby: say the word" width="100%">
</p>

<h1 align="center">Bomby</h1>

<p align="center"><b>Say the word.</b></p>

<p align="center">
  <a href="https://github.com/bomby-app/bomby/releases/latest"><img alt="Download for macOS" src="https://img.shields.io/badge/Download_for_macOS-Apple_Silicon-E8FF3A?style=for-the-badge&labelColor=121212"></a>
</p>

<p align="center">
  <a href="https://bomby.app">bomby.app</a> ·
  <a href="https://github.com/bomby-app/bomby/releases/latest">Download</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="docs/architecture.md">How it's built</a>
</p>

Bomby is a Mac app you talk to. Say what you want done, and Bomby hands it to the coding agent already on your computer, keeps the conversation going while it works, and tells you how it went.

Bomby is in beta and runs on Apple Silicon Macs.

## What it does

- **You talk, it answers.** Start a call on a project and say what you want. Bomby listens and answers out loud, through the voice model you pick: Gemini Live, OpenAI's GPT-Live or Rime's Prism.
- **Your agent does the work.** Real work goes to the agent you already use (Claude Code, Codex, OpenCode, goose or omp) with your own login, models and rules.
- **Several things at once.** Each piece of work gets its own agent session, and sessions run side by side. Add to a task while it runs. The call's agents panel shows what each one is doing, and a notification tells you when one finishes while you're elsewhere.
- **See the work as it happens.** Beside a project, panels show its folder's git changes as the agent makes them, its files, terminals of your own, and the project's to-dos, which you and Bomby keep together.
- **It knows your project.** Give a project a few words of instructions, and Bomby and your agent know what it is from the first word. Tell Bomby what to call you, and pick its tone.
- **Pick up where you left off.** Every call is saved with its transcript, to read back or resume. Turn on memory and Bomby remembers you across calls, in your own Zep project.
- **Out of your way.** Bomby lives in the menu bar too: start or end a call from there, and closing the window keeps the call going.

## How it works

1. **You talk.** The voice model hears you and answers, over [LiveKit](https://livekit.io), which runs on your Mac (or in your own LiveKit Cloud project).
2. **Your agent works.** When there's real work, Bomby hands it to an agent on your computer, in the project's folders, over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP).
3. **You hear the result.** When the agent finishes, Bomby tells you what happened in a sentence or two.

## Agents

Bomby finds these on your computer by itself and lists them in Settings, Agents:

| Agent | How Bomby runs it |
| --- | --- |
| [Claude Code](https://claude.com/product/claude-code) | through `claude-agent-acp`, on your own Claude plan |
| [Codex](https://developers.openai.com/codex/cli) | through `codex-acp`, on your own login |
| [OpenCode](https://opencode.ai) | `opencode acp` |
| [goose](https://goose-docs.ai) | `goose acp` |
| [omp](https://github.com/can1357/oh-my-pi) | `omp acp` |

Claude Code is the default; ask for another one by name ("ask goose to..."). A project can limit which agents its calls use.

## Install

1. Download Bomby from [bomby.app](https://bomby.app) or the [latest release](https://github.com/bomby-app/bomby/releases/latest).
2. Open the DMG and drag Bomby to Applications. Bomby is signed and notarized, and keeps itself up to date (Settings, About).
3. Open Bomby. The first run sets up an agent and your keys; Settings has them all after that. Add a project with its folders and start a call.

### What you need

- A Mac with Apple Silicon.
- At least one agent from the list above. No agent yet? Install Claude Code:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

- A key for the voice model you pick: [Gemini](https://aistudio.google.com/apikey), [OpenAI](https://platform.openai.com/api-keys) (on a paid tier) or [Rime](https://app.rime.ai/tokens).
- Nothing for LiveKit: calls run on your Mac. Or use your own [LiveKit Cloud](https://cloud.livekit.io) project (the free tier is enough): its URL, API key and API secret.
- Only for memory across calls: a [Zep](https://app.getzep.com) API key.

## Your keys and your data

- **Keys** stay in your macOS keychain. Each one goes only to its own service.
- **Your voice** goes to the voice model you picked, through LiveKit on your Mac (or your own LiveKit Cloud project).
- **Projects, calls, transcripts and to-dos** stay in a database on your Mac.
- **Memory**, when you turn it on, saves what's said on your calls to your own Zep project. Incognito reads what Bomby remembers and saves nothing.
- **Your agents** run as they always do, with their own logins and providers; Bomby never sees or stores those logins. Your name goes only to the voice model (and Zep, with memory on), never to the coding agents.

Bomby has no servers of its own and adds no analytics. It checks this repository's releases for updates.

## Good to know

- **Agents run with full access.** Permissions are bypassed in every agent, so they can work anywhere on your computer. A project's folders tell an agent where to work; they don't fence it in.
- **Use wired headphones or speakers.** With Bluetooth headphones as the output, the voice can pick itself up and answer itself.
- **Long calls.** Gemini Live sessions are limited in length, and a dropped Prism session doesn't resume; a very long call may drop and need resuming.

## Run from source

You need [mise](https://mise.jdx.dev) and [just](https://just.systems).

```bash
just install    # the pinned tools and every part's dependencies (builds LiveKit's server from source)
just app dev    # start the app
just            # every other command
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the rest: the layout, the checks every change must pass, how to try a state your Mac isn't in, and talking to the voice agent from the terminal.

## Contributing

Bug reports, ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: for anything beyond a small fix, open an issue before the pull request. Found a security problem? See [SECURITY.md](SECURITY.md).

Bomby is built on [LiveKit](https://livekit.io), with [Gemini Live](https://ai.google.dev/gemini-api/docs/live), [OpenAI's GPT-Live](https://developers.openai.com/api/docs/guides/live) or [Rime's Prism](https://docs.rime.ai/docs/prism/overview), and works with the agents above. It isn't affiliated with any of them.

## License

The code is [MIT](LICENSE). Bomby™, its wordmark, logo and mascot, and the app icons are trademarks and aren't covered by the license: a fork you share needs its own name and brand. See [TRADEMARKS.md](TRADEMARKS.md).

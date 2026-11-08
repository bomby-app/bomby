# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately on GitHub instead: the repository's **Security** tab, then **Report a vulnerability** ([how](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)). Say what you found, how to reproduce it, and the Bomby and macOS versions.

You'll get an answer within a week. A fix goes out as a new release, and the advisory is published once people can update; you're credited unless you'd rather not be.

## Supported versions

Only the latest release. Bomby updates itself from Settings, About.

## What counts

In scope, for example:

- A key leaving the keychain other than to its own service, or reaching a coding agent's environment.
- The app's page, or anything in a call, reaching the core's commands it isn't granted, or files outside a project's folders through the panels beside a project.
- Another participant in a call room getting answers meant only for Bomby's agent.
- LiveKit on this Mac reachable from outside the Mac.
- An update installed without a valid signature, or an older release passed off as newer.

Not in scope:

- **What a coding agent does with full access.** Agents run with their permissions bypassed, by design for now ([decision](docs/decisions/bypass-permissions-for-now.md)); the README says so.
- **Bugs in the agents, voice providers, LiveKit or Zep themselves.** Report those to their makers. If Bomby uses one of them unsafely, that's ours.

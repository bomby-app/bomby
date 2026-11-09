# Releasing

How a signed Bomby build is made. The workflow is `.github/workflows/release.yml`; the why is in [the decision](decisions/ship-the-agent-and-adapter-as-sidecars.md). Releases are macOS on Apple Silicon only. Changes that could break packaging are built unsigned first, on their pull request (`.github/workflows/package.yml`).

## How it works

1. **Signing** stamps every program file with the Developer ID certificate and seals the app, so any change breaks the seal. Signed builds use hardened runtime, which blocks risky abilities unless the app holds an entitlement for them. Bomby holds one, the mic (`app/src-tauri/Entitlements.plist`); the agent needs none.
2. **Notarizing** uploads the signed app to Apple's notary service with the App Store Connect API key. Apple scans it automatically (no human review) and returns a ticket, which is stapled to the app and to the DMG.
3. **Gatekeeper** checks the signature and the ticket the first time a user opens the downloaded app. Without both, macOS refuses to open it.
4. **Updates** are signed again, with Bomby's own updater key (separate from Apple's). Installed copies read `latest.json` from the latest published release, download `Bomby.app.tar.gz` and install it only if its signature matches the public key in `tauri.conf.json` and the version signed into it matches the one announced (`requireSignedVersion`, so an old release can't be passed off as new). Settings, About checks once at launch and on Check for updates; installing waits for the user and never cuts off a call: a call that starts during the download holds the update until the user restarts.

The workflow runs on a fresh GitHub macOS machine, thrown away after the job: it imports the certificate into a keychain of its own, builds the LiveKit server from its pinned source (`just livekit build`, which `just app build` runs first), freezes and signs the agent (`just agent freeze`, `just agent sign`), runs `just app build` (Tauri signs, notarizes and staples the app), packs the signed update (`tauri.release.conf.json` turns on `createUpdaterArtifacts`), notarizes and staples the DMG, checks it all as Gatekeeper would, runs the signed agent (`just agent check-frozen`) and the signed server (`--version`), writes `latest.json` and attaches the DMG (by version and again as `Bomby.dmg`, so `https://github.com/bomby-app/bomby/releases/latest/download/Bomby.dmg` always downloads the newest), `Bomby.app.tar.gz` and `latest.json` to a draft release. The key never touches a developer's Mac.

## Secrets

Repository secrets (Settings > Secrets and variables > Actions), set from the machine that holds the signing files:

| Secret | Value | Set with |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | The Developer ID `.p12` (certificate, private key, Apple's G2 intermediate), base64 | `base64 -w0 <file>.p12 \| gh secret set APPLE_CERTIFICATE -R bomby-app/bomby` |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` export password | `gh secret set APPLE_CERTIFICATE_PASSWORD -R bomby-app/bomby` (asks for it) |
| `APPLE_API_KEY` | The App Store Connect API key's Key ID | `gh secret set APPLE_API_KEY -R bomby-app/bomby` |
| `APPLE_API_ISSUER` | The API key's Issuer ID | `gh secret set APPLE_API_ISSUER -R bomby-app/bomby` |
| `APPLE_API_KEY_P8` | The `.p8` file's contents | `gh secret set APPLE_API_KEY_P8 -R bomby-app/bomby < AuthKey_<id>.p8` |
| `TAURI_SIGNING_PRIVATE_KEY` | The updater's private key | `gh secret set TAURI_SIGNING_PRIVATE_KEY -R bomby-app/bomby < bomby-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password | `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R bomby-app/bomby` |

The updater key pair is made once, on the machine that holds the signing files, with `bunx @tauri-apps/cli@2.12.4 signer generate -w bomby-updater.key`. Its public half goes in `plugins.updater.pubkey` in `tauri.conf.json`. Losing the private key means installed copies can never update again: keep it, and its password, with the other signing files.

The signing identity is read from the certificate, so it isn't a secret. While the repo is private on GitHub Free these are repository secrets: environments, which would limit them to the release job, need a public repo or a paid plan ([GitHub docs](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)). Move them into a `release` environment when the repo goes public.

## Making a release

1. Set `version` in `app/src-tauri/tauri.conf.json`.
2. Actions > Release > Run workflow (or push the tag `v<version>`; the workflow checks it matches).
3. Download the DMG from the draft release on the Releases page, open it on a Mac and check that it opens without a warning and that a call works. Then publish the release: from that moment installed copies are offered it. A published release is never changed; the next build needs a new version.

The Run workflow button appears only once the workflow is on the default branch (GitHub runs `workflow_dispatch` from there). Updates reach users only while the repo is public: a private repo's release files need a login, so until then the check says it couldn't check.

## Cost

macOS runners on a private repo draw from the plan's included compute: $12 a month on GitHub Free, at $0.062 a minute for the standard arm64 runner, about 190 minutes ([pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), 2026-11-05). Keep the organization's Actions budget at $0 so a run stops instead of charging. The workflow uses no caches, so what is signed is always built from scratch. The DMG goes on the release, not into Actions artifact storage (500 MB on Free). On a public repo, standard runners are free.

## When it fails

- **Notarization rejected**: the DMG step prints Apple's log, which names each file and problem (unsigned, no timestamp, no hardened runtime). For the app itself, Tauri prints the submission id; run `xcrun notarytool log <id>` with the same key.
- **The signed agent doesn't start**: hardened runtime loads only libraries signed with the same Team ID. Look for a file `just agent sign` missed.
- **Certificate expired**: renew the membership and the certificate, then replace `APPLE_CERTIFICATE` and its password. Builds signed and notarized before expiry keep working.

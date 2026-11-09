# Releasing

How a signed Bomby build is made. The workflow is `.github/workflows/release.yml`; the why is in [the decision](decisions/ship-the-agent-and-adapter-as-sidecars.md). Releases are macOS 14 or later on Apple Silicon only: `minimumSystemVersion` in `tauri.conf.json` sets it, the LiveKit server is built for it (cgo would otherwise target the runner's macOS), and `just app check-macos` fails the build if any bundled program or library needs a newer macOS. Changes that could break packaging are built unsigned first, on their pull request (`.github/workflows/package.yml`).

## How it works

1. **Signing** stamps every program file with the Developer ID certificate and seals the app, so any change breaks the seal. Signed builds use hardened runtime, which blocks risky abilities unless the app holds an entitlement for them. Bomby holds one, the mic (`app/src-tauri/Entitlements.plist`); the agent needs none.
2. **Notarizing** uploads the signed app to Apple's notary service with the App Store Connect API key. Apple scans it automatically (no human review) and returns a ticket, which is stapled to the app and to the DMG.
3. **Gatekeeper** checks the signature and the ticket the first time a user opens the downloaded app. Without both, macOS refuses to open it.
4. **Updates** are signed again, with Bomby's own updater key (separate from Apple's). Installed copies read `latest.json` from the latest published release, download `Bomby.app.tar.gz` and install it only if its signature matches the public key in `tauri.conf.json` and the version signed into it matches the one announced (`requireSignedVersion`, so an old release can't be passed off as new). Settings, About checks once at launch and on Check for updates; installing waits for the user and never cuts off a call: a call that starts during the download holds the update until the user restarts.

The workflow runs on a fresh GitHub macOS machine, thrown away after the job: it imports the certificate into a keychain of its own, builds the LiveKit server from its pinned source (`just livekit build`, which `just app build` runs first), freezes and signs the agent (`just agent freeze`, `just agent sign`), runs `just app build` (Tauri signs, notarizes and staples the app), packs the signed update (`tauri.release.conf.json` turns on `createUpdaterArtifacts`), notarizes and staples the DMG, checks it all as Gatekeeper would, runs the signed agent (`just agent check-frozen`) and the signed server (`--version`), writes `latest.json` and attaches the DMG (by version and again as `Bomby.dmg`, so `https://github.com/bomby-app/bomby/releases/latest/download/Bomby.dmg` always downloads the newest), `Bomby.app.tar.gz` and `latest.json` to a draft release. The key never touches a developer's Mac.

## Secrets

Secrets of the `release` environment (Settings > Environments > release), open to `main` only, set from the machine that holds the signing files:

| Secret | Value | Set with |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | The Developer ID `.p12` (certificate, private key, Apple's G2 intermediate), base64 | `base64 -w0 <file>.p12 \| gh secret set APPLE_CERTIFICATE -R bomby-app/bomby --env release` |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` export password | `gh secret set APPLE_CERTIFICATE_PASSWORD -R bomby-app/bomby --env release` (asks for it) |
| `APPLE_API_KEY` | The App Store Connect API key's Key ID | `gh secret set APPLE_API_KEY -R bomby-app/bomby --env release` |
| `APPLE_API_ISSUER` | The API key's Issuer ID | `gh secret set APPLE_API_ISSUER -R bomby-app/bomby --env release` |
| `APPLE_API_KEY_P8` | The `.p8` file's contents | `gh secret set APPLE_API_KEY_P8 -R bomby-app/bomby --env release < AuthKey_<id>.p8` |
| `TAURI_SIGNING_PRIVATE_KEY` | The updater's private key | `gh secret set TAURI_SIGNING_PRIVATE_KEY -R bomby-app/bomby --env release < bomby-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password | `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R bomby-app/bomby --env release` |

The updater key pair is made once, on the machine that holds the signing files, with `bunx @tauri-apps/cli@2.12.4 signer generate -w bomby-updater.key`. Its public half goes in `plugins.updater.pubkey` in `tauri.conf.json`. Losing the private key means installed copies can never update again: keep it, and its password, with the other signing files.

The signing identity is read from the certificate, so it isn't a secret. Only the Release job names the environment, so no other workflow, and no branch but `main`, can read them ([GitHub docs](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)).

## Making a release

1. Set `version` in `app/src-tauri/tauri.conf.json`.
2. Actions > Release > Run workflow. Nothing else starts it: publishing the draft creates the tag `v<version>`, and a tag trigger would build the release a second time.
3. Download the DMG from the draft release on the Releases page, open it on a Mac and check that it opens without a warning and that a call works. Then publish the release: from that moment installed copies are offered it. A published release is never changed; the next build needs a new version.

The Run workflow button appears only once the workflow is on the default branch (GitHub runs `workflow_dispatch` from there). Updates need the repo public: a private repo's release files need a login.

## Cost

Standard runners, macOS included, are free on a public repo ([pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), 2026-11-05). The workflow uses no caches, so what is signed is always built from scratch. The DMG goes on the release, not into Actions artifact storage.

## When it fails

- **Notarization rejected**: the DMG step prints Apple's log, which names each file and problem (unsigned, no timestamp, no hardened runtime). For the app itself, Tauri prints the submission id; run `xcrun notarytool log <id>` with the same key.
- **The signed agent doesn't start**: hardened runtime loads only libraries signed with the same Team ID. Look for a file `just agent sign` missed.
- **Certificate expired**: renew the membership and the certificate, then replace `APPLE_CERTIFICATE` and its password. Builds signed and notarized before expiry keep working.

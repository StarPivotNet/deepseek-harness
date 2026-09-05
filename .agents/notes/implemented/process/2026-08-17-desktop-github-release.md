# Agent Note: Desktop GitHub Release sequence

Status: implemented

English | [中文](2026-08-17-desktop-github-release.zh.md)

## Problem

`@deepseek-ai/dsh-desktop` only launched from a repository checkout: the window spawned `dsh web` by walking to `apps/cli`, and `resolveNodeExecutable` needed a system Node. That is enough for contributors and not enough for a downloadable desktop app. The npm `dsh` family already publishes `@deepseek-ai/dsh` tarballs; it does not produce an Electron installer, and `apps/desktop` stays `private` so it cannot join that family.

## Decision

Desktop installers are a fourth release sequence, independent of the npm `dsh`, vendor, and Landlock families.

The published version is `apps/desktop/package.json`'s `version`, which already tracks the workspace family version. A human creates the `desktop-v<version>` tag after that version lands on `master`. CI never writes the repository.

`scripts/desktop/pack.ts` stages one Host tree and one Electron app leaf, then runs pinned `electron-builder@26.15.3`:

- `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod` writes `dist-desktop/staging/host/dsh`.
- The runner's Node 24 binary is copied beside that tree as `host/node` or `host/node.exe`.
- The compiled desktop `lib/`, `assets/`, and `package.json` are copied into `dist-desktop/staging/app` so electron-builder does not walk the workspace.
- electron-builder packages that leaf with `extraResources/host`. The staged app name is `dsh-desktop` and the Linux/Windows executable is `DeepSeekHarness`, because AppImage rejects the scoped npm name. macOS and Linux take `icon-512.png`; Windows takes the multi-size ICO. On Windows the packer spawns `pnpm.cmd` and writes a zip, not NSIS, because `pnpm dlx` nests NSIS templates behind a path that makensis cannot open.

A packaged window resolves `process.resourcesPath/host/dsh/lib/bin.js` and the bundled Node before any checkout or remembered system Node. Checkout launch is unchanged.

`Release (desktop)` (`.github/workflows/release-desktop.yml`) packs one installer per native runner and publishes those bytes as the tag's GitHub Release:

| Runner | Artifact |
|---|---|
| `macos-latest` | `DeepSeek Harness-<version>-mac.zip` |
| `ubuntu-24.04` | `DeepSeek Harness-<version>.AppImage` |
| `windows-latest` | `DeepSeek Harness-<version>-win.zip` |

Pushing `desktop-v*` packs and publishes. A manual dispatch with `publish=false` only packs. Publication requires the matching tag; `contents: write` is limited to the publish job. The publish job uploads only `*.zip`, `*.AppImage`, and `SHA256SUMS`; electron-builder leftover directories such as `linux-unpacked` stay out of the Release. Release notes name the archive contract, then list commits since the previous `desktop-v*` tag (`desktopReleaseNotes` in `scripts/desktop/pack.ts`).

## Alternatives considered

**Publish desktop through the npm `dsh` family.** Rejected because `apps/desktop` is a private Electron shell and npm tarballs are not installers. Joining that family would either publish Electron or leave users without a downloadable app.

**Reuse the Python single-exe `pkg --sea` payload as the Host.** Rejected because that executable is the JSON-RPC SDK runtime, not `dsh web`. Desktop needs the web profile, frontend dist, and CLI bin.

**Ship only the Electron window and require a system `dsh` / Node.** Rejected because Finder and Start-menu launches inherit a short GUI `PATH`. A downloadable app has to carry its Host.

**One Ubuntu job that cross-packages every target.** Rejected because the bundled Node binary must come from a matching runner, and electron-builder's native targets are already assigned per OS.

**Code-signed, auto-updating installers in this sequence.** Rejected as a later product step. This sequence publishes unsigned archives so a tag can produce a downloadable app.

**Windows NSIS setup through `pnpm dlx` electron-builder.** Rejected because makensis cannot open `StdUtils.nsh` after `pnpm dlx` nests app-builder-lib templates behind a path longer than NSIS accepts. The Windows artifact is a zip of the packaged app.

## Consequences

A `desktop-v*` tag is enough to produce three installers and one GitHub Release. The npm `dsh` sequence is unchanged. Packaged launches no longer depend on a checkout or a system Node; checkout `pnpm desktop` / `dsh desktop` still does.

What this costs:

- **Unsigned artifacts.** macOS Gatekeeper and Windows SmartScreen warn on first launch until signing is added.
- **Host size.** Each installer embeds a `pnpm deploy` of `@deepseek-ai/dsh` plus Node, so the download is much larger than the Electron shell.
- **Peer installation during deploy.** `@deepseek-ai/dsh` is not a closed runtime manifest; pack enables `auto-install-peers` so the staged Host can boot `dsh web`.
- **Unsigned, no electron-updater.** Packaged desktop can still Install a matching archive from this GitHub Release ([in-app update](../feature/2026-09-16-desktop-in-app-update.md)). Signing remains deferred.

## Testing

`scripts/desktop/pack.spec.ts` pins tag naming, artifact names, platform flags, the Windows `pnpm.cmd` spawn, publish-tag rejection, and changelog notes. `apps/desktop/tests/host.spec.ts` pins packaged Host detection, bundled Node preference, and the 512px installer mark. The workflow is the executed pack-and-publish path.

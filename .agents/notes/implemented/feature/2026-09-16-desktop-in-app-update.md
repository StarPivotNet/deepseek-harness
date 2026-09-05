# Agent Note: Packaged desktop in-app update

Status: implemented

English | [中文](2026-09-16-desktop-in-app-update.zh.md)

## Problem

The product-update plugin told packaged desktop users that a newer `desktop-v*` GitHub Release existed, then opened the Release URL. Installing still meant downloading the zip or AppImage by hand. Checkout Electron must not replace its own binary with a packaged archive.

## Decision

Packaged desktop (`app.isPackaged`) installs the matching GitHub Release archive from the same feed the Host already polls.

`@deepseek-ai/dsh-client-ui-update` stays the poller and the UI. On the `desktop` channel, after `pickLatestRelease`, the Host fetches `SHA256SUMS` and attaches `ProductRelease.artifact` when the archive name, `https://github.com/<repo>/releases/download/<tag>/<name>` URL, size, and digest match darwin/arm64, linux/x64, or win32/x64. A SHA256SUMS failure leaves the tag available and omits `artifact`. The CLI/`dsh` channel never attaches an archive. The Host never writes the archive bytes to disk.

`apps/desktop` owns download and apply. The isolated preload exposes `canInstall`, `installUpdate`, `cancelUpdate`, `onUpdateProgress`, and `relaunchToUpdate`. `canInstall` is true only when packaged. The main process pins `StarPivotNet/deepseek-harness`, rejects any other download URL, streams the file while hashing, and fails closed on size or SHA-256 mismatch. Zip extraction allows store and deflate only, and rejects zip-slip, encryption, zip64, and non-files. After the user clicks **Restart**, a helper waits for this PID, then:

- Windows: `robocopy` the staged tree over `dirname(execPath)` and `start` `DeepSeekHarness.exe`
- macOS: replace the enclosing `.app` and `open` it
- Linux: replace `$APPIMAGE` and `exec` it

Settings and the overlay toast show **Install** only when `latest.artifact` is present and `canInstall()` is true. **Check now** still does not download the archive.

The [product-update plugin](2026-08-28-in-repo-product-update.md) still owns polling, cache, and dismiss. The [desktop GitHub Release sequence](../process/2026-08-17-desktop-github-release.md) still owns packing and `SHA256SUMS` upload.

## Alternatives considered

**electron-updater / Squirrel / NSIS.** Rejected because this product already publishes unsigned zip and AppImage archives on GitHub Releases, and the packer rejected NSIS. A GitHub download plus a helper after quit covers those three artifacts without a second publisher.

**Host downloads the archive.** Rejected because the Host is `dsh web` inside the window. Replacing `DeepSeekHarness.exe` / the `.app` / the AppImage is an Electron main-process job, and checkout Hosts must not install.

**Silent background download.** Rejected: the user clicks **Install**. Checking stays a metadata poll.

**npm zip library in the packaged app.** Rejected: `apps/desktop` has no runtime `node_modules` in the electron-builder `files` list. `node:zlib` inflateRaw plus a zip-slip guard is enough for these archives.

## Consequences

- Packaged Settings → General and the overlay toast gain **Install** / **Restart**. CLI and browser tabs do not.
- A missing or invalid `SHA256SUMS` still shows the newer tag; **Open release notes** remains.
- Windows and a running AppImage cannot overwrite themselves, so apply always happens after `app.quit()` via a helper in Electron userData.
- Archives remain unsigned. Gatekeeper and SmartScreen still warn on first launch of a newly installed binary.

## Testing

`packages/client/ui-update` specs pin asset parse, SHA256SUMS, download-URL guards, schema `artifact`, desktop-channel attach, SHA256SUMS abort, Settings/toast Install, and preload forwarding. `apps/desktop` specs pin payload guards, zip extraction, verified download, apply helpers, updater state (busy/cancel/incomplete staging), IPC wiring, and preload/main strings.

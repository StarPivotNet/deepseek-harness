# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Electron window around the local `dsh web` Host. The chat UI stays the official Web GUI; this package only owns the window, Host process, and title-bar chrome.

## Run

From the repository root, after `pnpm run build`:

```sh
pnpm desktop
```

or:

```sh
pnpm dsh desktop
```

The window starts `dsh web` as soon as the Electron process exists, so Host boot overlaps Chromium ready. The first launch binds `--port 0`; later launches reuse the last successful loopback port from Electron userData so Chromium keeps the same origin (and therefore browser-local GUI state such as pinned Sessions). An occupied remembered port falls back to `--port 0`. An explicit `--port` forwarded by `dsh desktop` still wins. It waits for `dsh web: http://127.0.0.1:<port>` and then for `/plugins` to serve a client bundle before loading that loopback URL, so the first plugin scripts do not 404 while later Host rows are still mounting. If the Host exits before that line, the window shows the exit status plus the captured stdout and stderr. Closing the window stops the Host. Windows uses the system caption overlay for minimize, maximize, and close. The taskbar and window icon is the same DeepSeek whale mark as the Web favicon. On Windows, the first launch writes `DeepSeek Harness.lnk` into the Start menu with that icon and AppUserModelID; pin that shortcut, not a raw `electron.exe` process.

On macOS the window uses `titleBarStyle: hiddenInset`: the native traffic lights sit in the reserved left side of the title bar, and a standard application menu (Edit roles, Window roles, Quit) provides the usual Cmd shortcuts. Closing the window keeps the dock process alive; clicking the dock icon reopens the window and restarts the Host. The reserved strip is an empty drag region: `insertCSS` installs `-webkit-app-region: drag` on `dom-ready`, and the drag node is an absolutely positioned block so Chromium has a hit box. When the Web GUI reports the unread Completed count, the isolated preload sends `dsh-desktop:set-completed-unread` and the main process composites a green numeric plate onto the whale PNG, then `app.dock.setIcon`. A rising count also calls `app.dock.bounce('informational')`. Electron returns `-1` while the app is focused, so a focused window does not bounce.

## Release

A GitHub Release on a `desktop-v<version>` tag carries one archive per runner: a macOS arm64 zip, a Linux x64 AppImage, and a Windows x64 zip. Each archive embeds the Electron window, a Node 24 binary copied from that runner, and a `pnpm deploy` of `@deepseek-ai/dsh`. The window still starts `dsh web` on the remembered loopback origin (or `--port 0` on first launch) and loads that URL; the packaged Host no longer needs a repository checkout or a system Node.

From the repository root, after `pnpm run build`:

```sh
pnpm run desktop:pack -- --platform darwin
```

`Release (desktop)` (`.github/workflows/release-desktop.yml`) packs those three installers and publishes them as that tag's GitHub Release. The notes list commits since the previous `desktop-v*` tag. The desktop package stays `private`; it is not an npm family member. The [desktop GitHub Release Agent Note](../../.agents/notes/implemented/process/2026-08-17-desktop-github-release.md) owns the sequence. A packaged window can **Install** a newer `desktop-v*` archive from that Release (SHA-256 verified against `SHA256SUMS`) and **Restart** to replace the running app; checkout launches do not. The [in-app update Agent Note](../../.agents/notes/implemented/feature/2026-09-16-desktop-in-app-update.md) owns that path.

## Known Limitations and Deferred Work

- In-app install runs only in a packaged build (`app.isPackaged`). Checkout launch remains `pnpm desktop` / `dsh desktop`.
- No code signing, tray, or multi-window support. Archives stay unsigned.

# Agent Note: Desktop packaging runtime layout fix

Status: implemented

English | [中文](2026-09-15-desktop-packaging-runtime-layout-fix.zh.md)

## Problem

Every Desktop mac archive since `desktop-v0.1.3-alpha.2.1` (2026-09-05) — including the whole `0.1.5` line through `rc.2.2` — hangs at launch with no window, no Host, and no output. Sampling the stuck main process showed it blocked in `-[NSAlert runModal]`: the Electron default uncaught-exception dialog.

Two independent packaging defects produced that state:

1. **asar without its runtime dependencies.** The in-repo product-update checker (PR #3) added `electron-updater` and `semver` as `dependencies`, and tsdown externalizes `dependencies` by default, so `lib/main.js` kept bare top-level imports of both. `scripts/desktop/pack.ts` stages a dependency-free manifest (`pinStagedElectronVersion`) and `files` excludes `node_modules`, so nothing in the archive could resolve them. The module error fired before `app.whenReady()`, and the modal blocked the process forever. CI never saw it because the boot-smoke step exercised the staged Host tree, never the Electron main bundle.
2. **Resources layout mismatch.** The `0.1.5` main process loads `Resources/runtime/node`, `Resources/runtime/pnpm/bin/pnpm.mjs`, and `Resources/dsh`, and the Desktop first-run manager builds `~/.dsh/profiles/desktop` from those. `pack.ts` still assembled the `0.1.3`-era `Resources/host` tree from a `pnpm deploy`, so even a loadable bundle would find no runtime.

The `apps/desktop` `package-target.ts` chain (runtime + package set + `dsh` with boot smoke) was written for this layout but never wired into `Release (desktop)`.

## Decision

`pack.ts` keeps owning the fork release flow — pinned electron-builder, unsigned `identity: null`, Chinese release notes, tag verification — and delegates resource preparation to the `apps/desktop` chain instead of its own `pnpm deploy`:

- `prepareDesktopRuntime()` runs `pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts <target> --prepare-only`, which performs the official build, packs the dsh/vendor/Landlock families, prepares `runtime/` (Node 24 + pinned pnpm) and `dsh/`, and boot-smokes the exact resource tree (`smokeDesktopRuntime`). `--prepare-only` stops before electron-builder, whose official path requires Apple credentials.
- `extraResources` now ships `runtime` → `runtime`, `dsh` → `dsh`, plus `dsh/node_modules` explicitly, because electron-builder drops a source directory's root `node_modules`.
- `prepare-dsh.ts` accepts `DSH_DESKTOP_UNSIGNED_RUNTIME=1` to skip `signMacOSRuntime`: fork releases are unsigned, the enclosing app is the trust root, and native files keep their linker ad-hoc signatures. `verifyDesktopRuntime` checks inventories, not signatures, so the rest of the chain is unchanged.
- tsdown gains `deps.alwaysBundle: ['electron-updater', 'semver']`, so `lib/main.js` is self-contained again and the dependency-free staged manifest stays truthful.
- `linux-x64` joins `DesktopPackageTargetName`, `desktop-build-paths`, and the auto-update target unions, because the fork publishes an AppImage and the prepare chain resolves paths through those tables. `package:linux:x64` scripts expose it.
- The workflow's `Boot-smoke the staged Host` step is deleted: the prepare chain inside pack now owns boot coverage, against the real DesktopHostProcess rather than the retired `host/` tree.

## Marketplace on Desktop

The first working pack disabled the three in-box marketplace rows: `plugin-catalog` injects `webServer` (Desktop serves over pipes), and the marketplace Host half injects `profile` (Desktop owns the profile in the Electron main process), so both stayed pending and failed the Host activation check. That cost the fork its Discover UI, which is not acceptable — the rows now run on Desktop through three narrow adaptations:

- `runDesktopHost` calls `provideProfile` with the Electron-owned desktop project directory, so profile-aware Host rows (marketplace reads, installs, commands) resolve the same directory the Electron manager owns. Mutations stay subject to the Electron-side lock reconciliation on next start.
- `fetchCatalog` reads the in-box catalog straight from the profile's installed `dsh-host-plugin-catalog` package when no `webServer` port exists; the Web profile keeps the HTTP self-fetch path untouched.
- `prepare:runtime` writes executable `pnpm` shims (`.cjs` behind `node`) into `runtime/pnpm/bin`, and the Electron host environment prepends that directory to `PATH`, so in-Host `runProfilePnpm` installs resolve the packaged pnpm instead of a system one.

The `plugin-catalog` row itself stays disabled on Desktop only: its HTTP route has no consumer there, while Discover reads the same file through `readShippedCatalog`. The Web composition row is untouched and still gated by `verify-fork-customizations`.

## Verification

- `tsc -b apps/desktop` and the desktop bundle build pass; `grep external imports lib/main.js` shows only `electron` and `node:` builtins.
- `pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts mac-arm64 --prepare-only` with `DSH_DESKTOP_UNSIGNED_RUNTIME=1` completes and leaves `.desktop-build/targets/mac-arm64/{runtime,dsh}`.
- `pnpm exec tsx scripts/desktop/pack.ts --platform darwin` consumes those roots; the produced zip must be unpacked and checked for `Contents/Resources/runtime/node`, `Contents/Resources/dsh`, and an asar whose `main.js` has no bare npm imports before install. A packaged app is alive when it reaches the first-run profile build without the modal.

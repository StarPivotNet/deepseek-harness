# Agent Note: In-repo product update

Status: implemented

English | [中文](2026-08-28-in-repo-product-update.zh.md)

## Problem

Packaged desktop and CLI users had no in-app signal that a newer GitHub Release existed. Desktop packaging deferred auto-update. Users had to visit GitHub themselves.

## Decision

`@deepseek-ai/dsh-client-ui-update` is a dual-face client plugin. The Host half polls GitHub Releases every 24h (ETag / body-hash, last-success cache in the `product-update` settings namespace), compares against `readProductVersion()`, and serves `/product-update` on the Host Connection RPC registry. The browser half renders a General Settings row and overlay toast. The Host poller never writes archive bytes; packaged desktop install is owned by `apps/desktop` ([in-app update](2026-09-16-desktop-in-app-update.md)).

The compared version is `DSH_PRODUCT_VERSION` when set, else the published CLI package, else this package's own package.json. Desktop spawn sets `DSH_PRODUCT_CHANNEL=desktop` and `DSH_PRODUCT_VERSION` from Electron `app.getVersion()`. Tag prefixes are `dsh-v*` vs `desktop-v*`. Default feeds are `deepseek-ai/deepseek-harness` for CLI/web and `StarPivotNet/deepseek-harness` for desktop; an explicit `repo` config still wins. Persisted release URLs and `window.open` accept only `https://github.com/...`.

The Host fiber owns the 24h interval, clears it on dispose, and aborts an in-flight fetch. The browser half hydrates from the Host settings cache; **Check now** is the only client-initiated poll. Slot conflicts fail in the slot core. The invariant companion is empty: the settings seam validates and publishes the durable cache, and Host, checker, and client behavior specs cover check/dismiss RPC and the overlay toast.

## Alternatives considered

**electron-updater inside this plugin.** Rejected for the Host poller: unsigned artifacts, extra update surface, and GitHub URL plus dismiss were enough for CLI/web. Packaged desktop install lives in `apps/desktop`, not in this plugin's Host fiber.

**Browser-side poll.** Rejected: GitHub rate limits, CORS, and the Host already owns settings persistence.

## Consequences

- Settings → General shows current version, latest tag, and Check now.
- Overlay toast appears when a newer tag exists and has not been dismissed.
- Desktop and CLI share one plugin; channel is env-selected.
- CLI/web have no installer. Packaged desktop install is a separate main-process path. No signature and no private feed.

## Testing

Checker, semver, releases, and RPC unit tests pin parse, compare, cache, dismiss, and desktop artifact attach. Host fiber tests pin interval, RPC, and dispose. Client apply tests pin slot registration, check/dismiss, and Install forwarding. Desktop `webHostEnv` merges channel and version into the Host child.

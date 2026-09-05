---
description: "Product-update plugin for the Web GUI: Host poller of GitHub Releases, General Settings row, overlay toast, and packaged-desktop Install."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-update

English | [中文](README.zh.md)

## Summary

This package is the in-app product-update signal for CLI/web and packaged desktop. The Host half polls GitHub Releases on a 24h interval, caches the last successful result in the `product-update` settings namespace, and serves `/product-update` on the Host Connection RPC registry. The browser half mounts a General Settings row and a shell overlay toast. Checking itself does not download an archive; **Open release notes** opens the GitHub URL. On packaged desktop, a matching archive may also be **Install**ed through `window.dshDesktop`.

Channel selection is `auto` by default: `DSH_PRODUCT_CHANNEL=desktop` (set by the Electron window when it spawns `dsh web`) matches `desktop-v*` tags on `StarPivotNet/deepseek-harness`; otherwise the plugin matches `dsh-v*` tags on `deepseek-ai/deepseek-harness`. An explicit `repo` config still wins. The compared version is `DSH_PRODUCT_VERSION` when set, else the published CLI package, else this package's own package.json.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped Web bundle already mounts this plugin. Open **Settings → General** to see the installed version, the last check, and **Check now**. When a newer tag exists and has not been dismissed, an overlay toast offers **Release notes** and **Dismiss**. On a packaged desktop window, a matching archive also offers **Install**, then **Restart**. **Check now** is the only client-initiated poll; a newly opened tab hydrates from the Host cache rather than fetching GitHub itself.

### When to choose it

Mount this plugin when the Web GUI should tell the user a newer GitHub Release exists. Leave it out of a custom profile that has no product channel, or that already owns its own updater. CLI and browser tabs still only open the GitHub URL. Packaged desktop install is implemented by `apps/desktop`, not by this Host poller; this package only attaches the artifact and renders **Install**.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `channel` | `auto` | Release channel; `auto` reads `DSH_PRODUCT_CHANNEL` |
| `repo` | — | GitHub `owner/repo`; omitted, follows the channel |
| `checkIntervalMs` | `86400000` | Gap between GitHub polls in milliseconds |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-client-ui-update) is the exhaustive source for every accepted field and its JSDoc.

### Failures

A failed poll keeps the last successful result for 24h so a GitHub outage does not blank the row. Without a cache, the row shows **Could not check for updates.** The plugin never writes a release URL that is not `https://github.com/...`. A desktop SHA256SUMS fetch failure still leaves the tag available and omits `artifact`, so **Install** stays hidden.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the Host poller and browser row are built; observable behavior is covered in [Use this package](#use-this-package).

The Host fiber registers the durable cache, the `/product-update` channel (`check` / `dismiss`), and a 24h `setInterval`. Dispose clears the timer and aborts an in-flight fetch. Each poll sends `If-None-Match` when an ETag is cached, hashes the body, and reuses `lastResult` on 304, an unchanged hash, a rate limit, or a network error inside the interval. `auto` channel reads `DSH_PRODUCT_CHANNEL`; the default GitHub `owner/repo` follows the concrete channel unless `repo` is configured. On the desktop channel, a successful pick then fetches `SHA256SUMS` and attaches the archive for darwin/arm64, linux/x64, or win32/x64 when the name, download URL, and digest match. The browser half binds the settings scope, adopts `lastResult`, and calls RPC only from **Check now** and **Dismiss**. `window.open` runs only after `isGithubHttpsUrl`. **Install** calls `window.dshDesktop` only when `canInstall()` is true. Host and browser type-check in `tsconfig.host.json` and `tsconfig.client.json` so `src/index.ts` can use Host `ctx.connection` without merging that shape into the browser `ConnectionHandle`.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host half: settings cache, `/product-update` RPC, 24h poll |
| [`src/checker.ts`](src/checker.ts) | GitHub Releases poller (ETag, body-hash, stale fallback, desktop artifact) |
| [`src/artifact.ts`](src/artifact.ts) | Archive names, SHA256SUMS parse, artifact attach |
| [`src/client/index.ts`](src/client/index.ts) | Browser half: dictionaries, Settings row, overlay toast, desktop Install |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the update row is not enough. They move from this plugin to the Settings shell, the desktop window, and the client package map.

- [ui-settings-general](../ui-settings-general/README.md) — declares `settings.general.item` and owns the Settings shell.
- [settings](../../settings/README.md) — the durable user-settings seam that stores the product-update cache.
- [`@deepseek-ai/dsh-desktop`](../../../apps/desktop/README.md) — packaged window that downloads and applies the attached archive.
- [Client package map](../README.md) — adjacent browser UI packages.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-client-ui-update) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

None, as the plugin polls GitHub and renders browser UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current update surface. They are current package constraints, not a packaging comparison or a task backlog.

- **CLI/web never download or install** — those surfaces only open the GitHub Release URL. Packaged desktop install is owned by [`apps/desktop`](../../../apps/desktop/README.md).
- **Matching archives only** — Install requires `SHA256SUMS` plus darwin/arm64, linux/x64, or win32/x64. Other triples stay on **Open release notes**.
- **GitHub Releases only** — one public repo feed per channel; no private-feed or mirror support.
- **Stale cache fallback** — a failed poll keeps the last successful result for 24h so a GitHub outage does not blank the row.
- **Unsigned desktop artifacts** — first-launch Gatekeeper / SmartScreen warnings remain a packaging concern, not this plugin's.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

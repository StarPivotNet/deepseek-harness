---
description: "Organization-built-in Purge prompt controls, host compatibility patches, and red-team workspace."
kind: "package-bundle"
---

# @deepseek-ai/dsh-purge

English | [中文](README.zh.md)

## Summary

Ship the complete Purge plugin with the organization dsh distribution. The shipped Web, Desktop, Headless, SDK, and ACP compositions mount it by default. It applies its host compatibility patches after startup, manages prompt rules and skills, and provides the red-team workspace and preset. `sdk-minimal` does not include it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Attribution](#attribution)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

No separate installation is required. Open **Settings → Purge** to manage patches, prompts, rules, skills, and the red-team workspace. The red-team workspace requires its authorization flow and local environment setup before an engagement.

Startup applies the compatibility patches only to the current Host installation and may require a restart. Preserve a separate `!@deepseek-ai/dsh-purge` marker in a profile's `dsh.profile.bundles` list to opt out of adoption during an upgrade. A later profile patch can override the plugin rows or set `dsh-purge.config.enabled` to `false`.

The package is versioned and released with `StarPivotNet/deepseek-harness`. It exposes no Purge upstream-update route. `POST /redteam/api` retains version-query compatibility and rejects separate package updates; the complete `/dsh-purge/update` API is removed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`cordis.patch.yml` mounts the root plugin, the red-team bootstrap, the shared SQLite store, and the HTTP bridge. `src/index.ts` is the TypeScript Loader entry; `runtime/` contains the maintained JavaScript implementation and stays outside generated `lib/` output. `client.js` is the browser bundle already in the Client Module Loader format. `presets/` and `skills/` remain package resources.

The original plugin's MIT license, attribution, and user notices are preserved in `LICENSE`, `NOTICE.md`, and `DISCLAIMER.md`. `UPSTREAM.md` records the source fork's documentation; the package README owns current organization behavior.

-----

<a id="attribution"></a>
## Attribution

The implementation derives from [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) by 小杨, with the JeffKeeping fork's 1.4.2 changes. This organization package retains those credits and the referenced third-party notices. It does not grant permission for commercial resale or prohibited use described by those notices.

-----

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The root plugin contributes the active operator prompt and capability guidance, registers `purge_status`, `purge_apply`, `purge_revert`, and `purge_audit`, and adds the `/purge`, `/rules`, and `/skills` commands. The red-team preset supplies role guidance and the engagement tools defined in `runtime/redteam/tools.js`. The tool catalog is generated from the shipped composition.

#### Token effect

The enabled prompt adds fixed text plus the selected rule content. Red-team role text is conditional on the selected preset and child role. Tool schemas add a conditional fixed cost.

#### KV Cache effect

Changing prompts, rules, presets, or the available tool set replaces the request prefix. Unchanged sessions retain their existing prefix subject to provider cache behavior.

## Known Limitations and Deferred Work

- Host compatibility patches are version-specific and can require restart. A new Host can leave patches pending; inspect the settings status and run `node scripts/compat-check.mjs` against an isolated copy before changing patch anchors.
- The red-team workspace requires separately installed tools and credentials. It does not create a VPS, FOFA key, or target authorization.
- `sdk-minimal` and profiles that explicitly disable the layer do not provide these tools or UI.

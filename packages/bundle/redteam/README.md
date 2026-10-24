---
description: "Built-in red-team workspace, preset, skills, tools, and engagement store."
kind: "package-bundle"
---

# @deepseek-ai/dsh-redteam

English | [中文](README.zh.md)

## Summary

Provide the red-team workspace, role preset, bundled skills, engagement tools, SQLite store, and HTTP bridge for the organization dsh. The `@deepseek-ai/dsh-purge` composition loads this package by default; users do not install it separately.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Open **Settings → Purge → 演练台**, complete the authorization flow, and configure the required local tools and credentials. Select the `redteam` preset for engagement work. Data remains under `$DSH_HOME/redteam`, with user presets under `$DSH_HOME/.agent-presets/redteam`.

<a id="understand-the-implementation"></a>
## Understand the implementation

The root plugin installs the preset and skills. `store` publishes `ctx.redteam`; `tools` registers model tools on the active tool registry; `ui` exposes the engagement HTTP bridge and environment guard. The TypeScript entries in `src/` load the maintained JavaScript implementation in `runtime/`. `presets/` and `skills/` ship as resources, and `lib/runtime/preset-composition.js` shares the parser between the entries and the runtime.

The code derives from `YuJunZhiXue/dsh-purge` and the JeffKeeping fork. `LICENSE`, `NOTICE.md`, and `DISCLAIMER.md` preserve the original attribution and notices. Versions and updates belong to `StarPivotNet/deepseek-harness`; this package does not fetch upstream releases or install separate updates.

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The preset supplies role guidance and the engagement tools declared in `lib/runtime/tools.js`. Tool schemas follow the shipped composition; no tools appear when the Purge layer is disabled.

#### Token effect

Role text and tool schemas add conditional fixed costs. Skill bodies are loaded on demand, not included in every request.

#### KV Cache effect

Changing the preset or tool catalog replaces the request prefix. Skill and engagement data reads are independent tool results.

## Known Limitations and Deferred Work

- Tool and credential setup is external to this package; missing FOFA keys, VPS access, or binaries remain visible in preflight results.
- The engagement preset is registered through the Host registry and needs the full dsh composition; `sdk-minimal` excludes it.

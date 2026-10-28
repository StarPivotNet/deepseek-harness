---
name: dsh-plugin-guide
description: Write, review, package, or debug published DSH plugins for this machine's DeepSeek Harness 2.0.13 (@deepseek-ai/* 0.1.5-rc.2). Covers host function plugins, defineTool, LlmAdapter, client bundles, profile/bundle layers, and Schemastery Config. Load before creating, reviewing, or packaging a published plugin. Published plugins are installed manually by the user.
---

# dsh-plugin-guide

This skill distills the **published plugin contract** of this machine's DSH Desktop 2.0.13. The authority is the installed `@deepseek-ai/*` READMEs and implementations, plus three external reference repos (host LLM adapter, client pin, tools+client inject). This copy lives at `skills/dsh-plugin-guide`. **Published plugins are installed manually by the user**; this skill only writes, reviews, and packages the contract — **do not run `dsh plugin add` on the user's behalf**.

After loading, classify the form, then read the matching reference. One package can be several forms at once; each form must satisfy its own contract.

## When to load

- Creating or adapting a published npm package the user can install manually
- Writing `defineTool`, `LlmAdapter`, client `./client`, or `cordis.patch.yml`
- Reviewing bundle / profile / user `cordis.yml` layers
- Debugging "registered but the model cannot see it", "client activation failed", or "duplicate adapter"

Do not use this skill to change the Agent loop, and do not apply internal monorepo package layout (`private: true`, workspace versions) to an external plugin.

## Red lines

1. **Registration is an effect.** `ctx.tools.register`, `ctx.llm.registerAdapter`, `ctx.webServer.register` / `tapIndex` must all land on the current fiber's effect; HMR/unload rely on the disposer. Bare global singletons are forbidden.
2. **Tools go through `defineTool`.** Parameters use the DSL; `output.schema` + `output.render` are required; `execute(args, exec)` returns only lossless JSON that matches the schema. Thrown errors become structured `isError` in the pipeline and do not end the current turn.
3. **Config goes through Schemastery.** Export a same-named `Config = Schema.object(...)` (the default export may also be written as `z.object`). The loader validates and fills defaults at mount. Do not export a plain object as `Config`.
4. **Interception goes through waterfall.** Tools: `tools/pre-execute` → guard → `tools/execute` → `tools/post-execute` → `tools/result`. Model streams: `llm/stream`. Do not invent a private middleware stack.
5. **The published form is a bundle.** `package.json` `dsh.bundle.patch` points at `cordis.patch.yml`. The user themselves runs `dsh plugin --profile <name> add` to insert the package into that profile's bundles layer; the agent **does not run `dsh plugin add` on the user's behalf**.
6. **`isolate` is not the default patch for published host plugins.** It belongs only to a **published service**, and only to rows that should be read **inside a preset group** (the group puts provider and consumer in the same isolate realm). Outward adapter/tool/UI packages such as OC2DSH, exFAT, and AgentTeams must not isolate.
7. **OC2DSH's `OFFICIAL_ZEN_TOOLS` is a Zen fingerprint stub, not defineTool.** Those names are unused stubs for anonymous-lane request identity. Do not treat a Zen stub as defineTool, and do not use them as a host-tool registration template.

## Route by form

| Form | What it does | Reference |
|---|---|---|
| host | Function-plugin four-tuple: `name` / `inject` / `Config` / `apply` | [`references/host-plugin.md`](references/host-plugin.md) |
| tool | `defineTool` + `ctx.tools.register` | [`references/tool-plugin.md`](references/tool-plugin.md) |
| llm | `class … extends LlmAdapter`, implement `stream()`, `ctx.llm.registerAdapter` | [`references/llm-adapter.md`](references/llm-adapter.md) |
| client | `dsh.client.platform=web`, `exports["./client"]`, build `lib/client.js` | [`references/client-plugin.md`](references/client-plugin.md) |
| bundle | `dsh.bundle.patch` + profile layers + user patch | [`references/bundle-and-profile.md`](references/bundle-and-profile.md) |
| config | Schemastery fields, `!!js`, credentials via env | [`references/config.md`](references/config.md) |
| checklist | Pre-pack checklist | [`references/checklist.md`](references/checklist.md) |

## Minimal decisions

1. **Only a model-callable capability** → tool. The host entry still needs the four-tuple.
2. **Only a new model provider** → llm. Host-only is enough; do not add a client just to look "complete".
3. **Only a browser pin / UI** → client. `immediately: true` is only for a pin that must beat the shell (exFAT's directory-validator override), not a generic speed switch. Missing `lib/client.js` makes client-modules **activation fail**.
4. **Installable distribution** → bundle. The patch `name` must equal the npm package name.
5. **Tunable behavior** → config. Protocol constants and security invariants must not become config.

## Local contract anchors (DSH 2.0.13 / 0.1.5-rc.2)

- `@deepseek-ai/dsh-tools`: `defineTool`, `ToolRuntime.register` (`layers.effect`), `tools/*` waterfall, `timeoutMs` must be a positive finite number, `run_code` is reserved.
- `@deepseek-ai/dsh-llm`: abstract `LlmAdapter.stream()`; `registerAdapter(providers, adapter)` itself is an effect; duplicate routes `DUPLICATE_ADAPTER`; every provider HTTP request must carry `attributionHeaders()`.
- `@deepseek-ai/dsh-client-modules`: `dsh.client.platform` must be `"web"`; `exports["./client"]` is required; `immediately` is boolean; missing a built client bundle fails activation loudly.
- `@deepseek-ai/dsh-host-webserver`: `register` / `registerUpgrade` / `tapIndex` all return a disposer; `tapIndex` is a raw HTML transform after the structured index rows.
- `@deepseek-ai/dsh-package-manifest`: `DshManifest` describes `bundle` / `profile` / `client`; `moduleFallback` is launcher-generated, not an author field.
- `@deepseek-ai/schemastery`: the default export is `Schema`; `Schema.object` and `z.object` are the same API.
- `@deepseek-ai/cordis`: `ctx.isolate(name, label)` switches service scope; only the same label joins the same realm. A published host adapter **does not** call it by default.

Reference repos are for checking form only; do not copy their business details as a generic template:

- **OC2DSH**: host LLM adapter, `inject: ['llm']`, no client, no isolate.
- **dsh-exfat-workspace**: `dsh.client.immediately: true` + host `webServer.tapIndex` to pin before desktop-shell.
- **dsh-agent-teams**: `defineTool` + `dsh.client.inject` list; the client `export const inject` waits on services; slots use `ctx.slots.inject()`.

## Work order

1. Read this file's red lines and routing table.
2. Open only the current form's reference (more than one is fine).
3. Cross-check this machine's `@deepseek-ai/*` README.zh.md / `lib/index.js`; do not fill version numbers or old key names from memory (the live service name is `webServer`; do not write `httpServer`).
4. Accept against [`references/checklist.md`](references/checklist.md).

Subagents or parallel sessions that write a published plugin must load this skill first; the path is `skills/dsh-plugin-guide`.

## Don't

- Use this skill to change the Agent loop, or apply internal monorepo package layout to an external plugin.
- Do not run `dsh plugin add` on the user's behalf.
- Add `isolate` to an outward host adapter / global tool.
- Treat OC2DSH's `OFFICIAL_ZEN_TOOLS` as a `defineTool` template.

## Red flags

- "Check in apply whether the provider is already registered" → check on first real use.
- "The tool does not need defineTool; a handmade register is enough" → contract violation.
- "isolate is safer, add it by default" → add it only for preset-group-internal published services.

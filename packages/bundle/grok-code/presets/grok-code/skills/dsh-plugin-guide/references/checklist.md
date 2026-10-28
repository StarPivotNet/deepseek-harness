# Pre-publish checklist

Against this machine's DSH 2.0.13. After every box is checked, the plugin is installed manually by the user (**do not run `dsh plugin add` on the user's behalf**). This skill lives at `skills/dsh-plugin-guide`.

## Package

- [ ] `"type": "module"`, `"main": "lib/index.js"`
- [ ] `exports["."]`, `exports["./cordis.patch.yml"]`, `exports["./package.json"]`
- [ ] When there is a browser face: `exports["./client"]` and the built artifact `lib/client.js` already exists
- [ ] `files` includes `lib` and `cordis.patch.yml` (add `assets/` if there are static assets)
- [ ] `dsh.bundle.patch` points at `./cordis.patch.yml`
- [ ] Put DSH implementation packages in `peerDependencies`; do not pack them into your own runtime bundle
- [ ] No `official-docs/`, `templates/`, `downloads/`, `dist/` (except the build convention), `bin/` install scripts, or `*.ps1` skill installers — those are not the published contract

## Host

- [ ] Named exports `name`, `inject`, `Config`, `apply` (no default export)
- [ ] `Config = Schema.object(...)` or equivalent `z.object(...)`
- [ ] Every `register` / `registerAdapter` / `tapIndex` / HTTP `register` is an effect
- [ ] inject lists services only; existence checks for sibling providers wait until first use
- [ ] HTTP service name: `webServer` / `inject: ['webServer']`; workspace service name: `workspaceRegistry`
- [ ] **No** `isolate` on outward host adapter / global tool rows

## Tool

- [ ] `defineTool({ name, description, parameters, output: { schema, render }, execute })`
- [ ] `execute` returns only canonical JSON; business failure uses throw so the pipeline becomes `isError`
- [ ] If `timeoutMs` is present: a positive finite number
- [ ] Did not register `run_code`
- [ ] Did not register OC2DSH `OFFICIAL_ZEN_TOOLS` / a Zen fingerprint stub as a tool; a Zen stub is not defineTool

## LLM

- [ ] `class … extends LlmAdapter`, implement `stream()`
- [ ] `ctx.llm.registerAdapter(['route'], adapter)` and `inject` includes `'llm'`
- [ ] Every provider HTTP request carries `attributionHeaders()`
- [ ] Credentials go through Schema + env; do not read arbitrary key files
- [ ] Do not retry inside the adapter (one stream = one provider attempt)
- [ ] No client declaration (unless there is real UI)
- [ ] No isolate

## Client

- [ ] `dsh.client.platform` is `"web"`
- [ ] `immediately: true` only for a pin that must beat the shell
- [ ] Two tsconfigs, host / client; do not import conflicting `Context.sessions` in the same program
- [ ] `dsh.client.inject` is not treated as apply order; slots use `ctx.slots.inject()`
- [ ] Built `lib/client.js` can be snapshotted by client-modules; a missing file fails activation

## Bundle / profile

- [ ] Patch `name` equals the npm package name (quote scoped names)
- [ ] `id` is stable and does not collide with other rows
- [ ] Empty user patches are written as `[]`, not a comment-only file
- [ ] `!!js` appears only on `config` leaves
- [ ] Docs say: restart the profile after `plugin add`; `live` patch is the exception

## Regression

- [ ] Cross-check this machine's `@deepseek-ai/dsh-tools`, `dsh-llm`, `dsh-client-modules`, `dsh-host-webserver`, `dsh-package-manifest` README.zh.md, not remembered docs from an older version
- [ ] Use at most the **structure** of oc2dsh / dsh-exfat-workspace / dsh-agent-teams as form comparison; do not copy their business code as a template
- [ ] Nowhere in the text describe isolate as the default patch for a published host plugin

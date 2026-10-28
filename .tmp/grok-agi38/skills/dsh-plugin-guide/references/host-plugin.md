# Host plugin

The host face is one row in the Node-side composition tree: package-root `main` / `exports["."]` points at `lib/index.js`. A DSH 2.0.13 function plugin uses **named exports**; there is no default export.

## Four-tuple

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
// When you need to see members such as ctx.tools / ctx.llm, use a declaration-merge trigger:
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-llm'

export const name = 'my-plugin'
export const inject = ['tools'] as const

export interface Config {
  stateDir?: string
}

export const Config = Schema.object({
  stateDir: Schema.string().default('.my-plugin'),
})

export function apply(ctx: Context, config: Config): void {
  // All registration lives in apply, and register is an effect
}
```

It is also common to `import z from '@deepseek-ai/schemastery'` and write `export const Config = z.object({ ... })`. `z` is `Schema`.

- `name`: Loader row identity; keep it stable, short, and consistent with the docs.
- `inject`: declared **service names**. `ctx.<name>` is available only after it is declared. inject waits only until the service is already provided; it does **not** wait for a provider-register effect on a sibling plugin row.
- `Config`: Schemastery schema, exported under the same name as the TypeScript interface. The loader owns defaults.
- `apply(ctx, config)`: the only mount point.

Class plugins work the same way: `static inject`, `static Config = z.object(...)`, and `super(ctx, 'serviceName')` in the constructor (see `ToolRuntime` in `@deepseek-ai/dsh-tools`).

## Registration is an effect

On this machine:

- `ctx.tools.register(definition)` → `this.layers.effect(..., { label: "tools.register()" })`
- `ctx.llm.registerAdapter(providers, adapter)` → `this.ctx.effect(function* () { ... }, "llm.registerAdapter()")`
- `ctx.webServer.register` / `tapIndex` / `registerUpgrade` return a disposer; wrap it in `ctx.effect(() => disposer, 'label')`

HMR and `fiber` unload reclaim only effects. Stuffing global state into a module-level `Map` outside `apply` leaks or double-registers after unload.

HTTP route example:

```ts
const web = ctx.get('webServer')
ctx.effect(() => web.register({
  kind: 'exact',
  path: '/plugins/my-plugin/state',
  handler: async (req, res) => { /* ... */ },
}), 'my-plugin: state route')
```

This machine's `@deepseek-ai/dsh-host-webserver` 0.1.5-rc.2 only `super(ctx, "webServer")`. Copyable examples always write `ctx.webServer` / `inject: ['webServer']`. `httpServer` is not a live service name on this 2.0.13; the AgentTeams `src/index.ts` `['webServer','httpServer']` pair is a compatibility probe for older harnesses — do not copy it into a new plugin. Same for workspace: the live service name is `workspaceRegistry`.

## isolate: not a default patch

`ctx.isolate(name, label)` gives **one service name** its own realm; only two isolates with the same `label` share that service. app-boot registers `cordis:group` as a Loader builtin so the "published service provider" and "consumers that only read it inside a preset" enter the same isolate realm. The `dsh-agent-presets` standing mount also hangs preset services after isolate, invisible outside the group.

Therefore:

- **Do isolate**: a published service whose consumers should only be rows inside a preset group.
- **Do not isolate**: outward host adapters (OC2DSH), profile-global tools (AgentTeams), pins that beat the shell (exFAT). They hang on shared `tools` / `llm` / `webServer` and must be visible to every session of that profile.

Adding `isolate:` in `cordis.patch.yml` to an ordinary published host plugin hides the tool or adapter in a realm nobody else can resolve.

## When to fail

Do not check in `apply` whether "some provider is already registered". Sibling rows activate concurrently; the provider may land after your `apply`. Move that check to first real use (for example first spawn). inject guarantees that the `ctx.subagents` service exists, not that a named provider is already listed.

Activation failure must fail-loud: a throwing plugin keeps the original error; a row waiting on a never-provided service is named in startup diagnostics together with the service it waited for.

## Package metadata (required even for host-only)

```json
{
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

On the host side, DSH packages use `peerDependencies` (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-llm`, …) and resolve at runtime from the profile's flattened `node_modules`. Do not pack the host implementation into your own bundle.

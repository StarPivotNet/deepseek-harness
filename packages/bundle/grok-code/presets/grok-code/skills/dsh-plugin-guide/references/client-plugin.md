# Client plugin

This machine's `@deepseek-ai/dsh-client-modules` turns `package.json` `dsh.client` into a loadable browser bundle. The host scans Loader entries, composes the boot graph, and serves the bundle via `/plugins`; the browser lazy-loads on demand. Executing the bundle **only registers the factory**; module side effects run at materialization.

## Declaration

```json
{
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-ui-model-selection",
        "@deepseek-ai/dsh-api-session-controller",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-client-ui-chat"
      ]
    }
  }
}
```

The `dsh.client.inject` list above matches the live **dsh-agent-teams** `package.json`: only packages this client **actually waits on, and that this machine's 0.1.5-rc.2 still provides**. Do not copy a nonexistent runtime; extra names leave the assembly row pending and out of the boot graph. Ordinary UI plugins trim this list to the services they truly depend on instead of copying the whole table.

Hard rules (`parseDshClient` / `resolveMeta`):

- `dsh.client.platform` must be a string; the roster accepts only **`"web"`**. Any other value is dropped as "no client".
- Declaring `dsh.client` requires `exports["./client"]` (a string, or a one-level conditional object with a string `default`). Otherwise throw `declares dsh.client but exports no "./client" bundle`.
- `inject` / `external`, if present, must be string arrays.
- `immediately`, if present, must be boolean.
## Build artifact

The host consumes the **already built** `lib/client.js`. `pnpm run build` must have written every client export before start. Missing the bundle fails activation, with an error that includes build notes and the package/path list. Source-mode start still reads this built client; it does not substitute `src/`.

The client entry is also a function plugin: `export const inject`, `export function apply(ctx)`. Waiting on a slot **declaration** uses `ctx.slots.inject('slot.name', () => ctx.slots.register(...))`; waiting on a service uses `export const inject = ['slots', 'sessions', ...]`. `dsh.client.inject` is only package-graph / prefetch / HMR metadata; it does **not** guarantee `apply` order.

The browser may import only platform-seeded modules (React, Cordis, static UI) and dynamic packages named in `dsh.client.external`. Cross-plugin value collaboration goes through cordis services; do not inline another plugin's implementation across packages.

## immediately: pin only

A boot-graph row with `immediately: true` enters the plugin view of `window.__DSH_BOOT__`. It is not a generic "load faster" switch.

Compare **dsh-exfat-workspace**:

- `dsh.client.immediately: true`, and in client `apply` `ctx.effect(() => installPin(window))`, pinning `window.__DSH_DESKTOP_VALIDATE_DIRECTORY__` before desktop-shell writes the directory validator
- the host also `inject: ['webServer']` and `ctx.webServer.tapIndex(html => injectHeadScript(html, CLIENT_PIN_SCRIPT))`, inserting the pin script right after the `<head>` open tag (`tapIndex` runs in registration order after the structured index rows)

If there is no "must beat the shell script" requirement, do not set `immediately`. Ordinary UI plugins (AgentTeams) use only `platform: "web"` + an `inject` list.

## Host + Client must be separate programs

Host `@deepseek-ai/dsh-session` declares `Context.sessions` as `SessionStore` (`ctx.sessions.create()` / `get()` / `list()`); the browser-side sessions face of `dsh-api-session-controller` / `dsh-client-ui-session` is a different object (AgentTeams `src/event-types.ts` writes it as `ISessions`). One TypeScript program will conflict. Host `tsconfig.json` excludes `src/client`; the client uses a separate `tsconfig.client.json` (`jsx: react-jsx`, `types: []`).

## When you do not need a client

Pure host adapters such as OC2DSH: **do not** declare `dsh.client`, **do not** export `./client`. An empty declaration forces client-modules to resolve a missing bundle and activation fails.

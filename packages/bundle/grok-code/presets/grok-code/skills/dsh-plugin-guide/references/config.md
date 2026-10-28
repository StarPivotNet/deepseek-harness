# Config (Schemastery)

User configuration for a published plugin comes from the composition-row `config:` (bundle patch, profile patch, home patch). The loader validates with the exported `Config` schema and fills defaults. This machine's `@deepseek-ai/schemastery` 3.18.x default export is `Schema`; with `import z from '@deepseek-ai/schemastery'`, `z.object` is the same as `Schema.object`. The implicit default of `Schema.object` / `Schema.dict` is `{}`.

## Export

```ts
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  stateDir?: string
  maxMembers?: number
  apiKey?: string
}

export const Config = Schema.object({
  stateDir: Schema.string().default('.my-plugin'),
  maxMembers: Schema.natural().min(1).default(8),
  apiKey: Schema.string(),
})
```

Built-in services do the same: `ToolRuntime.static Config = z.object({ mode: z.union(['native','ptc','both']).default('native'), ... })`, `WebServer.static Config = z.object({ host, port, compression, ... })`.

Do not:

- Export a plain object as `Config` (Cordis wants a Standard Schema interface)
- Replace schema defaults with a long chain of `??` in `apply` (debug hooks are fine; user-tunable fields are not)
- Turn protocol constants or security invariants into config

## Optional object fields

`z.object()` implicitly defaults to `{}`. If a nested object is itself optional but its fields are required, absence is treated as an empty object and then fails validation. AgentTeams uses `z.union([z.object({ provider: z.string().required(), model: z.string().required() }), z.const(undefined)])`. External plugins use the same pattern for "an entire optional route".

## `!!js`

Only on plugin `config` leaves, to read from the environment:

```yaml
- insert:
    - id: llm-myprovider
      name: llm-myprovider
      config:
        apiKey: !!js process.env.MY_PROVIDER_KEY
```

Loader metadata stays literal. Do not commit credentials as plaintext in a repo patch. OC2DSH also falls back in code to `OPENCODE_API_KEY` / anonymous `public` — that is special identity for that provider lane, not a general license to hard-code secrets.

## Invalid config

The schema runs **at mount**. Illegal values must fail that row's load with an actionable error, not skip. Constraints that depend on other services or a runtime registry do not belong in the Schema; put them in inject + first-use.

HMR: changing config unloads the old fiber and remounts with the new config. Because registration is an effect, old contributions vanish with the disposer. A `live` profile watches the user patch; a rejected edit keeps the last working application.

## Versus a resolve function

You may also write `resolveConfig(input)` to clamp / trim (OC2DSH does). That does not replace an exported `Config` schema. Outward packages should still let the loader reject illegal types at the entry; `resolveConfig` only normalizes after the schema passes.

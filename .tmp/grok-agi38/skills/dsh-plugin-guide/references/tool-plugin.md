# Tool plugin (defineTool)

This machine's `@deepseek-ai/dsh-tools` 0.1.5-rc.2: `defineTool` produces a definition with inferred parameters and validates arguments against JSON Schema before execute; invalid arguments throw `ToolArgsError`. `ctx.tools.register` requires `output: { schema, render, presentationMeta? }`.

## Shape

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'my_tool',
  description: 'Full contract the model sees: when to call, what the arguments mean, what to do on failure.',
  parameters: {
    path: { type: 'string', required: true, description: 'Absolute path' },
    limit: { type: 'number' },
    status: { type: 'string', enum: ['a', 'b'], description: 'Enums enter type inference' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  },
  timeoutMs: 30_000, // optional; must be a positive finite number
  async execute(args, exec) {
    const caller = exec.agent
    if (!caller) throw new Error('requires a calling agent')
    exec.signal.throwIfAborted()
    return { ok: true }
  },
}))
```

Field contract:

| Field | Rule |
|---|---|
| `name` | Model-facing name. `run_code` is reserved; do not register or shadow it. |
| `description` | Body of the model contract. |
| `parameters` | A **DSL object** (one `ValueSchemaSpec` per key), not a full JSON Schema root. Supports `string` / `number` / `integer` / `boolean` / `null` / `array` / `object` / `json` / `oneOf`. |
| `output.schema` | Enforced JSON Schema subset. The `execute` return value must snapshot losslessly and pass validation against this schema. |
| `output.render(args, value)` | Turns canonical JSON into model-visible content blocks. |
| `execute(args, exec)` | Returns only canonical JSON. Observe `exec.signal`. `exec.agent` is the caller (cwd, session, id). |
| `timeoutMs` | If present: `Number.isFinite(timeoutMs) && timeoutMs > 0`, otherwise `defineTool` / `register` throw. |
| `isConcurrencySafe` | Optional; treated as `false` when argument validation fails. |
| `presentCall` / `presentResult` | Optional; for Host-local consumers. The built-in Web Client does not use these hooks. |

## Thrown errors become isError

The pipeline turns exceptions thrown by the tool body and unknown tools into structured error results: **the call fails but the current turn does not end**:

- Unregistered / not directly callable after PTC folding → `UNKNOWN_TOOL` (`ToolNotFoundError`)
- Return value fails `output.schema` or cannot be lossless JSON → `INVALID_TOOL_OUTPUT`
- Cooperative cancel: before entering `execute` → `ABORTED_BEFORE_DISPATCH`; after enter, a successful result may be replaced with `ABORTED`
- Timeout → `TOOL_TIMEOUT`

So the tool body may express a business refusal with `throw new Error('...')` (AgentTeams uses this pattern). Do not hand-assemble `{ isError: true }` as a canonical return; the canonical success path returns only the schema value.

## waterfall

Fixed order (this machine's `ToolRuntime`):

1. `tools/pre-execute`: reorderable allow / deny / ask
2. `ctx.tools.guard()`: monotonic synchronous guards after that; later listeners cannot flip a deny back to allow
3. `tools/execute`: wraps canonical dispatch (timeout, retry, metrics). `ctx.waterfall(..., "tools/execute", exec, () => dispatchToolBody)`
4. `tools/post-execute`: inspect or replace the result, attach context
5. Definition-owned `finalizeContent`
6. Observe-only `tools/result`

Do not call the tool body by bypassing the registry. `ctx.tools.restrict({ allow | deny })` applies only to contexts that **have an agent scope**; a global restrict would mask every agent and the API throws.

## Presentation modes

`dsh-tools` `Config.mode`: `native` (default) / `ptc` / `both`. Under PTC the model mainly sees reserved `run_code`; calling any other visible tool is `UNKNOWN_TOOL` before policy. External plugins register ordinary native tools; do not implement `run_code`.

## Counterexample: Zen fingerprint stub

OC2DSH's `OFFICIAL_ZEN_TOOLS` is a set of **unused official desktop tool-name stubs** (`bash` / `read` / `write` / …). Descriptions are deliberately "this tool is useless" and parameters are placeholder objects. They exist only for anonymous Zen-lane request identity; they are **not defineTool** templates. Do not treat a Zen stub as defineTool and do not copy them into `ctx.tools.register`.

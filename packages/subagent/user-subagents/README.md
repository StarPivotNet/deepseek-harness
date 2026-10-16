# dsh-user-subagents

English | [中文](README.zh.md)

User-authored subagent definition library. `UserSubagents` provides `ctx.userSubagents` and exposes the `user-subagents` settings namespace from its live volatile Config; the Settings page writes the library through the entry's settings namespace.

The settings page owns create, edit, and delete. [`dsh-tool-subagent`](../tool-subagent/README.md) reads the live library and applies a selected definition's persona and tool filter at start.

- `ctx.userSubagents.current()` returns a detached `{ definitions }` snapshot.
- `ctx.userSubagents.get(id)` returns one definition, or `undefined` when the id is missing.
- A definition may set `allow` and/or `deny`. Omitting both produces no tool filter.

Unknown ids, duplicate ids, empty names, and empty filter names fail at the Settings write.

## Model Experience

### Selected user definition

#### What the model sees

When a library is non-empty, the parent `subagent` tool advertises an optional `agent` enum of definition ids and short descriptions. Choosing one applies that definition's persona and tool filter to the child. Omitting `agent` keeps the tool instance's configured composition.

#### Token effect

Each listed definition adds its id and description to the parent tool schema. The child's prompt then carries that definition's persona instead of the deployment persona.

#### KV Cache effect

Prefix-stable while the library ids, descriptions, and earlier tool schemas stay identical. Creating, renaming, deleting, or reordering a definition may invalidate reuse from the first changed tool-schema token.

## Known Limitations and Deferred Work

- Definitions are process-wide, not per session. Every parent that can call `subagent` sees the same library.
- A definition cannot change the child's provider, model, or depth cap. Those remain tool-instance configuration.

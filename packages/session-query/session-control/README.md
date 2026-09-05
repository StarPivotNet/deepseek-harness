# `@deepseek-ai/dsh-session-control`

English | [中文](README.zh.md)

`ctx.sessionControl` is the trusted in-process directory over every logical session. It searches identities with live driver status, stops an attached turn, and delivers a later user-role message to a live Agent. It consumes `ctx.sessionQuery`, `ctx.agents`, and `ctx.sessions`. Hosts and plugins may opt into the service; it registers no model-facing tool.

## Public API

- `search(request?, signal?)` lists the live-preferred corpus from `ctx.sessionQuery.listSessions()`, attaches each row's latest title, live Agent status, and registry-global `archived` bit when `ctx.workspaceRegistry` is mounted. It filters a case-insensitive substring against session id, cwd, and title. `archive` defaults to `all` and may be `only` or `exclude`; the filter runs before `limit`. Without the registry every row is `archived: false` and `only` is empty. An empty query returns the newest-first corpus up to `limit`. Title reads follow newest-first corpus order in batches sized to the remaining result count and stop once `limit` matches are collected. Message bodies are not searched.
- `get(sessionId, signal?)` returns one directory row, including `archived`. A missing identity fails with `SESSION_CONTROL_SESSION_NOT_FOUND`.
- `stop(sessionId, signal?)` cancels the live Agent's current turn with `keepInbox: true`. A known identity without a live Agent is an accepted no-op. The call never resumes a cold session.
- `send(request, signal?)` delivers one non-empty text block through `followup()` (`queue`) or `steer()`. A live Agent is required. A known storage-only identity fails with `SESSION_CONTROL_RESUME_REQUIRED` instead of taking an `AgentHandle` the caller or subagent continuation manager must retain. An unknown identity fails with `SESSION_CONTROL_SESSION_NOT_FOUND`.

## Activity

| Value | Meaning |
|---|---|
| `running` | A live Agent has an active driver. |
| `idle` | A live Agent is attached between turns. |
| `ready` | The identity exists in the logical corpus and has no live Agent. |

`archived` is independent of activity: a grouping hide, not a corpus deletion. It is `true` only while the id is in `ctx.workspaceRegistry.archivedSessionIds`.

## Configuration

| Key | Default | Contract |
|---|---:|---|
| `searchLimit` | `50` | Default result cap for `search()` when the request omits `limit`; must be a positive safe integer. |

## Model Experience

None, as this trusted directory returns cloned session records only to its callers and registers no model-facing prompt, schema, tool, or message.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No caller authorization** — this is trusted context-wide infrastructure; a model tool or UI must constrain which sessions its caller may inspect or mutate.
- **No cold resume** — `send()` refuses a storage-only identity rather than calling `ctx.agents.resume()`, because resume returns an `AgentHandle` the continuation manager or Host resolver must own.
- **No body discovery** — search inspects id, cwd, and folded titles. Full-text body search remains on `ctx.sessionQuery` and its opt-in model consumer.
- **Cold title scans** — a query with few or no matches can still inspect every eligible session. Uncached titles can require reading and decompressing complete logs; `limit` caps results, not elapsed time or total scanned bytes. Callers can supply an `AbortSignal` to cancel the search.

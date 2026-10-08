# Project status

Checked: 2026-10-08. Source baseline: the checkout declaring `0.1.6-alpha.3.3` in [package.json](package.json). This is a bounded source inspection, not a release or deployment acceptance report; reassess affected facts when starting a task.

## Reading path

Read [AGENTS.md](AGENTS.md), this page, then the owning subsystem documentation and source. Read only the dependencies needed for the task; update the affected knowledge when behavior or a durable decision changes.

| Context | Owner |
|---|---|
| Architecture and module relationships | [Architecture](docs/architecture.md) |
| Decisions, rationale and proposal lifecycle | [Agent Notes](.agents/notes/README.md); browse the relevant lifecycle/class directory |
| Current task record | [Tasks](docs/TASKS.md) |
| Development and verification commands | [Development](docs/development.md), [testing](docs/testing.md) and the scripts in [package.json](package.json) |

The existing architecture and Agent Notes satisfy the architecture/decision roles; do not create parallel `ARCHITECTURE.md` or `DECISIONS.md` catalogs.

## Observed capability and acceptance

The following entry points were inspected. This is not a complete feature inventory.

| Capability | Implementation evidence | Acceptance in this initialization |
|---|---|---|
| Profile-based CLI dispatch | Implemented: [CLI entry](apps/cli/src/bin.ts) dispatches profiles, plugin management, config inspection and desktop launch | Not exercised |
| Plugin-based agent lifecycle | Implemented: [agent-loop entry](packages/core/agent-loop/src/index.ts) registers agent construction and lifecycle services | Not exercised |
| Durable session storage | Implemented: [JSONL persistence](packages/session/session-persistence-jsonl/src/index.ts) provides session handles and generation storage | Persistence/recovery not exercised |
| Remote service dispatch | Implemented: [API gateway](packages/api/gateway/src/index.ts) provides remote dispatch and stream handling | Browser/client acceptance not exercised |

## Scope and unknowns

No product implementation task or release target is established by this initialization. Existing proposals retain their own lifecycle; their presence does not establish accepted or active work. Deployment health, provider access, production version and user acceptance remain unverified. Machine paths and the precise checkout baseline belong in ignored `AGENTS.local.md`.

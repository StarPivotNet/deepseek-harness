# Project status

Checked: 2026-10-08. Source baseline: the checkout declaring `0.1.6-alpha.3.3` in [package.json](package.json). Branch: `master`; tracked files were clean at calibration start, while pre-existing untracked personal and agent artifacts remain outside this change. The exact local HEAD is recorded in ignored `AGENTS.local.md` because repository reference rules prohibit commit identifiers in maintained shared documents. This is a bounded source inspection, not a release or deployment acceptance report; reassess affected facts when starting a task.

## Reading path

Read [AGENTS.md](AGENTS.md), this page, then the owning subsystem documentation and source. Read only the dependencies needed for the task; update the affected knowledge when behavior or a durable decision changes.

| Context | Owner |
|---|---|
| Architecture and module relationships | [Architecture](docs/architecture.md) |
| Decisions, rationale and proposal lifecycle | [Agent Notes](.agents/notes/README.md); browse the relevant lifecycle/class directory |
| Current task record | [Tasks](docs/TASKS.md) |
| Development and verification commands | [Development](docs/development.md), [testing](docs/testing.md) and the scripts in [package.json](package.json) |

The existing architecture and Agent Notes satisfy the architecture/decision roles; do not create parallel `ARCHITECTURE.md` or `DECISIONS.md` catalogs.

## Engineering baseline and constraints

This is a TypeScript ESM monorepo using Cordis plugins, pnpm workspaces and the scripts in [package.json](package.json). The declared toolchain is pnpm `11.7.0` with Node `^22.19.0 || >=24.0.0`. [CI](.github/workflows/ci.yml) separates static, coverage, benchmark, consumer and platform checks; none of those remote jobs was verified by this initialization.

The current phase is documentation calibration of an existing implementation, not initial product development. Public APIs remain pre-stable, not frozen. Released Session generations must not be overwritten or deleted; migrations use adjacent successors, and SQLite schema versions are monotonic. [AGENTS.md](AGENTS.md#pre-stable-apis-and-released-session-data) owns these compatibility rules. The [architecture](docs/architecture.md) owns plugin composition, turn flow, session logging and client/host relationships; [Agent Notes](.agents/notes/README.md) owns decision rationale and separates proposals from implemented decisions.

## Observed capability and acceptance

The following entry points were inspected. This is not a complete feature inventory.

| Capability | Status and implementation evidence | Acceptance in this initialization |
|---|---|---|
| Profile-based CLI dispatch | Already implemented: [CLI entry](apps/cli/src/bin.ts) dispatches profiles, plugin management, config inspection and desktop launch | Not exercised |
| Plugin-based agent lifecycle | Already implemented: [agent-loop entry](packages/core/agent-loop/src/index.ts) registers agent construction and lifecycle services | Not exercised |
| Durable session storage | Already implemented: [JSONL persistence](packages/session/session-persistence-jsonl/src/index.ts) provides session handles and generation storage | Persistence/recovery not exercised |
| Remote service dispatch | Already implemented: [API gateway](packages/api/gateway/src/index.ts) provides remote dispatch and stream handling | Browser/client acceptance not exercised |

## Scope and unknowns

No product implementation task or release target is established by this initialization. Existing proposals retain their own lifecycle; their presence does not establish accepted or active work. Deployment health, provider access, production version and user acceptance remain unverified. Machine paths and the precise checkout baseline belong in ignored `AGENTS.local.md`.

## Work status

| Status | Current evidence |
|---|---|
| Already implemented | The bounded capabilities above and the project documentation reading path |
| In Progress | No active product implementation task is confirmed |
| Blocked | Repository-wide validation is failing; documentation initialization does not establish push or release readiness |
| Planned | Triage existing verification failures and establish the desired branch baseline before a future publish attempt; this is a recommendation, not authorization for repair or merge work |

Product gaps outside the inspected entry points remain unconfirmed. No feature completion percentage or production readiness is inferred.

## Verification and known issues

Results below were observed on 2026-10-08 during this documentation task. Source, dependency and configuration inputs were unchanged between the initial checks and this calibration; prose edits receive targeted checks. These results are not a permanent certification of the branch.

| Check | Result and limits |
|---|---|
| New-document links, staged bilingual pairing and whitespace | Passed for the initialization documents; the calibration repeats affected checks |
| Documentation build and documentation TypeScript checks within `pnpm run doc-sync` | Passed; runtime behavior was not exercised |
| `pnpm run test:docs` and `pnpm run doc-sync` | Failed in existing files: type/document drift, broken or incorrectly localized links, catalog/reference checks, README/Agent Note format checks, documentation budgets and documentation-site checks |
| `pnpm run lint` | Failed in existing source/test files, including unsafe typed access in `apps/web/tests/automation-sidebar.e2e.ts` |
| Unit, integration, provider, browser and deployment acceptance | Not run for this documentation-only task |

Concrete existing failures include a duplicate `reasoningEffort` member in the `AgentOptions` documentation block in [core reference](docs/subsystems/core.md), and word-budget excesses in [architecture](docs/architecture.md) and [package rules](packages/AGENTS.md). Their owners must resolve or explicitly triage the failures before claiming repository checks pass. Local branch divergence and checkout-specific evidence are recorded in ignored `AGENTS.local.md`; this task does not merge, rebase or repair unrelated work.

## Incremental workflow

1. Read `AGENTS.md`, this status page, then only task-owned documents: architecture for relationships, Agent Notes for decisions, and the task ledger for continuation. Locate source and necessary dependencies before editing; expand beyond that scope only for a concrete dependency or architecture question.
2. Implement only the requested behavior and necessary dependencies. Preserve documented compatibility constraints; report a conflict requiring a user decision instead of relaxing it. Do not add unrelated refactors, toolchain upgrades, public-interface changes, compatibility removal, historical-system restoration or future features.
3. Select verification from current scripts and owning rules. Build, static checks, tests, exercised runtime behavior and user acceptance are distinct evidence. Preserve failures and missing prerequisites; add tests or infrastructure only within task authorization.
4. Update the owning status, task, architecture or decision document only when the work changes that knowledge. A local string, JSON or configuration edit does not automatically require rewriting all project documents.

---
name: takeover-codebase
description: Use when taking over, onboarding onto, or understanding an existing large codebase before changing it — 接手已有项目, 理解整个仓库, 熟悉代码, first look at a legacy/unfamiliar repo of thousands or tens of thousands of lines. Do not use for a named one-file bugfix, a greenfield app, or "just add this small thing" when the user already knows the files.
---

# Takeover mode

You are onboarding onto a large existing repo. Until the map is delivered, you are a reader, not an author. The goal is a working mental model the user can correct — not a complete dump, not a rewrite.

## Hard rules

- No `file_edit` / `file_write` / formatters / refactors / drive-by cleanup. Do not create `ARCHITECTURE.md` or notes files unless the user asked.
- Do not claim you "understand the whole project" after listing folders.
- Do not read the tree leaf-by-leaf. Map first, then one vertical slice.
- Do not start implementing the user's eventual feature during mapping. If they named a task, park it until the brief.
- Existing codebases get surgical changes later. Takeover is not permission to redesign.
- If the cognition ledger exists, read it before re-deriving architecture from source. Use live catalog tools for knowledge; credit only what you actually used. `grep` / `glob` for a file name, a config key, or comment text. For a symbol or a flow, `codegraph_status` then `codegraph_explore`. If status says the project is not initialized, `codegraph_init` once, then explore. Do not call `codegraph_reindex` or `codegraph_overview` unless that name is in this session's tool list, and do not write `codegraph.json`. If codegraph says the project is not indexed and you did not init, map with `grep` / `file_read` and say the graph was not used.
- Root `AGENTS.md` / `CLAUDE.md` may already be in context — do not re-read those. Do read nested ones when you leave CWD.

## Budget

Three waves, then stop mapping.

| Wave | What | Typical tool shape |
|---|---|---|
| 1 | Skeleton | Parallel `glob` / `grep` / `pwsh` / `file_read` of manifests + top docs. `codegraph_status` alongside the manifests. `codegraph_init` once if that call says the project is not initialized and a later slice needs the graph; a failed init ends the graph attempt |
| 2 | Runtime + one slice | How it builds/runs/tests; trace one path end to end |
| 3 | Brief | Talk to the user. No more exploration unless a hole blocks the brief |

Skip wave 2 only if wave 1 already shows a tiny single-package repo. If the repo has several apps/packages, launch **read-only** `subagent`s in parallel (one per major package or one for docs vs one for runtime). Do not wait for the user to ask.

Stop a wave when the next read would be a leaf implementation file that is not on the slice.

## Wave 1 — skeleton (one turn, all independent calls together)

Fire together:

- Index health, not the opener: `codegraph_status` alongside the manifests. Call `codegraph_init` once if status says the project is not initialized and wave 2 needs the graph. If init fails, do not retry it; the skeleton comes from the files below. Workspace identity: `pwd`; `git rev-parse --show-toplevel`; default branch; `git log -20 --oneline`; dirty or not (status only).
- Top-level layout: list the repo root, not a recursive dump. Note apps, packages, generated dirs (`dist`, `node_modules`, `target`, `.next`, `vendor`).
- Manifests: `package.json`, `pnpm-workspace.yaml`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, `build.gradle*`, `*.sln`, `CMakeLists.txt`, `docker-compose*.yml`, `Makefile`.
- Agent/dev docs: `README*`, `CONTRIBUTING*`, `AGENTS.md`, `CLAUDE.md`, `docs/`, `.github/workflows/`.
- Entry hints: `glob` for `main.*`, `index.*`, `app.*`, `server.*`, `cmd/**`, `apps/**`, `packages/**`.

Classify before reading source:

- Language mix and package manager
- Monorepo vs one app
- Which trees are source vs generated vs vendored
- Where the "product" actually lives (ignore tooling repos nested inside)

If git history is dense, skim subjects only — migrations, renames, "the foo rewrite" — do not read patches.

## Wave 2 — runtime and one slice

**Runtime** (commands, not novels):

- Install / build / test / dev / lint as the repo documents them. Prefer the script names in manifests and CI over inventing commands.
- Do not run a full test suite or a long install just to "feel" the project. Read CI and package scripts. Run only a cheap `--help` / dry version if identity of the command is unclear.
- Record env file *names* (`.env.example`). Never dump secrets.

**One slice** — pick exactly one:

- If the user named a subsystem, that one.
- Else the primary user-facing app, or the package CI spends the most time on.
- Trace one request, CLI invocation, page, or job: handler → domain → storage → outbound I/O. Use `codegraph_explore` for the symbols on that slice (`codegraph_status` first). A string, a route, or a config key on the same slice stays `grep` / `file_read`. If the index is missing, `codegraph_init` once; if that fails, trace the slice from the files and say so.
- Read types, routers, and module index files. Do not read every sibling.

Look for boundaries, not trivia:

- Where new features are supposed to land
- Cross-package imports / public API of each package
- Error handling, logging, config, and test layout *as conventions*
- Auth, migrations, generated clients — mark as hot zones, do not fully audit

## Wave 3 — brief the user

Lead with the map. Use GitHub-flavored markdown. Keep it to one screen unless they asked for depth.

Required sections:

1. **What this is** — one paragraph. Product + runtime shape (CLI / web / services / lib).
2. **Layout** — the 5–10 directories that matter, each with one clause. Explicitly ignore generated/vendor trees.
3. **How to run** — install, dev, test, as the repo actually spells them. Say "not documented" rather than guessing.
4. **Where truth lives** — the files/packages you would open first for a typical change.
5. **Conventions** — only what you saw (test next to code, error type, logging, codegen). No invented style guide.
6. **Hot zones** — generated code, migrations, auth, public API, anything a first commit should not touch.
7. **Unknowns** — what you did not read. Be specific.
8. **First safe change** — if they already named a task, say where it should go in one short paragraph. If they did not, ask what to do next.

Then stop. Do not enter an implementation loop. If they want a plan for the named task, `enter_plan_mode`. If they want a small fix in a file you already located, do that surgically.

## Don't

- `file_edit` / `file_write` / formatters / drive-by cleanup during mapping.
- Claim you understand the whole project after listing folders.
- Start AgentTeams or write-capable children while mapping.
- Treat `node_modules`, lockfiles, or generated protobufs as source.

## Red flags (skill-specific; general excuses: see `using-superpowers`)

- Recursive `glob *` and then reading every hit
- Pasting a directory tree into chat as if that were understanding
- "I'll just clean this up while I'm here"
- Writing a new architecture doc the team did not ask for
- Starting AgentTeams / write-capable children during mapping (read-only `subagent`s are required when packages are independent)
- Running the entire test suite as a tour
- Treating `node_modules`, lockfiles, or generated protobufs as source

## Freshness of the map

A map is current only when this turn observed the tree it claims to describe. Recalling an earlier brief, a compacted recap, or a ledger copy does not satisfy freshness.

Before briefing, and again before anyone edits from that brief:

1. **Observe the included tree this turn.** List source files you actually opened (`file_read` / `glob` / `codegraph_*`). Skip, case-insensitively: `.git`, `node_modules`, `dist`, `build`, `target`, `.next`, `vendor`, `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.mypy_cache`. Do not treat size/mtime as proof the map is current.
2. **Bind cited facts.** Every load-bearing claim (entry, how to run, where truth lives, hot zone) names a path you actually opened this turn. If that file changed since the last brief, reopen it and rewrite the claim.
3. **Observe the branch marker.** Read the working tree's `.git/HEAD` file as an observation at gate time. Do not follow a `gitdir:` pointer or an external worktree. A different HEAD means the map is for a different tree; do Wave 1+2 on the delta, do not keep the old brief.
4. **View receipt.** Fold HEAD, the files you opened, and `git status` into this session's cognition ledger under Layout / Where truth lives. An agent that did not view *this* receipt must re-read the ledger map **and** reopen the cited files before editing. Re-reading skill sources alone does not refresh a map-view receipt.
5. **An inventory is not architecture.** Listing files does not prove a semantic claim is true. Uninspected areas stay explicit unknowns.

After compaction, a child handoff, or a failed check: compare the ledger snapshot with a fresh `git status` and reopen cited files. Changed or deleted evidence reopens the claim. If a later task leaves the mapped slice, do a short targeted wave 1+2 on that slice only — that is a new view receipt, not a license to skip observation.

## After takeover
The map is session memory, not a license to keep exploring. Fold What this is / Layout / How to run / Where truth lives / Hot zones / Unknowns **and the freshness view receipt** into this session's `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md` (load `session-cognition` if needed) so compaction does not erase it. Subsequent turns follow normal coding rules: minimal diffs, match neighbors, run the nearest test. Before those edits, run **Freshness of the map** — a later slice still needs a new view receipt and a this-turn reopen of cited files, not a restart of full takeover.

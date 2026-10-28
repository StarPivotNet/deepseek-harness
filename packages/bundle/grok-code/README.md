---
description: "Built-in Grok Code preset: Grok work strategy, a think-act task queue, plan mode, subagent and AgentTeams delegation, and a bundled reverse-engineering skill library."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-grok-code`

English | [中文](README.zh.md)

## Summary

Select the `grok-code` preset to run a session on the Grok Code composition: a Grok persona, the Standard-mode tool roster plus workflow and Ralph, plan mode with an explicit enter tool, a per-turn task queue, and a skill catalog that ships 27 skills including 124 reverse-engineering methods. The preset is declared to the agent-preset registry at startup, so it appears in the mode dropdown of every profile that selects this bundle. Nothing installs it separately and nothing scans a directory for it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Pick **Grok Code** in the new-session mode dropdown, or name it explicitly:

```sh
dsh --profile web --agent-preset grok-code
```

A session may switch to this preset only while it has produced no messages or tool calls; after that the composition is fixed for the session's life. Deleting `$DSH_HOME/.agent-presets/grok-code` has no effect on this preset — the composition ships inside this package.

The preset's skills load through the `skill` tool. Its `agi-reverse` skill is a gateway: it names a method file under `presets/grok-code/skills/agi-reverse/library/` for the artifact the user named, and the model reads that file instead of calling `skill` for a `re-*` name.

----- 

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`@deepseek-ai/dsh-grok-code` is one row in the base bundle's composition (`packages/bundle/base/cordis.patch.yml`), which mounts it for every profile. The row resolves to this package's entry in `src/index.ts`, which reads `presets/grok-code/agent.cordis.yml` with the Loader's own YAML dialect (`entryListSchema`, so `!!js` survives as data), rewrites relative row names into file URLs inside this package, replaces the `skill-filesystem` row's skill directory with the copy shipping here, and hands the result to `agentPresets.register()`.

The runtime declares no injection: the registry may be composed after this row, so it polls `ctx.get('agentPresets')` on a 400 ms timer for up to 45 s and logs one warning if the service never appears. Its own registration is disposed through `ctx.effect`, so a reload removes the declaration with the plugin.

Why the registry and not discovery: under this release the mode dropdown reads registry declarations only. A directory under `$DSH_HOME/.agent-presets` supplies composition files but never becomes a selectable mode, which is why the same preset installed by hand also needs a profile patch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Package entry: reads the composition, declares it, owns the skill directory |
| [`presets/grok-code/agent.cordis.yml`](presets/grok-code/agent.cordis.yml) | The preset composition |
| [`presets/grok-code/preset.yml`](presets/grok-code/preset.yml) | Display name and description |
| [`presets/grok-code/skills/`](presets/grok-code/skills) | Bundled skills |
| [`tests/grok-code.spec.ts`](tests/grok-code.spec.ts) | Composition, row-resolution, and declaration checks |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent presets](../../preset/agent-presets/README.md) — the registry, the roster, and how a declaration reaches the dropdown.
- [Red-team bundle](../redteam/README.md) — the other preset shipped from a bundle, using the same declare-at-startup shape.
- [Tool skeleton](../../core/tools/README.md) — the tools this composition selects.

-----

<a id="model-experience"></a>
## Model Experience

### Grok Code composition

#### What the model sees

The persona is a Grok framing: work policy, goal completion, tool calling, memory in a per-session cognition ledger, background tasks, code-change rules, validation rules, project instructions, judgment, parallel work, skills, communication, formatting, and a thinking chain. The task queue is `todo_write`; durable work rides the configured goal tools. Tools are the Standard roster plus `subagent`, `subagent_fork`, `workflow`, `ralph`, `enter_plan_mode`, `exit_plan_mode`, and `calculator`. Skills are the 27 directories under `presets/grok-code/skills`, advertised by name and description only.

#### Token effect

The persona is the dominant fixed cost and is large: it carries the work policy and the validation contract inline rather than loading them as skills. The skill catalog adds one line per skill, not their bodies. Every skill body is a tool result on demand; `agi-reverse` method files are read with the file tool and are never catalog entries. Compaction is configured earlier and harder than the Standard preset (threshold ratio 0.82, retain ratio 0.42), and tool results above 120000 characters are pruned to head and tail.

#### KV Cache effect

Stable for a fixed composition, because the persona text and the tool schemas do not change between turns and the preset never writes workspace state into the prompt. The pre-step snapshots (`todo`, ledger, notes) append text as turns advance and end cache reuse only when their content actually changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The composition names tools and plugins this bundle does not ship** — `codegraph_*`, `read_page`, `x_search`, `agent_teams_*`, `super_goals_*`, and `set_subagent_reasoning_effort` come from marketplace plugins. A profile without them mounts this preset with those names absent, and the persona text describing them stays in the prompt.
- **The VMProtect export catalog is a 46 MB binary blob** — `presets/grok-code/skills/agi-reverse/library/re-vmp/catalog/` carries the Windows DLL export dump (`catalog.json`, `catalog_32.json`, and both `ntdll` images) the unpacker reads. `vmp3104.py doctor` reports all four as `ok`, but `pefile`, `capstone`, and `unicorn` are required separately; the doctor names each missing module.
- **The skills carry upstream attribution** — `agi-reverse` documents rev-skills by dslsdzc under CC BY 4.0, and `minecraft-build` ships the GPLv3 SDK and viewer without their `LICENSE` file.
- **The upstream preset's own test suite is not carried** — it asserts an `x-compaction-at` value the header plugin no longer emits, so importing it would add a permanently red suite that tests nothing this package owns.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The composition is a copy of the upstream `dsh-grok-agi` preset with four local corrections: the workflow provider is `workflow-ptc` because `dsh-workflow-worker-thread` is not a dependency of this repository; `official-file-prompt-shadow` is disabled because it blanks the file-tool prompt sections; `tool-web` keeps `fetch: true`; and the `{{cwd}}` template was removed because no plugin registers that prompt variable and interpolation throws on an unknown name. Keep those corrections when re-syncing from upstream.

</details>

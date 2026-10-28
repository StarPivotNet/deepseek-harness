# @deepseek-ai/dsh-tool-automation

English | [中文](README.zh.md)

The model-facing Consumer for [`ctx.automation`](../automation/README.md): `automation_list`, `automation_create`, `automation_update`, `automation_delete`, and `automation_set_enabled`.

## Tools

- `automation_list()` returns every rule with `state` and `nextAt`.
- `automation_create(...)` requires a non-empty `task` and exactly one selector. The model may infer Host Automation intent from a direct human request to create a scheduled or repeating task, without an exact command phrase, and must not start that work in the current session. Omitted `workspace_id` uses the current session workspace. Omitted `permission_preset` keeps the user default; unattended writes must name `danger-full-access`. `on_overlap` defaults to `skip`.
- `automation_update(id, ...)` applies a sparse patch. Changing the schedule still requires exactly one selector field.
- `automation_delete(id)` removes the rule and keeps run history.
- `automation_set_enabled(id, enabled)` arms or disarms without rewriting the selector.

All five calls are exclusive. UI clients receive generic cards.

## Authority

Mutations require the exact live root Agent, an open turn, and a `{ kind: 'user' }` message in that turn. `Agent.followup()` and plugin fires that omit a source inherit `user`, so Automation itself must pass `{ kind: 'automation', ruleId }`. Subagents do not receive these tools.

## Model Experience

### System prompt

#### What the model sees

A fixed Host Automation policy says when semantic human intent warrants creating a later or repeating new-session rule, forbids doing that work in the current session, and names the one-selector and unattended-permission rules.

##### Host Automation policy

```markdown
Use Host Automation tools when the user asks to create, list, change, pause, or delete a scheduled automation or timed task that should run later or on a repeating wall-clock schedule, in any language and without requiring the words Host Automation. automation_create may infer that intent from a direct human request. Do not start the requested work in this session, and do not use session-local reminders, goals, jobs, or workflows for that request. Write task as the complete prompt the future session should execute. Choose exactly one selector: after_seconds, at, every_seconds, or local_clock. Daily or weekly local times use local_clock with the request time zone from time context. Unattended writes or commands need permission_preset danger-full-access. Call automation_list before updating or deleting a rule.
```

#### Token effect

Small fixed input cost on every request where this plugin's prompt registration is in scope.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Activation or disposal may invalidate reuse from this prompt section.

### Scoped management tools

#### What the model sees

Root Agents created after this plugin loads see the five generated schemas. Results are canonical JSON of the service views.

#### Token effect

The schemas add a fixed request prefix while the plugin is installed. Each call adds its JSON result through the ordinary tool-result pipeline.

#### KV Cache effect

The schemas stay prefix-stable while their definitions stay unchanged. Calls append to later history.

## Known Limitations and Deferred Work

- **No `automation_run_now` tool** — manual fire stays on the Host RPC / Settings path so a model cannot start a second Session from inside a conversation without a schedule.
- **Semantic intent remains model judgment** — execution can prove that the current turn contains a direct human message, not whether the request asked for a Host Automation rule rather than immediate work.

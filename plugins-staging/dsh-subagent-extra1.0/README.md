# dsh-subagent-extra

Gives the model `set_subagent_reasoning_effort`. After a call, subagents spawned directly by that session use the chosen reasoning effort. This session's own effort does not change. Nested children are unchanged unless that child sets its own override.

The official `subagent` tool only exposes `reasoning_effort` when child model selection is enabled. This plugin is the control when that field is absent. It listens to `agent/request` once for the profile. A preset row cannot do that: each agent loads the preset separately, so a value stored on the parent is not visible when the child request is built.

The stored id is checked against the calling session's advertised reasoning efforts. A model that advertises none cannot set an override. The id is applied only when the child request uses that same provider and model. A child on another route keeps the host's own effort selection, including a model default after a route change.

`dsh-thinking-effort` still fills a static subagent effort only when the request has none. On the same route, a value set here replaces that fill and also replaces effort inherited from the parent. Clearing the override restores that behavior.

Install it yourself, then restart the profile:

```
dsh plugin --profile <name> add C:\Users\yuluk\.dsh\plugins\dsh-subagent-extra
```

Do not add `isolate` to this row. The listener has to see child sessions outside the parent preset realm.

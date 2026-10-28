---
name: session-handoff
description: Use when the user asks to hand this conversation to a fresh background agent that continues the work now — handoff, continue in a new agent, pick up where we left off. Do not use for a one-shot read-only probe, a reviewer, or a multi-file team; those are `subagent` and `agent-teams`.
---

# Handoff to a fresh background agent

A fresh DSH `subagent` is the background agent, and the handoff summary is its prompt.

The child does not see this conversation, this session's ledger, or your thoughts. The prompt is the whole handoff. Launch it in the background and return immediately. The user steers it later through you with `send_message`; you recall it with `list_agents`.

## When

**Do:** the user asks to hand off, continue in a fresh agent, or pick the work up in the background now.

**Don't:** a one-shot read-only probe or review (`subagent` with the six-slot review contract), a multi-file / parallel / durable team (`agent-teams`), or work you should finish in this turn. Do not fork a child that inherits this conversation: that keeps the context the handoff exists to leave behind. Launch only a fresh `subagent`.

## Steps

1. If the user passed arguments, that text is what the next agent focuses on. Tailor the summary to it. Otherwise hand off the unfinished work in this conversation.
2. Write the summary in the shape below. Reference specs, plans, ADRs, issues, commits, and diffs by path or URL. Do not paste their contents. Redact API keys, passwords, tokens, and other secrets or personally identifiable information: the summary becomes the child's prompt.
3. Load `session-cognition` when this session has a ledger, read `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md`, and put only the live Goal, Constraints, Kills, and Next into the prompt. Do not paste the whole ledger. Do not tell the child to rewrite it.
4. Launch `subagent` with `run_in_background: true` (the default). `description` is a short display name, 3–5 words, such as `Fix login bug`. `prompt` is the summary. Call `set_subagent_reasoning_effort` first with `reasoning_effort` `off`, `low`, or `medium` — not `high` or `xhigh`. An implementer may use `medium`. A read-only continuation uses `off` or `low`.
5. The call returns a durable agent id. Tell the user that id and the display name. Stop. Do not wait for the result, do not poll `job_output`, and do not keep doing the handed-off work in this session.

Done when the background `subagent` call has returned an agent id and the user has that id.

## Summary shape

```
You are a fresh DSH agent continuing work handed off from another session.
You do not have that conversation. Act from this prompt only.

## Focus
{the user's handoff argument, or the unfinished goal}

## Done so far
{facts only: paths, commands, measured results}

## Constraints
{must hold, including kills}

## Next
{the concrete next check, edit, or launch}

## Suggested skills
Call `skill` with these exact names before acting:
- {catalog skill that matches the next action}

## Acceptance
{how you know this handoff's focus is done}
```

Name only skills in the current catalog. Suggested skills are a pointer: the child loads each one, it does not receive their text inside this prompt.

## After launch

- Steer a running child at its next step, or start a turn for an idle or ready child, with `send_message` to that agent id.
- Interrupt only the current turn with `interrupt_agent`. Queued messages stay parked. Do not use it as a cancel of the handoff.
- `list_agents` recalls the id and label. Status `running` is working now, `idle` is between turns, `ready` is stored and resumable. None of those is a result.

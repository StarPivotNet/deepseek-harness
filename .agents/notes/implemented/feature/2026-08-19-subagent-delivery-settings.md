# Agent Note: Busy-state delivery settings for settlement, report, and jobs

Status: implemented

English | [中文](2026-08-19-subagent-delivery-settings.zh.md)

## Problem

Composer busy-Enter already persists through Host settings. Continuable settlement, child `report`, and Job completion still choose parent inbox placement in code. An operator who wants those notices after the current turn, or who wants a report at the nearest step, has no user setting. The three channels also disagree: settlement steers a busy parent, report always queues a later turn, and a Job injects the next step without a wake.

[Manager-owned settlement](2026-08-06-manager-owned-subagent-settlement-delivery.md) rejected a *deployment* switch that could omit the notice. That rejection still holds. What was missing is placement of a notice that is still always sent.

## Decision

Host namespace `subagent-delivery` carries three independent busy-state fields: `settlementBusy`, `reportBusy`, `jobBusy`. Each is `steer` or `queue`, schema default `steer`. The Subagents settings plugin registers the section. Settings → Subagents shows the Behavior group above the definition library. Runtime readers call `ctx.get('settings')?.get(...)` at send time; a missing settings service or unregistered section is `steer`.

Placement, in order:

1. A parent already in teardown is injected and never woken.
2. An idle parent always `followup()`s.
3. A busy parent uses the matching field: `steer` → nearest step, `queue` → later turn.

Job deployment `completionDelivery: quiet` and exhausted wake budgets leave idle completions pending without waking. Busy Job placement still follows `jobBusy`; neither setting drops the message or rewrites busy Steer into Queue.

Steer admits a notice at the next step after the current model request and tool batch finish; it does not interrupt a running tool. Runtime readers resolve placement for each notice, so a setting changed during child or Job execution applies when that work reports or completes.

The accepted product spec is [docs/specs/subagent-delivery-settings.md](../../../../docs/specs/subagent-delivery-settings.md).

## Alternatives considered

**Omit the notice or make settlement optional.** Rejected again. The parent-facing promise stays unconditional; only the inbox target changes.

**One shared busy switch.** Rejected. Settlement, report, and Jobs have different noise and urgency.

**Expose idle Quiet in the UI.** Rejected. A parked parent would never learn the outcome unless something else woke it.

**Keep report busy-Queue as the shipped default.** Rejected. The accepted contract aligns the three busy defaults on Steer.

**Register the schema on `dsh-subagent`.** Rejected. The settings plugin already owns the Subagents page; Job completion is not a subagent service concern. Readers tolerate an unregistered section by defaulting to Steer.

## Consequences

Busy report Steer can join the current turn; Queue reserves a later turn. Neither choice cancels the parent's active model request or tools.

Busy Job delivery does not spend the idle wake budget. Tests cover settings changed during execution and preserve idle quiet delivery and wake-budget exhaustion.

Composer `ui-conversation.busyEnter` is unchanged.

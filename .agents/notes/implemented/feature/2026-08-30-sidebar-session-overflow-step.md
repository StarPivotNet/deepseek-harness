# Agent Note: Sidebar Session Overflow Step

Status: implemented

English | [中文](2026-08-30-sidebar-session-overflow-step.zh.md)

## Problem

An open Workspace with many idle or History Sessions still crowded the sidebar when **Show more** revealed every remaining row at once. Users needed a bounded default and a way to reveal more rows gradually, with an explicit Settings path to leave the list unfolded.

## Decision

The workspace plugin owns a Host settings field `sessionOverflowLimit` under namespace `ui-workspace`. Supported values are `5` (default), `10`, `20`, `50`, and `all`. The General Settings row **Sidebar session expansion** writes that field.

The sidebar browser starts each open Workspace or flat History/idle cluster at that finite base limit. Each **Show more** click advances the mount-local absolute limit by the same step, capped at the ordinary-row count, so a click on twelve rows with step five reveals five more, then two. Blank New Session rows still sit outside the ordinary quota. Choosing **Expand all** leaves idle/History rows unfolded and hides the overflow control. Closing a Workspace clears only that account's transient absolute limit, so reopening returns to the Settings-owned base.

This supersedes the boolean expand-all remainder gesture from [Workspace Sidebar Order and Folding](../../archived/feature/2026-08-11-workspace-sidebar-order-and-folding.md) while keeping that note's five-row default, blank-row quota, and collapse-reset rule.

## Alternatives considered

**Keep one-click expand-all and only make the initial limit configurable.** That still dumps every remaining Session into the sidebar on the first overflow click, which is the crowding the request called out.

**Persist the advanced absolute limit across reloads.** A Workspace reopened later could occupy the full sidebar again; only the Settings-owned base is a stable preference.

**Put the control only in View options.** The request asked for Settings, and the preference is product-wide rather than a per-browser viewing mode.

## Consequences

- Default behavior still opens to five ordinary idle/History rows.
- Overflow clicks are incremental unless the user selects Expand all.
- Closing a Workspace resets only the transient step advances for that account.
- Host user-settings now carry the `ui-workspace` section for this preference.

## Testing

Package tests cover overflow math, five-then-five incremental expansion with collapse reset, blank-row quota, collapsed drag anchors after a Workspace collapse, and apply inject wiring for `settingsScope`.

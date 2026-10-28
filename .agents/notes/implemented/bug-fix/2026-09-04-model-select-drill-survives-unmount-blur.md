# Agent Note: ModelSelect drill keeps the menu open after the focused cell unmounts

Status: implemented

English | [中文](2026-09-04-model-select-drill-survives-unmount-blur.zh.md)

## Problem

The composer model seat's two-level menu drills Model and Effort by replacing the root cells with the chosen list. A pointer click that focuses a root cell then unmounts it. Chrome fires a bubbling `focusout` with no `relatedTarget` even though the pointer stayed inside the seat. `ModelSelect` treated any blur without an inside `relatedTarget` as an outside leave and closed the menu, so Effort (and Model) appeared to do nothing.

The directory picker already recorded that Safari pointer-down on a button can also produce a null `relatedTarget` ([directory picker](../../archived/architecture/2026-07-28-directory-picker-capability-seam.md)). That note owns editor cancellation, not this composer menu.

## Decision

`ModelSelect.onBlur` still closes when `relatedTarget` is a node outside the seat. When there is no next node and the event `target` is still inside the seat, or already disconnected, the handler returns without closing. That is the drill unmount: the focused cell is gone, but the leave originated inside the seat. Document `mousedown` outside-close and a later outside `relatedTarget` still dismiss the menu.

## Alternatives considered

**Prevent default on the root cells' `mousedown` so they never take focus.** Rejected because keyboard users still focus those cells, and a later drill from a focused cell would reproduce the same unmount blur.

**Keep the root cells mounted and overlay the drilled list.** Rejected because the two-level menu is one pane at a time; keeping both would change the card height and the keyboard item set for a focus bug.

**Ignore every null `relatedTarget`.** Rejected because a genuine leave that does not name a next node would then leave the menu stuck open until an outside mousedown.

## Consequences

Clicking Effort or Model in Chrome now reaches the drilled list. A keyboard Tab that leaves the seat with a named outside `relatedTarget` still closes. A null-`relatedTarget` leave whose `target` is already outside the seat still closes.

## Testing

`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` clicks Effort, then dispatches a bubbling `focusout` on the seat with `relatedTarget: null`, and a second `focusout` whose `target` is a disconnected node, and asserts the effort radios remain. A later case focuses a node outside the seat and asserts the menu unmounts.

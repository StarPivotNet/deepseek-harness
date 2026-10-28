# Agent Note: Running-model identity in the Web GUI

Status: implemented

English | [中文](2026-08-27-web-running-model-identity.zh.md)

## Problem

The Web conversation could not answer "which model is serving this turn". The composer's model seat ([session model selector](../../archived/feature/2026-07-24-web-session-model-selector.md)) names the NEXT assembled step's route and is easy to miss at rest; the session header named only the agent preset. A user comparing models mid-conversation, or rereading a session after a switch, had no on-page evidence of which model produced which reply — the fact lived only in `request/header` events and the trajectory view.

## Decision

Model identity is surfaced from the session log, never from selector state, in two read-only surfaces.

A new projection unit `requestRoute` (`@deepseek-ai/dsh-session-route`, mounted beside `session-stats`) folds the whole log's `request/header` events latest-wins into `{provider, model, reasoningEffort?}` (`null` before the first request, the title/goal no-value convention). Being a whole-log host projection, the value survives paging and compaction. `ui-model-selection` registers a header chip on `conversation.session.header.actions` (id `model-identity`, order −5) that reads the projection, resolves the catalog display name and effort label through the same per-session `modelDirectories` directory the composer seat uses, and renders `name · effort` with raw-id fallbacks. It renders nothing before the first dispatched request, so it never echoes an unsent selector choice.

Per-step identity rides the chat fold. `finalNode` now maps `assistant/message.source` to `provenance` (the trajectory fold's existing mapping), and a hidden `chat-request-header` carrier definition lets `ChatSnapshotBuilder` stamp each `AssistantChatData` with the `requestConfig` of that step's own header, using the trajectory join semantics: step-keyed exact match with later in-step header winning, otherwise inheritance of the latest header predating the step. A new single slot `conversation.chat.assistantRoute` (owner: `requestConfig?`, `provenance?`) renders under the assistant narration's clock; `ui-model-selection` occupies it, preferring `provenance` for the identity (the provider that actually served) and `requestConfig.reasoningEffort` for the effort segment.

Identity for the clock line prefers `provenance` because `assistant/message.source` records what served that step even under provider-level retries, while the request header records what was assembled. The header chip reads the projection instead of the fold because it must answer for a session whose last turn is outside the paged window.

## Alternatives considered

**Reuse the composer seat as the identity surface.** The seat names the next step's route, which is a different fact; a user who switched the selector without sending would see a label that lie about what ran.

**Derive the header label from the trajectory view.** The trajectory fold is owned by `ui-trajectory` and couples the chip to an optional package; the projection is the seam designed to survive window paging.

**Persist per-message model labels as session events.** The identity is already reconstructable from logged events (`request/header`, `assistant/message.source`); new events would violate the model-visible-⟺-logged economy without adding information.

**Annotate user bubbles and tool cards too.** Only assistant rows carry a model decision; tool-only steps and user messages have no route of their own.

## Consequences

Every conversation page now carries the dispatched route at a glance: the header chip answers "the last model that ran", each assistant row's clock line answers "the model that wrote this". A mid-session switch reads correctly on both surfaces without changing the composer seat's role. The chip adds one directory load per session scope (shared with the composer seat's instance). Sessions on deployments without a provider catalog show raw ids. The header chip names the last DISPATCHED request, so after a turn ends it deliberately lags a pending selector change until the next step assembles.

## Testing

`session-route` package tests pin the fold: empty log → `null`, single header, latest-wins with effort changes, resume silence, change-feed causing-seq, lazy mount, HMR disposal, loader composition. `ui-conversation` tests pin provenance mapping, the step join (exact → inherit → exact across a switch), live late-header restamping, prepend non-demotion, and the clock-line slot shares. `ui-model-selection` tests pin display-name resolution (catalog hit/miss, adapter effort vocabulary, raw-id fallbacks), null-route silence, provenance-over-requestConfig preference, and shared-directory identity across all four entries. The keyless web e2e `model-identity.e2e.ts` seeds two completed turns on two declared routes and pins the header chip, both clock lines, blank-session silence, and the conversation aria golden through the real host and browser.

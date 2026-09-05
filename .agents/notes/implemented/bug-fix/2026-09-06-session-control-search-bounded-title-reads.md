# Agent Note: Session-control search bounds title reads by remaining results

Status: implemented

English | [中文](2026-09-06-session-control-search-bounded-title-reads.zh.md)

## Problem

A non-empty session-control query loaded titles for every eligible session before applying its result limit. Even a request for one recent identity waited for unrelated historical logs to be read and decompressed. A small result limit therefore offered no protection from unnecessary title reads.

## Decision

[Session-control search](../../../../packages/session-query/session-control/README.md) reads titles in newest-first corpus order, after archive filtering. Each batch contains at most the remaining result count. Search stops scheduling title reads when it has enough matches and preserves cancellation during each batch. Returned rows still carry the latest folded title, including identity or cwd matches; title-read failures retain the session-id fallback.

The [query corpus](../../../../packages/session-query/session-query/README.md) resolves each requested persisted id with point `stat` and log reads under the existing concurrency bound. Batches do not repeat the full corpus listing, and a metadata failure affects only that id. Live attachments still take precedence after asynchronous reads.

This narrows the read workload without changing the [trusted directory](../feature/2026-08-19-trusted-session-control-directory.md) contract or introducing a separate title index.

## Alternatives considered

**Load all titles before filtering.** This preserves simple bulk processing but makes small result requests wait for unrelated cold logs.

**Re-list persistence for each batch.** This repeats corpus-wide metadata work as search advances, including for small batches; point observations keep that work proportional to the requested ids.

**Skip title reads for identity or cwd matches.** This saves reads but changes returned titles and can bypass newer title-only matches, violating newest-first matching semantics.

## Consequences

Queries stop reading once enough rows match. Queries with sparse or absent matches can still scan the entire eligible corpus, and a cold title can require a complete log read. The result limit is not a wall-clock or byte budget.

Focused search tests cover early stopping, title-only matching across batches, archive filtering, newest-first order, and cancellation before later rows are read. The directory API and model-visible result shape remain unchanged.

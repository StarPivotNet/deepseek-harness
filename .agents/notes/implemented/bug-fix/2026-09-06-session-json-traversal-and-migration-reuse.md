# Agent Note: Reuse validated Session artifacts and serialize historical migration

Status: implemented

English | [中文](2026-09-06-session-json-traversal-and-migration-reuse.zh.md)

## Problem

Large historical Session reads spend substantial CPU time repeatedly snapshotting the same event tree. A 15.42-second runtime profile attributes 7.91 seconds to ensure-current work, including 6.89 seconds in JSON snapshots; garbage collection accounts for 1.44 seconds. Overlapping reads can also repeat migration work before a successor becomes visible. These synchronous operations delay unrelated requests on the Node event loop.

## Decision

[JSON traversal](../../../../packages/util/values/README.md) uses container cursors and an active-ancestor set, avoiding a pending task allocation for every child while preserving lossless JSON acceptance and detached copies. [Session-format artifacts](../../../../packages/session/session-format/README.md) reuse identity only after this module has detached, deeply frozen, and fully validated the complete artifact; a private weak registry recognizes those results.

[JSONL persistence](../../../../packages/session/session-persistence-jsonl/README.md) serializes complete historical migrations across one backend instance and runs catalog migration and validation in one worker thread. The migration reuses that thread across its three catalog computations and terminates it in `finally` before releasing admission. Cancellation and backend disposal await thread exit. Waiting readers keep independent cancellation and reselect the highest generation after completion, including owner cancellation or failure. Stable physical source snapshots, fingerprint checks, and publication remain on the host.

This refines the execution cost of [released-format migrations](../architecture/2026-08-31-released-session-format-migrations.md) and complements the [large-session restore pipeline](../../archived/architecture/2026-08-05-large-session-jsonl-restore-pipeline.md). Both decisions remain active: immutable generation publication and ownership-specific restore validation retain their independent rationale.

## Alternatives considered

**Trust externally frozen input.** A frozen outer object proves neither deeply immutable children nor successful JSON and coordinate validation. Only module-produced validated artifacts qualify for reuse.

**Cache decoded data under a later file stat.** An append between the read and stat can associate old decoded bytes with a newer revision. Reuse must retain the revision of the exact decoded snapshot; this change adds no such cache shortcut.

**Relax JSON or durable-data semantics.** Accepting cycles, sparse arrays, invalid properties, or altered event content would turn a performance fix into a data-policy change. Traversal preserves validation, detachment, and safe own-property writes.

**Share one reader's result or cancellation.** One reader's failure must not fail independent readers. Waiting on completion and reopening the selected generation avoids sharing caller-owned cancellation; it retains current-generation decoding work.

**Run all computation on the host or spawn a worker per read.** Traversal improvements alone leave seconds of synchronous catalog work on the event loop. One migration-owned worker moves that computation away from request handling; backend-wide admission bounds worker count and competing full-log memory. Independent historical sessions therefore wait their turn.

## Consequences

Synthetic measurements reduce snapshot traversal from 222 to 142 ms and validation from 115 to 64 ms. Repeated snapshotting of an already validated format artifact falls from 626 ms to 0.004 ms. These are isolated microbenchmarks, not end-to-end request latency guarantees. A separate 29 MB migration-compute comparison decreases from 21.949 to 12.413 seconds with identical output SHA hashes.

A 29 MB worker migration-and-validation measurement takes about 16 seconds and records a maximum host heartbeat delay of 0.685 seconds. Structured cloning parsed input still causes roughly 0.4–0.7-second host pauses: the worker removes the main multi-second catalog computation, not all event-loop latency. Neither measurement promises a faster first open; worker startup, transfer, host decoding, and publication still cost time. Full-log memory remains proportional to input, and serialization coordinates only one backend instance.

Focused tests cover deep traversal and JSON rejection, detached immutable artifacts, rejection of untrusted frozen artifacts, and concurrent migration success, owner cancellation, waiter cancellation, and owner failure. Worker tests cover host heartbeat progress, independent queued cancellation, active cancellation, disposal, thread exit before readmission, and worker failure recovery. A built-entry test exercises plain Node from an unrelated working directory. Migration tests preserve predecessor bytes and current-generation publication. The fix changes no model-visible event or stored data format.

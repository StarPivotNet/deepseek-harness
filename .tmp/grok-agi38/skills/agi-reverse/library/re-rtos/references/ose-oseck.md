# OSE / OSEck: the signal model / hunt·attach / pool ownership / heterogeneous boundaries

<CORE RULE>
All three conditions have to hold before you read OSE correctly:

```
1. All communication is a [signal] (a message). A signal can cross core / CPU / DSP / node
2. [A signal number is not a unique identifier of a resource] — it must be paired with a secondary id to route
3. Memory has ownership rules for [domain / block / pool] — who may access, and who may allocate where, are two different questions
```

So:

```
You see "signal" → do not read it as a POSIX signal
You see an integer handle / signal number → first ask which domain it is in, and which id it is paired with
```
</CORE RULE>

> Generation note: the OSE family has several product lines (including a compact edition and smaller kernel variants). They **share one set of principles but differ in kernel size and capability**; confirm which branch the target belongs to before analysis.

## 1. The signal model

- OSE communicates with **events ("signals")** — the name comes from a telecom background; **messages live in a queue attached to each process**
- The signal API includes operations of the **hunt / attach / send / receive** class
- A **link handler** lets signals pass **between processes on different machines**, over several transport media; that mechanism later became the basis of the open-source cross-machine communication project LINX

## 2. Key pitfall: a signal number is not a unique identifier

**Several hunt ports can share the same hunt signal number** — then **a secondary id** (for example a port id) **is required** to route the signal to the right receiver.

Implementation shape: register by "signal number + id", and provide a **resolver function** that extracts the id from the signal's metadata / payload.

**Reverse-engineering meaning**: taking "the signal number" and expecting to locate a unique receiver will be wrong; first look for a paired id and the resolve logic.

## 3. Two ordering and data-availability constraints

- **Register the listener first, then send the signal** — reverse the order and the signal is very likely **lost**
- **Unlike Unix**: when the callback fires, **the signal payload has already been received**; you must **keep taking until empty** (one event may be associated with several signals)

**So**: "the signal arrived but there is no data" looks like a dropped event under Unix intuition; here it is usually the wrong way of taking.

## 4. Process, block, segment, pool: the hard core of memory ownership

- The execution unit is a **process**; processes can form a **block**, and a block can have **its own memory pool**
- **A kernel address space belongs to a segment, and a segment can contain one or more blocks**; mapping **blocks onto segments** and **pools onto regions** is how memory protection and program isolation are implemented
- **Process types**: interrupt process, timer process, prioritized process, background process; **categories**: static (created at system start) and dynamic

**Ownership rules for signal buffers (a frequent foot-gun)**:

```
A communicating process may access signal buffers in [every pool in its domain]
but may [allocate only in its own pool]
On a cross-domain send, the buffer is [copied into the receiver's pool]
```

**Reverse-engineering meaning**: which pool a buffer address appears in decides who owns it; "why is this pointer unusable over there" is often answered here.

## 5. Supervision and error handling

- **Link-level supervision** is provided by LINX; **platform-level supervision** detects **an overloaded DSP** and **a runaway DSP crash**
- **A DSP application can subscribe to supervision signals**; a DSP watchdog is an optional extra
- **The runtime does a lot of checking**: parameters, caller, buffers and stacks, initialization; on a detected error it calls an **error handler** — that handler defines **the skeleton of the error-recovery policy**
- **Kernel error classes**: errors the kernel itself detected, system-call parameter errors, **memory corruption**
- **Remember the capability boundary** (do not treat "not detected" as "no problem"): buffers and stacks carry an **end marker**, so some system calls can detect an out-of-bounds write; they **cannot detect** "a pointer access that does not change the end marker", "a memory leak", or "a read of an uninitialized value" — that class of problem needs an external tool
- There is also a path for "user-mode code to switch into supervisor mode under control"

## 6. System-information interface

It can return **information ordinary system calls cannot get**, used for runtime debug, profiling, and tuning; it includes a **signal group**: signal-space usage, signal-space analysis, a list of every signal in the system, **and saved register and stack contents**.

**Reverse-engineering meaning**: this is a ready-made entry for "who sent this signal, and what did the registers / stack look like then".

## 7. How OSE and OSEck differ

| | **OSE** | **OSEck (compact edition)** |
|---|---|---|
| Role | High-performance, POSIX-compatible multicore RTOS | A compact kernel **optimized for DSP** |
| Memory footprint | Ordinary | **Very small** |
| Typical target | ARM / Power-family application processors | DSP-class processors (multicore DSP, DSP cores) |
| In common | The same signal / IPC / principles; **LINX applies to OSE, OSEck, and Linux** | same |

**Meaning**: in a system that crosses DSPs, **the same signal semantics are carried on different cores by instances of different degrees of reduction**; do not assume one core's capability onto another core.

## 8. Heterogeneous boundaries

- A signal can cross **core / CPU / DSP / node**; LINX is a **distributed transparent transport layer** that unifies on-core, inter-processor, and inter-board communication
- Supported media include **shared memory, DMA, RapidIO / serial interconnect, Ethernet, PCI**, and others
- Public material emphasizes **zero-copy shared-memory transport**; in the direct message-passing model **message ownership is not shared**, which avoids conflicting memory access

## Decision tree

```
Given an OSE / OSEck target
├─ First decide: OSE or OSEck? What is the target core?
├─ You see a "signal"
│    ├─ Interpret it as a message object, not a POSIX signal
│    ├─ The signal number is not unique → find the secondary id and the resolver
│    └─ It may cross core / CPU / DSP / node
├─ The peer cannot be found / the data cannot be taken
│    ├─ Was the listener registered before the send (the reverse order drops it)
│    └─ Were all signals associated with that one event drained
├─ A buffer-related fault
│    ├─ Which domain / block / pool does it belong to?
│    ├─ Allocation is only in its own pool; a cross-domain send is copied
│    └─ Do not treat a pool-ownership question as memory corruption
├─ You want internal state
│    └─ The signal group of the system-information interface (signal space, register and stack contents)
├─ A DSP-related fault
│    ├─ Subscribe to supervision signals; check overload / runaway
│    └─ Note what the end marker can detect, and what it cannot
└─ Behavior differs across cores
     └─ The kernel variant on each core has different capability
```

## Tools and verification

- Communication: registration and resolution of signal number + secondary id, use sites of hunt/attach, which queue owns it
- Memory: mapping of domain / block / segment / pool, and which pool a buffer belongs to
- Supervision: link-level and platform-level supervision configuration, DSP supervision-signal subscriptions, the error handler
- Runtime: the system-information interface (signal space, register and stack contents)
- Verification: you can state together "which transport layer this signal used to reach which domain + which pool the buffer belongs to + which kernel branch the target core runs"

## Pitfalls on this platform (summary)

- **Treating a message or "signal" as a POSIX signal**
- **Assuming a signal number uniquely identifies the receiver**: several ports can share one signal number; a secondary id is required
- **Sending before registering the listener**: the signal is lost
- **Taking the payload only once**: one event may be associated with several signals
- **Assuming a buffer can be allocated anywhere**: allocation is only in **its own pool**; a cross-domain send is copied
- **Calling a pool / domain ownership problem memory corruption**
- **Assuming the communication peer is local**: the transport layer is distributed and transparent
- **Looking for cross-node communication in a local syscall trace**
- **Treating "the end marker did not catch it" as "there is no memory problem"**: an overrun that does not change the marker, a leak, and an uninitialized read are all invisible to it
- **Assuming one core's kernel capability onto another core**: OSE and OSEck differ in capability
- **Asserting that it supports XIP**: this check did not confirm that; do not copy the claim
- **Ignoring the system-information interface**: it is the fastest entry for locating a signal's source and the scene

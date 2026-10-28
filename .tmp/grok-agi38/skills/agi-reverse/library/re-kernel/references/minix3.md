# MINIX 3: RS self-healing / endpoint identity / grants / live update

<CORE RULE>
Most MINIX 3 drivers are **user-mode services**, watched by the **Reincarnation Server (RS)**: it detects a crash / hang and **restarts** them. So:

```
the driver process (PID / endpoint) disappears
  → a new driver appears almost immediately
  → the device keeps working
```

**That is not rootkit persistence. It is system self-healing.**

Second point: **a service is identified by a label and addressed by an endpoint** — after a restart the label can stay the same, but **the endpoint changes**. Treating the endpoint as a persistent service identity produces a string of false anomalies.
</CORE RULE>

## 1. RS and endpoint identity

- RS watches services / drivers, detects failure, and restarts them; the related framework handles three kinds of initialization: fresh / restart / live-update
- **After a restart the label stays and the endpoint changes**; the new endpoint has to be looked up again by label
- So this timeline is **normal recovery**:

```
IPC to endpoint X used to work → suddenly fails
a new endpoint Y takes over
```

- **Corollary**: any reference cached or compared by endpoint goes stale after a restart; when analyzing behavior, treat "the endpoint changed" as a first-class explanation

## 2. Messages are fixed-length; bulk data goes through grants

- **The message payload has a fixed size (56 bytes)**; each message type has its own format (defined in `minix/include/minix/ipc.h`)
- Transfers larger than that use **grants** (`minix/include/minix/safecopies.h`) — **a pointer at a block of allocated data the granter exported**
- Three typical uses:
  1. **Sending more than 56 bytes**: the grantee gets a read-only grant, maps it, reads, and the granter revokes
  2. **Requesting more than 56 bytes**: a read-write grant; the grantee writes and sends back, then the granter revokes
  3. **Both directions**: a grant over already-allocated memory

**So**:

```
the number 12 appears in a message
  → it is not necessarily a user buffer pointer
  → it may be a grant ID

the real relation: (endpoint, grant ID, offset, rights) → a span of external memory
```

## 3. A failed grant check returns `EPERM`, not "insufficient privilege"

Grant checks run in a fixed order:

1. Resolve the granter's endpoint
2. The grant table is registered and the index is in range
3. Read the entry back from the granter's address space — **a page-table walk failure is reported as `EPERM`, not `EFAULT`**, on purpose: **so the grantee cannot probe the granter's address space through the error code**
4. The entry's valid / in-use flags are set
5. **The sequence number matches the grant id**
6. **The requested access ⊆ the grant flags** (this is the source of "access invalid" style errors)
7. The target endpoint equals **the caller's endpoint as stamped by the kernel** (anti-forgery / confused-deputy rule)
8. `offset + bytes ≤ len`

**Error meaning (the contract driver authors rely on)**:

| Error | Meaning |
|---|---|
| **`EPERM`** | **the grant is invalid** (not registered, sequence mismatch, insufficient rights, out of range, or a page-table walk failure) |
| **`EFAULT`** | **the buffer is not mapped** |

**So when `sys_safecopy*` returns `EPERM`, do not apply the Unix intuition "the process lacks privilege"** — rule out the grant failure classes one by one first.

- Grant types differ: **direct** (resolve the memory into the granter) and **magic** (resolve it into the message sender, and additionally require the granter to belong to the trusted privileged-service set)
- A grant id is **packed** (for example a 20-bit shift, containing id / index / sequence), so "the same number" does not necessarily name the same grant

## 4. Live update: there really can be two instances during an update

- Before an update the service must reach a suitable **quiescent point**: some state is predefined, **the rest is defined by the service author**; the administrator must supply the state number when starting the update
- The update is **process-level**: **the kernel (only) grants the new process read-only access to the old process's address space**, which is used first to migrate metadata (old and new metadata are both locally available, so state objects can be remapped under version-independent names), then to migrate data
- **On error it can roll back**: kill the new version and let the old version keep running — **like an aborted atomic transaction**; this process-level update also **stops update-time errors in the new version from propagating back into the old version**
- **During the update the old and new instances can genuinely exist at the same time**

**So two nearly identical FS / driver images in a memory image are not necessarily process injection or a duplicated malicious instance.**

- Related constraint: an update requires the service to use an event-loop design, so that **no state object is on the stack at the update moment**
- **Live direct grants make the update harder**: pointers stored in a grant may need to be adjusted as state is relocated; the documentation suggests **blocking the update or doing a custom state migration** in that case

## Decision tree

```
Got a MINIX 3 target
├─ a driver "disappeared and reappeared"
│    ├─ explain it as an RS restart first (system self-healing); do not call it persistence
│    └─ align the label (stable) with the endpoint (it changes)
├─ an IPC send failed
│    ├─ did the peer restart, and did the endpoint change
│    └─ look it up again by label instead of reusing the old endpoint
├─ a suspicious integer appears in a message
│    ├─ a payload within 56 bytes is a fixed-length message
│    └─ a larger transfer goes through a grant → that integer may be a grant ID and an offset
├─ sys_safecopy* returns EPERM
│    ├─ rule out grant-check steps in order (sequence / rights / bounds / page-table walk)
│    └─ do not apply Unix privilege intuition; EFAULT is what means unmapped
└─ two copies of the same service image are in memory
     ├─ consider old / new coexistence during live update first
     └─ then see whether live direct grants affect the update
```

## Tools and verification

- Service lifetime: RS monitoring and restart records, and the mapping from service label to the current endpoint
- Communication: message-type definitions (fixed-length payload) and grant-related interfaces; recovering `(endpoint, grant ID, offset, rights)`
- Update: the service's quiescent-point definition, the update and rollback trace, and how many instances exist during the update
- Verification: be able to state together "whether service identity is the label or the endpoint + whether data travels in the message or through a grant + the current update / restart phase"

## Pitfalls on this platform

- **Treating a driver restart as persistence / injection**: RS restarts a failed service; that is self-healing
- **Treating the endpoint as a persistent service identity**: after a restart the label stays and the endpoint changes
- **Treating a small integer in a message as a buffer pointer**: it may be a grant ID (together with offset and rights)
- **Treating `EPERM` as "insufficient privilege"**: it means the grant is invalid, including sequence mismatch / out of range / page-table walk failure and other cases
- **Mixing up `EFAULT` and `EPERM`**: the former means the buffer is not mapped
- **Ignoring the packed structure of a grant id**: the same number is not necessarily the same grant
- **Treating two instances during live update as an anomaly**: old / new coexistence is the normal state of an update
- **Ignoring the effect of live direct grants on an update**: the update may need to be blocked, or the state migration customized
- **Reasoning that depends on stack state during an update**: an update requires that no state object is on the stack

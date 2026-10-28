# seL4 analysis branch: reversing a capability system

<CORE RULE>
When you meet an seL4 system, **the first thing to recover is not "the module call graph", but "the object graph + the capability distribution + the IPC topology + the VSpace / device map"**.
The reason: the seL4 kernel provides only mechanisms, and **most drivers and services are in user mode** — device MMIO, IRQs, and similar are exposed to user-mode threads through capabilities.
So the core experience of this branch is not "how to reverse a kernel module", but **how not to misread capability-system behavior as ordinary OS behavior**.
</CORE RULE>

## 1. Identify the runtime model first (it decides everything after)

Given an ELF, **do not assume it is "an ordinary process" first**. Decide which class it belongs to:

`root task` / bare libsel4 component / **capDL-loaded** / **CAmkES component** / MCS / VM(VMM) / user-space driver

- **The capDL loader creates kernel objects, the CSpace, and the VSpace from a static specification, then loads the ELF into them** → **the ELF itself ≠ the full system semantics**: the important capability relationships may not be in the ELF's ordinary data structures at all, but in the capDL spec / CAmkES generated artifacts
- The experience path: **find capDL / CAmkES traces → look for `.cdl` / generated capDL / CAmkES ADL first → recover the object graph → then go back to the ELF for the business code**
- A `.cdl` can be **more valuable to seL4 RE than a complete symbol table**

## 2. A CPtr is a local address, not a global object id (the most important rule)

The `0x12` in `seL4_Call(0x12, ...)` is **a capability address in that thread's own CSpace** — resolved from the root CNode in its TCB; the same `0x12` in another component can easily point at a different object.

So this inference is **wrong**:

```
component A: Call(0x12)
component B: Recv(0x12)
   → "A and B communicate"          ← wrong
```

Each CSpace mapping must be recovered, then **aligned by kernel object**:

```
A CSpace: 0x12 → Endpoint E1 [Write]
B CSpace: 0x34 → Endpoint E1 [Read]
that is: A:0x12 → E1 ← B:0x34
```

**The stable identity is the kernel object, not the CPtr integer.**

## 3. Do not copy root-task semantics into a capDL-loaded program

- The initial environment the kernel builds for the **root task** is: a TCB + **one** CNode (as the CSpace) + a VSpace; `seL4_CapInitThreadCNode` (slot 2) is **the CNode path / capability that points at the initial CSpace** (not the object it points at), and `seL4_CapInitThreadVSpace` (slot 3) is the same; the initial CNode's guard is chosen to resolve exactly 32 bits
- The capDL loader runs as the root task and **creates, from the spec**, each application's CSpace / VSpace and loads the ELF — those CSpaces come from the spec and from caps the loader installed
- So the `seL4_CapInitThread*` constants in a capDL-loaded application **cannot be mechanically treated as "TCB / CNode / VSpace"**: decide first "is this the root task, or a child thread the loader created", or the whole capability graph will be labeled wrong

## 4. IPC that looks like an ordinary function call? Suspect CAmkES glue first

CAmkES generates a lot of glue around a component / connector (marshal / selector switch / unmarshal). What decompiles can look like this:

```
foo_rpc_call() → marshal → seL4_Call() → unmarshal     ← the real business logic is only foo_rpc_call()
server: seL4_Recv() → selector switch → unmarshal → user implementation → marshal → Reply
```

**Do not treat dozens of generated stubs as dozens of protocols.** Handling: recognize CAmkES → find the connector type → identify and **fold the glue** → extract `interface / method ID / arguments / endpoint / badge / component pair`, and end up with `Client.foo(x) --seL4RPCCall--> Server.foo(x)` — much more meaningful than a raw CFG.

## 5. Badge: it may be "who the caller is", or it may be a set of event bits

- `seL4_Recv(ep, &badge)`: sender information comes from **the badge of the capability the sender used** → seeing `if (x == 4)` is not necessarily a message type; it may be **caller identity**
- **Notification badges can be aggregated by bit OR** → `badge == 0x5` may mean event 0x1 + event 0x4, not "event number 5"
- The test: `switch equality` → leans identity; `badge & MASK` → leans bitset / events
- A badge can also be set again by **Mint** (the API allows it), so the same object can carry caps with several different badges

## 6. A failed CSpace lookup ≠ the slot is empty

A CSpace is a multi-level CNode, and **a CNode capability itself carries a guard / guard_size**; addressing a CNode also requires a **depth**.

Lookup-failure classes: **Invalid Root / Missing Capability / Depth Mismatch / Guard Mismatch**.

So seeing `seL4_CNode_Copy(..., index=0x1234, depth=32, ...)` means recovering the **CSpace radix / guard path**, not simply drawing "slot 0x1234".

## 7. Error codes are diagnostic information; do not label them all generic error

| Error code | Meaning (RE view) |
|---|---|
| `seL4_DeleteFirst` | the destination CSlot **already has a capability** (Copy / Mint / Move / Retype require the destination to be empty); a map-class operation means the destination address is already mapped |
| `seL4_RevokeFirst` | the untyped **has already been retyped**, or a copy of that cap exists (there are also cases where a CB / IRQ handler / vspace service cap already exists) |
| `seL4_FailedLookup` | the index / depth is invalid, or the root is a capability of the wrong type |
| other | `InvalidCapability`, `IllegalOperation`, `RangeError`, `TruncatedMessage`, `NotEnoughMemory`, `AlignmentError` |

**These error codes expose the object state the author expected** — keeping the specific branch is much more valuable than collapsing everything to `if (err != 0)`.

## 8. Untyped allocation: it is not malloc

- The path: `Untyped → Retype → Endpoint / TCB / CNode / Frame / ...`; object size is `2^n` and aligned to `2^n`; retype requires the untyped to be large enough + enough **consecutive empty CSlots** in the destination CNode
- Seeing a "strange allocator sorted by size descending": do not treat it as a custom slab algorithm — it is very likely only **reducing alignment fragmentation of untyped retype** (small-to-large order wastes space); to allocate a **specific physical address**, every power-of-two block from the start of the untyped up to the target address must be consumed
- **Deleting a child cap ≠ the physical range is immediately usable**: often the **parent untyped must be Revoked** to clear derived objects before it can really be reused

## 9. Device untyped: it can become only a Frame (and with more limits)

- The manual: **device untyped can be retyped only into a frame or a child untyped** — it cannot create a TCB / Endpoint / CNode / page table
- Extra limits: a device frame **cannot be an IPC buffer** (`seL4_TCB_SetIPCBuffer` → `IllegalOperation`), **cannot be used to create an ASID pool**, and on ARM **cannot be made an executable frame** (the kernel will not do cache maintenance on device memory)
- The `device` attribute means memory "**the kernel cannot write**" (MMIO, or RAM outside the kernel window); **the attribute is inherited by a child untyped** and cannot be changed
- The reversing main line: `Untyped → Frame → Map → volatile MMIO read/write` → decide first "is this a device-register map or shared memory" → physical address → DTB / platform memory map → device → register offset. **That is the main line of seL4 user-mode driver analysis**

## 10. An IRQ does not enter a kernel handler; it goes to a user-mode driver

The official path:

```
IRQControl → IRQHandler capability → bind Notification
   → hardware interrupt → the kernel signals the Notification → the user driver seL4_Wait() → handle → seL4_IRQHandler_Ack()
```

- Seeing `seL4_Wait(ntfn, &badge)` + `seL4_IRQHandler_Ack(irq_cap)` → it can basically be judged an **IRQ handling loop**
- **The interrupt arrives only once** → **check for an Ack first** (without an Ack the kernel will not deliver later interrupts), rather than suspecting a broken Notification or a misconfigured route first

## 11. MMIO looks normal but DMA is weird: the isolation proof does not cover DMA

- seL4's formal guarantee **assumes the MMU can fully control memory**; an ordinary DMA device can **bypass the CPU MMU and write physical memory directly**, so DMA **does not automatically fall inside the core isolation proof** (an IOMMU / SystemMMU is required to enter the corresponding range, and not every configuration is in the same verified range)
- So in a security reversing: **"A has no frame cap to B" does not imply "A absolutely cannot change B's memory"** — also ask: does A **control a DMA device**? is an IOMMU / SystemMMU enabled, and how is it configured? what is the DMA mapping policy?
- **This is the bypass capability-graph analysis misses most easily**

## 12. A fault is not "the kernel killed the thread"

A fault can be sent as **IPC** to a designated fault-handler thread (the official tutorial is designed that way) — a program continuing after a fault is not strange:

```
thread faults → the kernel builds a fault IPC → fault endpoint → the handler receives it
   → modify mapping / register / capability → reply / resume
```

So `Recv(endpoint) → decode_fault() → write_regs() → reply()` is very likely an **exception pager / fault handler**, not an ordinary RPC server.

**When the same fault repeats**: decide first whether the handler really fixed the fault cause (mapping / register / IP) — if it did not, and the thread is resumed, the same fault fires again immediately (the project states this explicitly). **Do not suspect a broken kernel fault loop first.**

## 13. MCS and non-MCS must be distinguished first (a large pitfall)

An MCS kernel introduces: **SchedulingContext (budget / period)**, **Reply object**, **passive server**, **SC donation**, **timeout fault**, and **the IPC ABI differs**.

- Decide **MCS / non-MCS** from the binary first, or a **reply object** is easily misread as an ordinary endpoint / capability argument
- An SC is created by untyped retype and configured with `seL4_SchedControl_Configure` (`budget == period` is a time slice / round-robin; `budget < period` is a periodic task); **a thread with no SC (or one that was donated away) cannot run**
- Donation: `seL4_Call` donates the SC, `seL4_ReplyRecv` returns it; **the server must be in the "waiting on the endpoint" state** for donation to happen
- A timeout fault is registered with `seL4_TCB_SetTimeoutEndpoint`
- **Revoking a reply object breaks the call chain**: a reply object in the middle of the chain is revoked / deleted → the SC can never get back to the originator (the kernel deliberately does not keep that chain) — watch this when analyzing a multi-level call chain

## 14. Two normal phenomena that are easy to call "the configuration is broken"

1. **A server has no SchedulingContext and can still run**: under MCS this is a **legal passive server** — it has no SC of its own, blocks on an endpoint, runs on the SC the client donated, and the SC is returned after reply. Seeing "there is a TCB but no SC" is not "this thread cannot run / the capDL configuration is corrupt"
2. **A thread that is "stuck" is not necessarily a lock**: under MCS, even at the highest priority and not blocked, **it still needs available budget** to run; when the budget is exhausted it waits for replenishment. Check order: `blocked? → SC bound? → budget remaining? → replenishment? → passive / donated SC?` — do not apply only a POSIX mutex / deadlock / starvation
   - The same way: a server that suddenly cannot run may be **the client is out of budget** / **the SC donation chain broke** / **the server did not ReplyRecv correctly**

## 15. capDL snapshot: cross-view of the static graph vs the runtime graph

- On a debug build (`CONFIG_DEBUG_BUILD` / `SEL4_DEBUG_KERNEL`), `seL4_DebugSnapshot()` outputs a **capDL dump** of the current kernel state; `seL4_DebugCapIdentify(cap)` returns the capability's type number
- **Watch the shape**: according to the devel mailing list, `seL4_DebugSnapshot` is not an ordinary text dump — it waits for a command byte (0xa0–0xff) and returns **binary data** (implementation in `src/arch/*/machine/capdl.c`, `include/machine/capdl.h`); the syscall ID differs by architecture (for example AArch64 differs from RISC-V32)
- Use (a very strong cross-view): compare the **statically derived capability graph** with the **runtime capDL snapshot** — the difference is a **cap transfer / Mint / Copy** that happened at runtime

## 16. A capability graph must carry rights

The same endpoint, three caps with completely different power:

```
A: Endpoint E [Write]
B: Endpoint E [Read]
C: Endpoint E [Read, Write, Grant]
```

capDL records parameters such as **Read / Write / Grant / GrantReply + badge + guard**; **Grant / GrantReply** directly relate to capability transfer in IPC and to reply authority.

So a security analysis draws an **object graph + rights**, not `component ↔ component` — otherwise the attack surface is overestimated or underestimated.

## Reversing decision tree (compressed)

```
Found an seL4 binary / system
├─ 1 identify the runtime model first: root task / bare app / capDL / CAmkES / MCS / VM(VMM)
├─ 2 rebuild the object graph: TCB / Endpoint / Notification / CNode / Frame / Untyped / IRQHandler / SchedulingContext
├─ 3 rebuild the capability graph: a CPtr is a local address + rights + badge + guard/depth + derivation
├─ 4 rebuild communication: Send/Recv, Call/Reply, capability transfer, Notification, fault IPC
├─ 5 when behavior is abnormal, check by symptom:
│     FailedLookup → depth / guard / path / cap type
│     DeleteFirst  → the destination slot is not empty
│     RevokeFirst  → a derived / child object or a copy exists
│     fault loop   → the handler did not fix the fault
│     the thread does not run → MCS SC / budget / donation chain
│     a passive server does not run → SC donation
│     an IRQ arrives only once → no Ack
└─ 6 when a device is involved: device untyped → MMIO frame → Notification ↔ IRQ → Ack → check DMA against the IOMMU / SystemMMU separately
```

## Tools and verification

- Static: `capDL-tool` (parse `.cdl` to get objects and the cap distribution), CAmkES-generated glue and ADL, `readelf` (the ELF layer)
- Dynamic: QEMU-emulate the target system; on a debug build use `seL4_DebugSnapshot` (the binary capDL protocol) / `seL4_DebugCapIdentify`
- Verification: be able to give together "the runtime-model decision + the object graph + the capability graph with rights" — "two components communicate through an Endpoint" alone is not enough

## Pitfalls on this platform

- **Treating the integer in `seL4_Call(0x12)` as a global id**: it is a CSpace-local address, meaningless across components
- **Copying root-task slot semantics onto a capDL-loaded application**: the whole capability graph will be wrong
- **Treating CAmkES glue as a protocol**: fold the generated code first
- **Treating a badge as an enum**: it may be identity, or it may be a bit-aggregated event set
- **Treating FailedLookup as "the slot is empty"**: it can also be a depth / guard / path / type problem
- **Collapsing error codes into a generic error**: that throws away the object state the author expected
- **Treating device untyped as ordinary memory**: it can become only a Frame, and it still cannot be an IPC buffer / ASID pool / executable frame
- **An IRQ arrives only once, so suspect the kernel**: look for an Ack first
- **Concluding isolation holds because "A has no cap to B"**: that forgets the DMA bypass (check the IOMMU)
- **The program keeps running after a fault = something is haunted**: that is the fault handler working as designed
- **Treating an MCS reply object as an ordinary cap argument**; **treating a passive server as a corrupt configuration**; **treating an exhausted budget as a deadlock**

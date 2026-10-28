# seL4 platform branch: capability provenance (not "scan processes")

On seL4 the **observation model is fundamentally different from the previous three platforms**, so the method cannot be translated across: there is **no such thing as "root enumerates every process on the system and peeks at someone else's memory"**.

## 1. Why it is different

- **No capability means no access right**: every operation must be started by a thread that holds an **unforgeable capability**. Kernel objects (TCB, VSpace, CNode, Endpoint, Notification, frame/page) are all capability-controlled resources
- The initial **root task** receives caps for system resources at boot. After that, resources are distributed by capability derive / grant
- A Microkit **protection domain (PD)** by default has only its own ELF/VSpace and resources that were **explicitly granted** (each PD = its own CSpace + VSpace + TCB, entry points `init` / `notified` / `protected` / `fault`)
- So neither "look outward from inside an injected PD" nor "sweep from outside the system" holds — **what you can observe is entirely decided by the capabilities you hold**

## 2. The correct route: record provenance at construction time

Do not do "scan → guess which PD was injected". **At system-construction time, make the security monitor hold provenance**:

```
root task / system monitor
        ├── TCB caps (thread context)
        ├── frame/page caps (physical-page source)
        ├── VSpace construction record (who mapped what, at what rights)
        ├── executable-page policy (which frames may be mapped executable)
        ├── fault endpoints (exception-event entry)
        └── loader provenance (images registered by the ELF loader / trusted components)
                    ↓
        execution provenance graph (executable page ← source frame ← mapper ← authorization chain)
```

- seL4 **page mapping is itself an explicit capability invocation**: which VSpace a frame/page is mapped into, and at what rights, is part of system construction, so it can be recorded naturally
- That answers a question the previous three platforms struggle with: **"who created this executable page, which untyped/frame it came from, which VSpace it was mapped into, and who holds the mapping right"**
- Detection / collection logic (policy-driven, better than periodic polling):

```
ELF loader / trusted component registers legitimate executable frames
        ↓
any new executable mapping appears
        ↓
check frame provenance + capability path
        ↓
out of policy → block / raise a fault / live snapshot
```

## 3. The question changes

- The previous three platforms ask: "which process is the malicious code hiding in?" (recover provenance after the fact from a complex shared system)
- On seL4 the question should be: **"which capability flow gave unauthorized code executable authority?"** (provenance was **kept** at design time)
- The contrast of the two routes is itself useful: the first three are "reconstruct after the fact"; seL4 is "kept by design" — listing both in one skill covers collection thinking for both kinds of system

## 4. Kernel facilities that can be used (prerequisite: the monitor holds the matching cap)

- **TCB debug API** (hardware debug capability; build with `-DHardwareDebugAPI=1`; on an unsupported platform the kernel aborts at boot):
  - `seL4_TCB_SetBreakpoint` / `seL4_TCB_UnsetBreakpoint` / `seL4_TCB_GetBreakpoint` — set a **breakpoint / watchpoint** by virtual address (instruction or data, read / write / read-write, range)
  - `seL4_TCB_ConfigureSingleStepping` — single-step (interrupt once every N instructions; `num_instructions=0` turns it off). **Every trigger sends a message to that thread's fault endpoint**. Replying to the fault message continues execution
  - Every one of these invocations needs a **capability to the target TCB** — again: who you can debug depends on what you hold
- **A fault is a first-class event**: VM fault, debug fault, and similar are sent to the **fault endpoint** as configured. In Microkit a PD's `fault` entry is handled by the monitor's fault handler
- The monitor can turn "anomalous execution" into **event-driven** collection (instead of sample-and-scan)

## 5. Landing checklist (trim to the target system's construction)

1. Confirm system construction: root task / monitor structure, each PD's resources and channels (Microkit's system description file is the authority)
2. Collect provenance sources: loader records, VSpace construction invocation records, executable-page policy, fault-endpoint subscription
3. Define the set of "legitimate executable pages" (which frame / VSpace / rights combinations were accepted at construction time)
4. Build the runtime check: new executable mapping → trace frame provenance and the capability path → decide
5. Disposition: block (policy deny) / raise a fault into the monitor / live snapshot (save the frame involved and the mapping record) — **collect evidence before disposition**
6. Record output in the fields of [[re-analyze/analysis-contract]] (target_id uses the system / PD identifier; evidence uses the capability path and the mapping record)

## Method-side entry

This note is the **collection / monitoring view** (assume you are an authorized party recording provenance at construction time). If the target is an **existing seL4 system** (reverse it, understand its object graph and IPC topology), use the [[re-kernel/sel4-kernel]] branch of [[re-kernel]] — that side covers "how to read a capability system, and which phenomena must not be judged as on an ordinary OS".

## Pitfalls on this platform

- **Applying the previous three platforms' thinking**: starting from "root sweeps the system" or "inject a detection tool" has no counterpart on seL4 — first state "which capabilities do I hold"
- **Treating seL4 as "a special Linux"**: the observation boundary is completely different. The method has to be re-derived from the capability model
- **Ignoring build-time configuration**: the TCB debug API needs an explicit build switch. Platform support differs (an unsupported platform aborts the kernel at boot)
- **Only doing periodic scans**: capability paths and fault endpoints already provide events and sources. Periodic polling is a degraded use

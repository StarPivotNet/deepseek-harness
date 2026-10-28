# HIC: capability + physical sandbox + multi-version driver system

<CORE RULE>
**In a capability / sandbox / multi-version / live-update driver system, do not derive the trust boundary from CPL, an address, a direct call, or an MMIO instruction.**

Recover **domain, capability, mapping, device ownership, version, and lifecycle topology** first, then explain control flow.

Specifically for HIC: **Privileged-1 and Core-0 are at the same physical privilege level and are isolated by the MMU**; a driver maps only the MMIO / shared memory it was authorized for, while certain privileged services also have a wider physical-memory access path. So this old inference

```
Ring 0  →  kernel driver  →  full kernel addressability
```

**must be marked an invalid assumption immediately.**
</CORE RULE>

## 1. Cross-system comparison: where these rules come from

| Real system / mechanism | Actual experience | Rule carried into this class |
|---|---|---|
| Fuchsia DFv2 | a driver runs inside a driver host; different drivers can live in different processes, or **co-locate in the same driver host and share an address space**; driver manager owns topology / bind / capability routing | **do not judge a driver boundary by "is there a direct call"**. Two logically independent drivers may share an address space; one device stack may also span several isolation domains. Recover the driver / node / host topology first |
| Fuchsia crash recovery | after a driver crash it can be spawned again, but **on rebind the hardware may already be in an unknown state**, and init must not assume the device is reset | reset / state probes in driver init that "look redundant" **must not be deleted as boilerplate** — they may be the sandbox restart / recovery path |
| Fuchsia bind metadata (DFv1) | a bind program can be placed in an ELF NOTE so the coordinator can check bind conditions **without fully loading the driver** | **parse module metadata before disassembly** — the module carries its own UUID, version, endpoints, resource requirements, dependencies, and signature; that is the first triage layer |
| seL4 / CAmkES | MMIO can appear as a dataport / shared-memory mapping; an IRQ can appear as an event / notification; RPC, a shared dataport, and a direct call can all exist | **do not infer a security boundary from instruction shape**: `mov [addr]` may be authorized MMIO; an ordinary function call may cross a logical component; a shared page may also be capability-mediated IPC |
| Xen frontend / backend | the device protocol is a shared ring + a grant table + an event channel; **a grant reference is a cross-domain page authorization, not an ordinary address**; after migration the event-channel local port can even change | when you see an integer handle / page index / ring offset, **do not type it as a pointer first**. Decide whether it is a capability, a shared-page offset, or a domain-local identifier |
| Xen grant table | in essence it plays **a role similar to a paravirtual IOMMU**; page ownership and cross-domain access rights are **independent state** | memory forensics must distinguish **VA / PA / backing frame / capability / owner domain / mapped domain** — storing only the virtual address is far from enough |
| Genode | a driver can obtain **fine-grained** hardware resources through services such as IO_MEM, IO_PORT, and IRQ; a platform driver can isolate device resources at fine grain for a sandboxed driver | **"can touch MMIO directly" ≠ "owns whole-machine kernel privilege"** |
| QNX Neutrino | **a user-mode driver can also mmap physical device registers and read and write them directly**; IRQs are delivered through a dedicated mechanism; physical-memory mapping is also controlled by ability / privilege | when reversing an unknown system, **do not automatically classify direct MMIO as a monolithic kernel driver** — where the code runs and what hardware it may access are two independent variables |
| Barrelfish | a user-mode driver obtains device memory through a capability, and interrupts are forwarded to user mode; **capability space can be core-local, and different cores can even run different CPU drivers** | **do not assume a single global namespace**. Record core / domain / cspace / device context; the same numeric handle can be completely different in different domains |
| MINIX 3 live update | before an update the service must enter quiescence; the new instance does state transfer, and on success replaces the old instance, **on failure it rolls back**; threads are especially hard, because pointers and context in the stack / registers are difficult to migrate safely | in rolling-upgrade forensics, **the old instance and the new instance existing together is a legal state**. Only if the old instance is still receiving new requests after migration is confirmed complete should you suspect stale routing / UAF / a hook |
| MINIX protocol quiescence | some services cannot merely reach "there is no work right now"; they must reach **request-free / protocol-free** before they can be updated | for a network / NVMe / GPU driver, **do not treat "the thread is idle" as safe to replace** — also check outstanding DMA, descriptor ownership, IRQs, and protocol transactions |

## 2. Four special cases particular to this system

### 1. Identify the generation before recovering semantics

The same capability can have a different implementation model across generations — for example **capability allocation in one generation is per-core / with no global lock**, while another generation (a larger model) describes a **protected global capability table**.

**So you must never**:

```
found a capability structure → lay it out directly from the latest document
```

**The correct order**: use **code signatures, data layout, and call paths** to confirm which generation the target belongs to, then apply the structure.

**This generalizes to every rapidly evolving experimental system.**

### 2. An IPC boundary has a dedicated "entry page" shape

The typical path:

```
call   →   entry page
   →   bt [bitmap]      (test)
   →   jnc fail         (failure branch)
   →   jmp business page
```

And **in isolation mode, the later jump can even trigger a page fault on purpose**, after which the kernel verifies the source and completes the mapping / address-space switch.

**So when you hit `call unknown / bt [...] / jnc trap / jmp unmapped`, do not judge it the traditional RE way as**: obfuscation, a CFI stub, or a broken CFG — **it may simply be a normal IPC boundary**.

### 3. A shared-memory pointer must carry domain semantics

A shared-memory page is **page-aligned and controlled by a capability**; when IPC passes bulk data it passes offset / length **through pre-mapped shared memory**.

The data structure should be recorded as:

```
{ domain, shmem_cap, mapping, offset, length, rights }
```

**and not as**

```
void *buffer;
```

Otherwise data-flow analysis **incorrectly merges a large amount of legal cross-domain data flow**.

### 4. Model driver lifetime and hardware lifetime separately

A driver can be loaded dynamically, hot-plugged, and have its sandbox destroyed and rebuilt; during a rolling update the old and new services run in parallel, migrate, and only then is the old instance terminated. Cross-system experience (see the table above) says: **rebuilding a software instance does not mean the hardware state returned to a clean boot**.

So the state model has to grow from

```
loaded → initialized → running → unloaded
```

into **tracking separately**:

```
module instance / driver domain / device ownership / DMA ownership /
IRQ routing / client binding / version binding / migration state
```

## 3. Trigger conditions (hit / do not hit)

**The point of this section: this branch is hit only when the system really is of this class, and is not hit by mistake on a system such as Xen / Fuchsia / seL4.**

**Hit (any one is enough)**:

- Module metadata carries a **custom module-format identifier** (a self-describing module: UUID + version + endpoints + resource requirements + dependencies + signature)
- The model is "**processes at the same privilege level are isolated by the MMU**" (a service and the kernel core share a physical privilege level, and are distinguished by page tables rather than by CPL)
- The IPC fast path has the fixed shape **entry page + bitmap test + failure branch + jump to the business page**
- Evidence shows **two capability-accounting models coexist** (per-core with no global lock ↔ a protected global table) — that is a generation difference
- A module can be **loaded dynamically / destroyed and rebuilt**, and there is **rolling-update semantics in which the old and new instances run in parallel**

**Do not hit (these belong to other branches)**:

| What you see | Where it goes |
|---|---|
| only "the driver is in user mode" | [[re-rtos/qnx]] (user-mode server), [[helenos]] (DDF), [[redox]] (scheme) — **a user-mode driver by itself is not enough to hit this branch** |
| only "there is a capability / a handle is a local identifier" | [[sel4-kernel]], [[zircon-kernel]], [[genode]]; multi-kernel systems (a core-local capability space) each go to their own branch |
| only "shared memory + a notification" | [[re-hypervisor/xen]] (grant / event), [[re-hypervisor/hyperv-vmbus]] (GPADL), [[re-rtos/qnx]] (the io-pkt class) |
| only "there is a rolling update" | [[minix3]] (RS self-healing / live update), [[netbsd-kernel]] (on-demand load) |
| only "direct MMIO was seen" | that proves nothing — see the QNX and Genode rows above |

**The test**: **the mark of this local branch is the combination "same privilege level + MMU isolation + self-describing module metadata + generation-variable capability accounting"**, not any one of those alone.

## Decision tree

```
Got a target
├─ do module-metadata triage first (self-describing module: UUID / version / endpoints / resources / dependencies / signature)
│    └─ metadata comes before disassembly
├─ confirm the generation
│    ├─ is capability accounting per-core or a global table?
│    └─ decide from code signatures / data layout / call paths; do not apply a structure directly from the latest document
├─ do not infer a trust boundary from instruction shape
│    ├─ a direct call ≠ the same component
│    ├─ direct MMIO ≠ whole-machine kernel privilege
│    └─ mov [addr] may be authorized MMIO
├─ IPC shape
│    ├─ entry page + bitmap + failure branch + jump to the business page → a normal IPC boundary
│    └─ a jump triggers a fault, then the kernel verifies the source and maps / switches → also normal
├─ data flow
│    └─ a shared-memory pointer carries {domain, cap, mapping, offset, length, rights}
└─ lifecycle
     ├─ track separately: module instance / domain / device ownership / DMA / IRQ routing / client binding / version / migration state
     └─ old and new instances together = a legal state; a software rebuild ≠ hardware back at a clean boot
```

## Tools and verification

- Metadata: the module's self-describing fields (UUID, version, endpoints, resource requirements, dependencies, signature)
- Domain model: who shares a privilege level with whom, who is isolated by the MMU, and at what granularity capability accounting lives
- Mapping: shared memory's {domain, cap, mapping, offset, length, rights}; a physical page's owner / mapped domain
- Lifecycle: separate records of the module instance, device ownership, DMA, IRQ routing, binding and version, and the migration phase
- Verification: be able to state together "which generation this implementation is + what decides the trust boundary of this call + in which domains this memory is visible"

## Pitfalls on this platform

- **Reasoning from "Ring 0 → the whole kernel is addressable"**: processes at the same privilege level are isolated by the MMU, and that inference does not hold
- **Judging a driver boundary by "is there a direct call"**: they may share an address space, or they may cross an isolation domain
- **Deleting reset / state probes in init as boilerplate**: they may be the recovery path
- **Disassembling before looking at module metadata**: the order is reversed; metadata is the first triage layer
- **Treating an integer handle / page index / ring offset as a pointer first**
- **Storing only the virtual address in memory forensics**: you also need owner domain / mapped domain / backing frame / capability
- **Seeing "can access MMIO" and concluding kernel privilege**: access rights and where the code runs are two variables
- **Assuming a single global namespace**: capability space may be core-local
- **Applying a structure layout directly from the latest document**: do a generation fingerprint first
- **Calling the entry-page IPC shape obfuscation / a CFI stub / a broken CFG**
- **Recording a shared-memory pointer as only `void *`**: legal cross-domain flows get merged incorrectly
- **Treating "the thread is idle" as safe to replace**: also look at outstanding DMA / descriptor ownership / IRQs / protocol transactions
- **Seeing old and new instances together during a rolling update and calling it an anomaly**: that is a legal state
- **Assuming a software-instance rebuild means the hardware returned to its initial state**

# Cross-system execution models and misread table

**Use**: whenever a "phenomenon looks abnormal", go through this table first. Its value is not introducing systems. It is **stopping a normal mechanism of some system from being judged a bug / hook / dead code / malicious**.

**Prerequisite**: this file assumes you already know "which system this is". **If the target cannot be identified, go through [[system-fingerprints]] first** (carrier format → family → system → easy-to-confuse pairs → negative criteria). Use them together: settle identity first, then check which "normal abnormalities" that identity allows.

Judgment order (the core claim of this file):

```
observe an abnormal phenomenon
  → identify the target's execution model (which system, which build, which stage)
  → judge which "normal abnormal phenomena" that model allows
  → cross-view / configuration check / runtime verification
  → only then decide: damaged, malicious, or actually a bug
```

## 1. Ten high-frequency misreads (suspect first, then rule out)

| Observed phenomenon | Do not infer directly | Must rule out first |
|---|---|---|
| function has 0 xref | dead code | linker set, generated registry, callback, IPC dispatch, RTE, init table, AST, exception table |
| address changed | hook / different binary | KASLR, KARL, relocation, PAC, GPA/HPA, local handle |
| the same integer | the same object | CPtr, Zircon handle, endpoint, fid, grant ref, event port, capability name |
| driver has no syscall / IRP handler | no I/O | framework callback, user-space driver, miniport, resource manager, DDF, scheme |
| thread is READY but does not run | scheduler bug | partition window, budget, SC, safety class, upper scheduler, scheduler disabled |
| file exists but the code did not run | loader bug | activation state, AuxKC, Function Group, module load stage, on-demand discovery |
| disk code ≠ runtime code | rootkit | livepatch, ftrace, jump labels, kernel collection, runtime relocation, init section already freed |
| IPC has no syscall trace | no communication happened | shared-memory channel, local transport, co-located driver, VMBus, grant table |
| memory access fault | memory is bad | MPU zone, capability rights, cell/partition ownership, IOMMU, current privilege level |
| service suddenly changes PID / endpoint | hijack | restart / live update / reincarnation / on-demand load |

## 2. Shared rule A: a local handle ≠ a global identity

Before building a graph across processes, partitions, or domains, **recover `local identifier → namespace/table → real object` first**, then talk about relationships.

| System | Local identifier | How to recover |
|---|---|---|
| seL4 | CPtr | that CSpace's mapping → kernel object |
| Fuchsia/Zircon | handle integer | process handle table → object + rights |
| MINIX 3 | endpoint / grant ID | label resolution, grant-table entry + sequence number |
| Genode | capability local name | PD-local naming → session/object |
| Plan 9 | 9P fid | connection + walk history + qid |
| Xen | grant ref / event port | grant-table entry; `shared_info` bitmask (the remote port is the stable one) |
| Bao | —— | shared-object identity is `shmem_id` in the config, not an address |
| ACRN / Jailhouse | —— | shared-region ownership is decided by config / prefix (`dm:/` vs `hv:/`) |

## 3. Shared rule B: ready is not a sufficient condition for "eligible to occupy the CPU now"

Partitioned / safety systems (ARINC 653, PikeOS, INTEGRITY, Deos, XtratuM, LynxSecure, Jailhouse, Bao, Quest-V) **share one lesson**:

```
resource eligibility (budget/quota)
  → partition/domain eligibility (current window, schedule plan, CPU ownership, safety mode)
  → local-scheduler eligibility
  → thread priority
```

**This cannot be simplified to "the highest-priority READY thread runs".** During analysis, align the partition-level timeline first, then look at the thread level.

## 4. Shared rule C: no kernel entry ≠ no I/O

User-mode driver / service forms differ, but the conclusion is the same — **not finding dispatch in the kernel is normal**:

resource manager (QNX), DriverKit/System Extension (macOS), driver host (Fuchsia), DDF (HelenOS), scheme (Redox), user-space service + RS (MINIX 3), user-space file server (Plan 9).

## 5. Shared rule D: no CFG edge / no syscall ≠ it did not happen

- **Registration style**: linker set (FreeBSD `set_*`), iterable section + `SYS_INIT` (Zephyr), generated RTE (AUTOSAR), config-generated task/handler (TOPPERS, RTEMS), autoconf (OpenBSD), on-demand autoload (NetBSD)
- **Callback style**: framework callback (Windows models), SDK callback (VxWorks io-pkt, `nw_pthread_create`)
- **Asynchronous control flow**: AST (OpenVMS), SRB (z/OS), fault handler (seL4)
- **Exception edge**: `__ex_table` (Linux exception fixup)
- **Shared-memory style**: PV ring (Xen), driver-runtime local transport (Fuchsia), grant (MINIX), VMBus (Hyper-V), VirtIO / shared page

## 6. Shared rule E: a trust boundary cannot be inferred from instruction shape

**In a capability / sandbox / multi-version / live-update driver system** (covers seL4, Genode, Fuchsia, multi-kernel systems, partitioned hypervisors, user-mode driver OSes, and similar):

```
do not infer a trust boundary from CPL, address, a direct call, or an MMIO instruction
```

Recover **domain, capability, mapping, device ownership, version, lifecycle topology** first, then interpret control flow. Four corollaries:

| Looks like | May actually be |
|---|---|
| direct call | a call across logical components (same address space ≠ same component; the same component may also cross an isolation domain) |
| direct MMIO | an authorized device mapping (**"can access MMIO" ≠ "has whole-machine kernel rights"**) |
| same privilege level | independent domains isolated by the MMU (**Ring 0 → the whole kernel is addressable** is an invalid assumption on this kind of system) |
| integer handle | capability / shared-page offset / domain-local identifier (comparing across domains is meaningless) |

Companion requirement: memory forensics must distinguish **VA / PA / backing frame / capability / owner domain / mapped domain**. A shared-memory pointer must carry domain semantics (`{domain, cap, mapping, offset, length, rights}`), or data-flow analysis will incorrectly merge a legal cross-domain flow. System-specific branches: [[re-kernel/hic]], [[re-kernel/sel4-kernel]], [[re-kernel/zircon-kernel]], [[re-kernel/genode]].

## 7. Shared rule F: what is on disk ≠ what is running

livepatch / ftrace / jump label (Linux), AuxKC and Kernel Collection (macOS), runtime relocation and `__init` release (Linux), live update (MINIX 3), dynamic module replacement (Nucleus, OSE), on-demand discovery (Haiku).

**Before comparing, align three identities**: the on-disk version / the version in the loaded set / the version that is actually running now.

## 7. Cross-system exception-handling tree

```
see an "abnormality"
│
├─ function has no caller
│   ├─ callback registration
│   ├─ linker set
│   ├─ generated RTE / config
│   ├─ IPC dispatch
│   ├─ AST / SRB
│   ├─ exception table (__ex_table)
│   └─ init / iterable section
│
├─ addresses do not match
│   ├─ KASLR / KARL
│   ├─ PE / ELF relocation
│   ├─ PAC
│   ├─ GPA / HPA
│   ├─ local handle namespace
│   └─ runtime KC / image
│
├─ driver has no kernel entry
│   ├─ user-space driver
│   ├─ resource manager
│   ├─ DriverKit
│   ├─ Fuchsia driver host
│   ├─ Redox scheme
│   ├─ HelenOS DDF
│   └─ MINIX service
│
├─ thread does not execute
│   ├─ partition window
│   ├─ budget / quota
│   ├─ SC donation
│   ├─ safety class
│   ├─ Hwi/Swi scheduler disabled
│   ├─ partition mode (not yet in NORMAL)
│   └─ upper scheduler
│
├─ IPC has no syscall
│   ├─ shared-memory ring
│   ├─ polling
│   ├─ co-located transport
│   ├─ VMBus / GPADL
│   ├─ grant table
│   └─ hypervisor channel
│
├─ memory access fault
│   ├─ capability rights
│   ├─ MPU zone
│   ├─ task isolation
│   ├─ cell / partition assignment
│   ├─ IOMMU
│   └─ runtime privilege level
│
├─ binary exists but is not running
│   ├─ AUTOSAR Function Group / Machine State
│   ├─ System Extension activation
│   ├─ boot / module stage
│   ├─ partition mode
│   └─ on-demand driver discovery
│
└─ runtime differs from disk
    ├─ livepatch
    ├─ jump-label / ftrace
    ├─ AuxKC / kernel collection
    ├─ dynamic module relocation
    ├─ init code already freed
    └─ live update / restart
```

## 8. How to use

1. A phenomenon hits any row of the table above → **check the "must rule out first" items one by one**. Do not jump to a conclusion
2. Need detail on one system → reverse-lookup the matching skill and branch from table A in [[rerouting]] or from [[capability-index]]
3. The check means are always the same three: **cross-view** (several views crossed), **configuration** (config / manifest / plan file), **runtime verification** (runtime state, not disk contents)
4. Write a "damaged / malicious / bug" conclusion only after the normal mechanisms that model allows have been ruled out — and write in the report **which possibilities were ruled out, and on what basis**

## 9. Abnormality quick table (look up by phenomenon)

| Phenomenon | Consider first |
|---|---|
| AUTOSAR binary exists but the process does not | Function Group State / Execution Manifest |
| AUTOSAR service cannot be discovered for a while | service discovery allows an empty result / availability-callback lifecycle |
| AUTOSAR process restarts with no crash | platform health monitoring → state management |
| AUTOSAR still has old data after an update / data disappears | Persistency update policy (keep / overwrite / delete) |
| No runtime configurator can be found in a separation kernel | static configuration + no dynamic system modification |
| guest operates real MMIO / IRQ directly | static direct assignment (I/O exported to the guest) |
| high-priority READY does not execute in a partitioned RTOS | time window / scheduling-domain eligibility |
| a partitioned RTOS has extra CPU time | slack reclaim |
| a partitioned RTOS major-frame start drifts slowly | an external clock-sync class of mechanism (confirm in the specific model's documentation) |
| the same address has different rights in a certified RTOS | per-task MPU/MMU regions |
| a handle in a certified RTOS does not look like a pointer | indirect object ID + cross-reference table |
| an ISR woke a task but did not switch | nested ISR / ISR exit protocol / scheduler lock |
| a task was woken but has no resource | abort-wait path (woken ≠ acquire succeeded) |
| isolation still exists under linear addresses | linear mapping + entitlement (not a per-process independent VA) |
| a module was replaced with no reboot | dynamic reload / restart / update |
| the word "partition" appears | split first: spatial isolation domain vs fixed-block memory pool |
| a high-priority task is READY and does not run (TI SYS/BIOS) | disabling Swi scheduling also disables Task scheduling |
| an Swi stack looks like an ISR stack | an Swi already runs on the system/ISR stack |
| an API called in an ISR takes effect later | ISR FIFO delay queue |
| the same object has different rights on different threads | Safety Class / MPU protection domain |
| a plan switch takes effect late | a normal switch waits for the current plan / MAF to end |
| a plan switches instantly | health monitoring switched to the maintenance plan |
| a sampling port "drops intermediate values" | latest-value overwrite semantics |
| a device disappears and comes back inside the Service VM | device ownership was handed to a post-launched VM |
| shared-memory devices each work but cannot talk to each other | the two implementations (dm-land / hv-land) do not interoperate |
| a small integer is treated as an address (Hyper-V) | a GPADL is a handle |
| deleting a GPADL stalls | the server still has it mapped; blocks until unmapped |
| a packet callback returns but the resource is not released | the completion call may be deferred |
| fetching external data returns "pending" | paging is required; a later callback may arrive at a different IRQL |
| VMBus network traffic suddenly disappears but the network is fine | SR-IOV VF passthrough path switch |
| a ring updates with no notification (Xen) | notification suppression (threshold not crossed) |
| event unmask behaves oddly | pending / masked / FIFO semantics |
| domid / port changes after migration | the protocol must be renegotiated |
| event-accounting layout differs inside the same build | two ABIs; parsers must not be mixed |
| an init function with 0 xref (Unikraft) | multi-level init tables (constructor / early / platform / library / rootfs / system / late) |
| the same syscall name appears as several symbols | three wrapper layers: libc style / raw-error style / shim |
| a missing syscall returns ENOSYS but the app keeps running | optional syscall stub |
| I/O of the same source is completely different (MirageOS) | the build target decides the backend |
| every "thread" stalls together | cooperative threads do not yield (starve the event loop) |
| a background-task exception does not kill the system directly | asynchronous exception-handling policy |

## 10. Version and generation hints

- **Fingerprint the target's version before applying an entry**: specifications and manuals have generation differences — for example a platform specification may have moved to a new version while most public detail comes from the previous one; the most complete public manual for a hypervisor may belong to one generation (such as XM-4). **Do not apply it unconditionally to other generations**
- Different product lines of the same system (safety-certified edition and base edition) **are also not the same binary / kernel**. Optional mechanisms differ

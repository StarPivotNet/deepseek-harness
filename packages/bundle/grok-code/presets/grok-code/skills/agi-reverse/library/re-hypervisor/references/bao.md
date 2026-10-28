# Bao: static resource partitioning / shmem_id / cache coloring

<CORE RULE>
Bao is a **purely static-partition** hypervisor:

- Memory is **statically allocated** through two-stage translation; I/O is **passthrough only**; **virtual interrupts map directly onto physical interrupts**; vCPU and physical CPU are **1:1**, and **there is no scheduler**
- **No runtime memory allocation, no full device emulation**
- **CPUs, memory regions, and interrupts are exclusive by default and not shared**; only shared memory / IPC explicitly declared in the configuration crosses VMs

So the first judgment is:

```
Both VMs can access the same span of physical RAM
  → if it is not part of an IPC/shared-resource configuration → first suspect a bad configuration, or that you read the address level wrong
```

**Do not use "addresses match / differ" to decide whether two VMs are looking at the same shared object.**
</CORE RULE>

## 1. Identity comes from configuration, not from the address

The configuration is a C source file that defines a global `struct config`:

- **`.shmemlist`**: the shared-memory region list. Each `struct shmem` has `size`, `place_phys`, a `base`/`phys` union, and **`colors`** (the L2 shared-cache color bitmap; the default `0x0` means use every color)
- **`.vmlist`**: the VM list (required). Each `struct vm_config` has the guest image (base / load address, size, `separately_loaded`, `inplace`), `entry`, **`cpu_affinity`** (the desired physical-CPU bitmap, **conventionally mutually exclusive across VMs**), `colors`, `platform`
- Each VM's `struct vm_platform` has: `cpu_num`, memory regions (`regions`), **IPC channels (`ipcs`)**, MMIO device regions (`devs`), `mmu`, and so on

**Key fields of an IPC channel `struct ipc`**:

| Field | Meaning |
|---|---|
| `base` | the **virtual base of this IPC memory region inside this VM** |
| `size` | the size, **which should be less than or equal to the size of the shared region its `shmem_id` points at** |
| **`shmem_id`** | **the ID of some shared region in `.shmemlist` — this is the shared object's identity** |
| `interrupt_num` / `interrupts` | the interrupt-number array assigned to this IPC channel (the doorbell mechanism) |

**So:**

```
VM A: 0x70000000 → shmem_id 2
VM B: 0x90000000 → shmem_id 2
```

**The two addresses differ, but the underlying communication object is the same** — reasoning "equal addresses == the same buffer" is immediately wrong. (The converse also holds: two VMs using the same virtual address does **not** mean it is the same object.)

## 2. Interrupts and devices: passthrough, exclusive, 1:1

- A device is **assigned exclusively to one VM** at configuration time, and its interrupt is **routed directly to that VM**, to avoid virtualization overhead
- A vCPU is assigned to a physical CPU by the configured affinity (if affinity is undefined, assignment is sequential)
- **Bao itself needs only one interrupt**, the IPI used for inter-core communication / synchronization
- Initialization has seven stages (early boot → CPU init → memory init → platform init → interrupt init → VMM init → VM launch/run), and **after that there is no scheduling and no dynamic reconfiguration**

## 3. Cache coloring: interference suppression, not a cure-all

- The `colors` bitmap splits the LLC into distinct colors given to each VM, reducing mutual interference
- **Off by default**; the value is **truncated at runtime to the number of colors the platform has**, so **the effect is platform-dependent**
- Measured (on a platform of 16 colors × 32 KiB): 7 colors per VM (224 KiB), with 2 colors left for the hypervisor, interference can drop by nearly half — **but it cannot be eliminated completely**
- **Cost**: coloring makes **superpages unusable** (Bao otherwise uses large pages to lower TLB pressure), which **raises TLB pressure and overhead**

**When attributing latency / performance, do not assume every VM naturally shares the whole LLC.**

## 4. Extra detail on MPU targets

On a no-MMU (MPU) target, a shared-memory region needs **cross-core synchronization**: when one core maps the shared region it exchanges messages with the other cores that share it (type/ID and region configuration) and notifies them with an IPI; **during early boot, before IPI is enabled, non-primary cores wait by polling**. vMPU replaces page tables with memory-protection entries; the Arm PMSAv8 granule is 64 bytes.

## Decision tree

```
Given a Bao target
├─ Take the configuration first (struct config: shmemlist + vmlist)
│    ├─ Which VM owns CPU affinity, memory regions, devices, and interrupts
│    └─ Is there cross-VM sharing: look at shmem entries and an ipc's shmem_id
├─ Two VMs access the same physical memory
│    ├─ Is it part of an IPC/shared configuration? → normal (align by shmem_id, not by address)
│    └─ It is not? → first suspect a bad configuration or a wrong address-level judgment
├─ The shared region's address differs in the two VMs
│    └─ Normal: the identity is shmem_id; base is only this VM's mapping address
├─ Performance / latency attribution
│    ├─ Is cache coloring enabled (the colors bitmap)
│    ├─ When coloring is in effect, large pages are sacrificed → TLB pressure rises
│    └─ The effect is truncated to the platform's available color count; do not copy a conclusion across platforms
└─ A no-MMU (MPU) target
     └─ Shared-region mapping uses cross-core messages + IPI (non-primary cores poll during early boot)
```

## Tools and verification

- Configuration: `struct config` (`.shmemlist` / `.vmlist`), `vm_platform` (regions / ipcs / devs), `struct ipc` (base / size / shmem_id / interrupts)
- Sharing: align different VMs' mappings by `shmem_id`, not by address
- Isolation: CPU affinity and exclusive ownership of devices / interrupts; no reconfiguration at runtime after the seven initialization stages
- Verification: you can state together "the shared object's identity (shmem_id) + each VM's mapping address + interrupt ownership"

## Pitfalls on this platform (summary)

- **Using address equality to judge shared-object identity**: the identity is `shmem_id`; each VM's `base` can differ
- **Seeing two VMs access the same physical memory and calling it "a configuration leak"**: first see whether it is part of an IPC/shared configuration
- **Assuming resources can be requested at runtime**: static partitioning; after the seven initialization stages there is no dynamic reconfiguration
- **Expecting a scheduler**: vCPU and physical CPU are 1:1; there is no scheduler
- **Assuming interrupts are virtualized / emulated**: interrupts are routed directly to the owning VM; I/O is passthrough only
- **Ignoring the IPC constraint `size ≤ the corresponding shmem size`**: behavior is unpredictable when the configuration does not satisfy it
- **Assuming VMs share the whole LLC in a performance analysis**: cache coloring changes that, and it is limited by the platform's color count
- **Ignoring the large-page loss in order to get coloring**: it raises TLB pressure and can cancel the gain
- **Ignoring cross-core shared synchronization on an MPU target**: mapping a shared region needs cross-core messages and an IPI

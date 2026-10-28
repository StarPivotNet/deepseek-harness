# Jailhouse: cell configuration / park / loadable memory / ivshmem

<CORE RULE>
Jailhouse is a **static-partition** hypervisor: **the configuration file matters more than the inmate's ELF itself**.

There is no "a VM requests resources at runtime" — the `.cell` configuration directly states the CPU set, memory regions, IRQ chips, PIO, PCI, and permissions.

So analyzing an inmate means:

```
inmate image + .cell configuration + root cell configuration + host DT/ACPI
```

**Without the configuration half, almost every judgment about "why it can / cannot access some address" is a guess.**
</CORE RULE>

## 1. Resource ownership is in the configuration, not negotiated at runtime

- A cell descriptor contains: the CPU set, memory regions (including `phys_start` / `virt_start` / `size` / flags), IRQ, PIO, PCI ownership, and permissions
- Memory-region flags are the criteria: **`READ` / `WRITE` / `EXECUTE` / `DMA` / `COMM_REGION` / `LOADABLE`** (note that **a missing `DMA` flag makes a non-root Linux cell fail to recognize those regions as RAM**)
- `jailhouse cell load` loads the image into the memory region the configuration names, and **the load address must fall inside a mapped region** (for example, `virt_start` unset and the image landing outside low memory fails with "Invalid argument" — that is a configuration problem, not an image problem)

## 2. An unauthorized access → the CPU is parked (not a guest crash)

- When memory / a peripheral not mapped to that cell is accessed, the hypervisor logs **"Unhandled data read" / "FATAL: unhandled trap"**, then **"Parking CPU n (Cell: ...)"**
- **A parked CPU/cell has stopped running**

So when you see "the program suddenly stopped" and cannot find the ordinary evidence of a page fault / bus error, **first compare `cell.mem_regions` and PCI and IRQ ownership**: **an illegal access intercepted by the hypervisor and halted is a first-class explanation**.

## 3. `JAILHOUSE_MEM_LOADABLE`: the load window is one-shot

- A memory region marked `LOADABLE` **can be mapped into the root cell, for loading / reloading an image**
- **When the cell starts, those mappings are revoked** ("root-cell access to regions marked loadable is taken back")
- A reload goes through the **Cell Set Loadable** hypercall: **shut down the running cell, and map its loadable regions back into the root cell**
- The related error codes are distinct: a non-root cell initiates it, or the target cell refuses shutdown → `-EPERM`; the cell does not exist → `-ENOENT`; **the root cell cannot be set loadable** → `-EINVAL`
- Later, **resetting PCI devices** was added at Cell Set Loadable (previously active devices are quiesced and DMA is stopped first, so they do not conflict with the load)

**Typical observation**:

```
Root Linux can access 0xXXXX directly before start
After the inmate starts, another access → fault
```

**This is by design**, not "the memory was protected / hooked".

## 4. ivshmem: read event state from the shared-memory protocol; do not expect a pending bit

ivshmem v2 register semantics are **deliberately different** from a standard PCI device:

- **Interrupt Control Register**: bit 0 enables interrupts; **if one-shot mode is enabled, the device clears bit 0 on every interrupt delivery** — automatic throttling for a UIO-class driver, saving one VM-exit
- **The device has no notion of a pending interrupt**: **reading the MSI-X Pending Bit Array always returns 0**; on the INTx side **the Interrupt Status bit of the Status Register is never set** (a deviation from the PCI specification), and there is no "pending INTx" information
- The specified approach is: **derive event state from protocol information in the shared memory**
- **Doorbell Register**: write-only; the low 16 bits are the vector number, the high 16 bits are the target ID; writing a vector the target has not enabled has no effect, and writing a nonexistent target has no effect; **reading the register is undefined**
- **State Register**: a write updates local state and triggers MSI-X vector 0 (or INTx) on the remote device, provided the new value differs from the old; the peer distinguishes "state change" from "doorbell event" by comparing a local copy
- **State Table**: a read-only region at the start of the shared memory, one 32-bit state value per peer; cleared on reset / disconnect
- The protocol type is encoded in the interface / sub-class of the PCI Class Code (for example virtual point-to-point Ethernet, a user-defined range, Virtio over shared memory)

**Corollaries**:

- **"An interrupt arrived but the PBA is always 0" is not a hypervisor bug**; **"there is no pending bit to check" also does not imply "there is no event"**
- Debugging should take **the protocol state in the shared memory** as authority, combined with the State Table / State Register when needed

## 5. Not finding inmate memory in the hypervisor address space is normal

Jailhouse **does not permanently map an entire cell into the hypervisor address space**: only explicitly shared pages, and pages temporarily mapped while handling MMIO and similar cases, are visible, and a temporary mapping **may be per-CPU**.

So a forensics / debug tool that "walks every VM's RAM through the hypervisor VA" misses a large amount of content — **the memory was not hidden**.

## Decision tree

```
Given a Jailhouse target
├─ Take the configuration first: .cell / root cell config / host DT and ACPI
│    ├─ Whether memory-region flags (including DMA) and virt_start match the image
│    └─ PCI / IRQ / PIO ownership
├─ The program stops after accessing some address
│    ├─ Check the hypervisor log: Unhandled trap → Parking CPU n
│    └─ Compare whether that address belongs to this cell (if not → a violation, not a driver bug)
├─ The root cell can access it → after the cell starts it cannot
│    └─ LOADABLE mappings are revoked when the cell starts; a reload needs Cell Set Loadable
├─ ivshmem and interrupts
│    ├─ PBA always 0 / the Status bit is never set → the device simply does not maintain pending semantics
│    ├─ Read event state from the shared-memory protocol (State Table / State Register)
│    └─ In one-shot mode Interrupt Control bit0 is cleared by the device
└─ Some cell's memory cannot be found in the hypervisor VA
     └─ Only shared pages and temporary mappings are visible, and a temporary mapping may be per-CPU
```

## Tools and verification

- Configuration: the cell descriptor (memory regions and flags, PCI/IRQ/PIO ownership), the root cell configuration, host DT/ACPI
- Violation judgment: hypervisor console output (Unhandled trap / Parking CPU)
- ivshmem: the register area (Interrupt Control / Doorbell / State), the State Table, shared-memory protocol state
- Verification: you can state together "resource ownership (how the configuration split it) + why the access was blocked (violation vs revoked mapping) + where event state is read from"

## Pitfalls on this platform (summary)

- **Looking only at the inmate ELF and not at the cell configuration**: resource ownership is entirely in the configuration
- **Treating "stopped after an access" as a guest crash / driver bug**: an unauthorized access gets the CPU parked by the hypervisor
- **Treating the root cell losing access after the cell starts as an anomaly**: a `LOADABLE` mapping is revoked at start; a reload goes through Cell Set Loadable
- **Forgetting to mark a memory region `DMA`**: otherwise a non-root cell does not treat that region as RAM, and the symptom looks like "the memory disappeared"
- **Using the MSI-X PBA to decide whether there is an event**: ivshmem does not maintain pending semantics; the PBA is always 0
- **Using the Interrupt Status bit of the Status Register as a pending basis**: that bit is never set
- **Reading the Doorbell register**: it is write-only; a read is undefined
- **Walking every VM's memory through the hypervisor VA**: only shared pages and temporary mappings are visible
- **Treating bit0 being cleared in one-shot mode as "the interrupt was swallowed"**: that is automatic throttling on the device side

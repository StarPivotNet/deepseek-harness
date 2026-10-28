# Nucleus RTOS: flat memory map + protection domains / dynamic module lifetime

<CORE RULE>
The least intuitive point:

```
"process isolation" exists
  ≠ the Linux model of "each process gets a fully independent virtual-address world"
```

Nucleus Process Model:

- **MMU** is available on Cortex-A, **MPU** on Cortex-M
- It provides **space-domain partitioning** and **entitlement**
- It uses a **flat memory map + protected memory regions**
- **An application and a kernel module can be dynamically reloaded / restarted / updated without stopping the whole system**

So:

```
Addresses in two processes look linear and close together  → you cannot conclude "there is no address-space isolation"
The same address is accessible to A and faults for B       → it may only be a different entitlement
A module is replaced and the system never rebooted         → that may be a normal module lifetime
```

**Judge isolation from MMU/MPU entitlement, not by comparing pointer values.**
</CORE RULE>

## 1. How the Process Model differs from the POSIX mental model

The picture to recover is:

```
Nucleus Process
├─ modules
├─ tasks
├─ protected regions
└─ entitlements
```

**Not** `PID → page tables → fork parent → exec ELF`. A Nucleus "process" is about **module loading, memory-access protection, privilege, and isolation**, not a copy of the Linux process ABI.

- Cortex-M can have a process model **without a full MMU** — via MPU region reprogramming, privilege level, and entitlement; **"no page tables" does not imply "no Process Model"**
- One process failing **should not be assumed to take the whole system with it**: the point of spatial isolation is that recovery can be "restart the failed module/process; the other subsystems keep going"

## 2. Terminology trap: `partition` has two completely different meanings

| Name | Meaning |
|---|---|
| **Process Model space partition** | The spatial isolation domain of a process / subsystem |
| **`NU_PARTITION_POOL`** | **An allocator of fixed-size memory blocks (memory partition pool)** |

```
NU_Create_Partition_Pool(pool, name, start_address, pool_size, partition_size, suspend_type)
NU_Allocate_Partition(pool, &ptr, suspend)
NU_Deallocate_Partition(ptr)
```

Here **partition means "a fixed-size memory block"**, unrelated to an isolation domain. **When you see the word partition, first decide which one it is.**

## 3. Fixed-block allocator semantics (whether "stuck in the allocator" is normal)

- A pool is a **contiguous memory region + fixed-size blocks** (for example 2000 bytes, 40-byte blocks = 50 blocks)
- **Allocation is deterministic O(1)**: no search; **fragmentation cannot occur**; the only failure mode is **that pool is actually exhausted**
- Suspend options:
  - **`NU_NO_SUSPEND`**: return immediately whether or not the request can be satisfied; **a non-task thread (such as `Application_Initialize`) may use only this**
  - **`NU_SUSPEND`**: the calling task **suspends until a block is returned**
  - **A timeout value**: suspend until a block appears or the timeout fires
- When several tasks are suspended on the same pool, they resume in the **FIFO or priority** order specified when the pool was created
- Return value **`NU_NO_PARTITION`** means "cannot be satisfied immediately"

**So**:

```
A task is stuck in the allocator, state = suspended
  → with NU_SUSPEND and an empty pool, suspension is what the semantics require
  → it is not a heap deadlock

Allocation fails but plenty of system RAM remains
  → a fixed pool ran out; that is unrelated to the general heap, and it is not "global heap fragmentation"
```

## 4. Dynamic module lifetime

Nucleus supports **dynamic reload / restart / update** of applications and kernel modules **without affecting other modules and without shutting down the whole system**.

So a firmware timeline can show:

```
module A version X → brief stop → module A version Y
and there is no boot event anywhere in between
```

**That alone cannot be called "runtime injection / rootkit replacement"** — first check that system's module lifecycle / update path.

This differs from the traditional assumption "monolithic embedded image: update one piece → reboot the whole device".

## Decision tree

```
Given a Nucleus target
├─ You see "partition"
│    ├─ Is it a Process Model spatial isolation domain?
│    └─ Or the NU_PARTITION_POOL fixed-block allocator?
├─ Addresses of two "processes" look linear / close
│    ├─ A flat memory map + protected regions is the model
│    └─ Judge isolation from entitlement, not by comparing addresses
├─ Access rights differ for the same address
│    └─ That matches "same linear address + different protection entitlement"
├─ No page tables on Cortex-M
│    └─ A process model can still exist (MPU + privilege + entitlement)
├─ A task is suspended inside the allocator
│    ├─ Check whether it used NU_SUSPEND and the pool is empty
│    └─ Check pool capacity and the return path, not a heap deadlock
├─ Allocation fails but memory is plentiful
│    └─ The fixed pool is exhausted; unrelated to the general heap
└─ A module is replaced with no reboot
     └─ Check the official module reload / update lifetime
```

## Tools and verification

- Isolation: MMU/MPU configuration, protected regions, entitlement, and privilege state
- Memory: partition-pool block size and block count, current occupancy and waiters; distinguish it from the general heap
- Lifetime: module load / reload / update paths and version-change points
- Verification: you can state together "isolation is MMU or MPU, and what the entitlement is + which domain this address belongs to + whether the allocation failure is pool exhaustion or a heap problem"

## Pitfalls on this platform (summary)

- **Understanding isolation with the Linux per-process independent address space**: here it is a flat map + protected regions + entitlement
- **Comparing pointer values to decide whether memory is shared**: the same address does not mean shared memory
- **Denying the Process Model on Cortex-M because there are no page tables**: an MPU can still build isolation
- **Reading every `partition` as an isolation domain**: `NU_PARTITION_POOL` is a fixed-block allocator
- **Treating a suspend caused by `NU_SUSPEND` as a heap deadlock**
- **Diagnosing fixed-pool exhaustion as global heap fragmentation**: that allocator does not fragment
- **Treating a module replacement with no reboot as injection**: dynamic reload / restart / update is an existing capability
- **Using `NU_SUSPEND` from a non-task thread**: only `NU_NO_SUSPEND` is allowed
- **Assuming a process failure means a full-system reset**: the point of isolation is local recovery
- **Expecting fork / exec / mmap semantics**: that is not what this process model is about

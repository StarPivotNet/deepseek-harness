# Partitioned RTOS: INTEGRITY / ARINC 653 / VxWorks 653 / PikeOS

<CORE RULE>
Scheduling on this class of system is **more than one layer**:

```
Partition-level scheduling (major frame / partition window / budget)
        ↓
Intra-partition scheduling (process/task priority, this partition's own scheduler)
```

The most common misread is:

```
Task A priority = 250, Task B = 100
B is running, A is not running at all
  → not "the scheduler is broken", and not starvation
  → A may sit in a partition that currently has no execution window / budget
```

**"A high-priority thread is not running" is first a partition-level explanation here, and only then a task-level one.**
</CORE RULE>

## 1. Two-level scheduling and the major frame

- **Partition level**: fixed, cyclic, offline-defined scheduling. A partition is periodically released for a span of time inside a cyclic interval
- That interval is the **major time frame (MAF)**, made of several **partition windows**; each window is defined by **duration, offset, and periodicity**
- **Activation order is defined statically in a configuration table and cannot change at runtime**; when well designed, **MAF duration ≈ the least common multiple of the partition periods**
- The partition schedule lists preemption points relative to the start of the MAF; scheduling is "the current clock falls inside some partition's window (offset → offset+duration)"
- **Inside the partition**: the partition's own scheduler manages its processes (in the ARINC 653 vocabulary this is usually fixed-priority preemptive)

**Analysis requirement**: the timeline must be **aligned at partition level first**, and only then discussed at thread level.

## 2. Partition mode: a process that "does not run" often has not entered NORMAL yet

An ARINC 653 partition has four states: **IDLE / COLD_START / WARM_START / NORMAL**

| Mode | Meaning |
|---|---|
| **COLD_START** | Initialization in progress; **preemption is locked**; the application is running initialization code; the initial environment may need to **copy code from non-volatile memory into RAM** |
| **WARM_START** | Also initialization with preemption locked, but the initial environment **can differ** from cold start (for example, no copy from NVM) |
| **NORMAL** | Initialization is done, **the partition's process scheduler is active**, and created ready processes may run |
| **IDLE** | No process is executing, but the window assigned to this partition is still reserved |

- Transitions: IDLE → COLD/WARM_START; COLD_START → NORMAL; NORMAL → COLD/WARM_START (restart); → IDLE (shutdown / set to IDLE)
- Services: `SET_PARTITION_MODE` and `GET_PARTITION_STATUS` (returns identifier, period, duration, lock level, **operating mode**, start condition)
- **In an initialization mode (COLD/WARM_START) only the main process is schedulable**; the error handler is created during initialization and may call `SET_PARTITION_MODE` to restart the partition

**So**:

```
CREATE_PROCESS() / START() were both done, but the process never runs
  → first check whether SET_PARTITION_MODE(NORMAL) was executed
  → do not immediately call the scheduler broken
```

## 3. Sampling ports and queuing ports: different semantics, do not mix them

| | Sampling port | Queuing port |
|---|---|---|
| Buffer | **A single message** | A configurable message count |
| Overwrite | **A new message overwrites the old one**; the application always reads the **latest** | **No overwrite**; delivered **FIFO** |
| Dropped messages | **May be dropped / overwritten** | Not dropped; send fails / blocks when the queue is full |
| Refresh period | **Meaningful only for a sampling-mode receive** (decides whether a new message arrived) | Not applicable |

- A channel connects one source port to one or more destination ports; the kernel enforces memory protection between partitions, so other partitions cannot access this partition's ports

**So**:

```
A, B, and C were written in a row, and only C was read back
  → for a sampling port that can be completely normal
  → for a queuing port it is not
```

## 4. INTEGRITY: space + time + resource, three partition domains

- Microkernel architecture, supporting **multiple protected virtual address spaces**, each of which can contain **multiple application tasks**; isolation is built with the hardware MMU
- **A complete partition covers space, time, and resource domains**; a failure does not propagate across partitions
- **Fixed budgets**: each process can be given **a fixed CPU-time and memory budget**; a guaranteed time window also means **a running task will not exceed its window**
- Other mechanisms: the real-time scheduler supports multiple priorities and **full CPU-percentage allocation control**; kernel-service time is bounded; **no dynamic memory allocation in kernel space**; a built-in **ARINC 653 Part 1 partition scheduler** (with guaranteed execution windows); a **memory-quota system** stops one address space from exhausting another's memory; **kernel memory is not used for objects that processes request, such as messages and semaphores**
- **Static configuration**: the architect writes a static configuration file in advance, defining partitions, task sets, memory objects, links, connection channels, clocks, and the partition-scheduling mechanism; **the boot table defines ownership**; **connections are statically allocated and cannot be bypassed**; MMU settings can be verified statically
- Multicore: different partition time windows can be bound to different cores; **contention for shared resources can increase WCET by 8–13×** (this is also what the related airworthiness guidance emphasizes)

**RE spine**:

```
The CPU clearly still has idle time, but the application cannot get more execution time
  → it may be budget isolation (by design), not a scheduling-efficiency bug
```

## 5. PikeOS: there is a third layer

PikeOS is a second-generation separation microkernel (and a hypervisor at the same time): **statically cyclic scheduled partitions** (time isolation) + memory regions (space isolation); each partition has its own scheduling structure and **supports 256 priorities**; **the system partition and the currently active partition are scheduled together** to provide system services.

Layers of a POSIX guest:

```
PikeOS partition / resource scheduler
        ↓
PikeOS system thread (one per core, available to that POSIX kernel)
        ↓
the POSIX guest kernel's own scheduler
        ↓
POSIX user threads
```

- The POSIX kernel's **own scheduler maps its user threads onto one PikeOS system thread**; many POSIX drivers also create their own I/O threads
- The POSIX guest implements the PSE52 subset, plus real-time and PikeOS-specific extensions (**including ARINC 653 sampling / queuing ports**)
- **APEX guest**: a full implementation of ARINC 653 P1-5 and part of P2-4 (partition management, health monitoring, sampling / queuing ports, process management, intra-partition communication and synchronization, logbook, file system, memory blocks, service-access-point ports)
- **APEX services are entered through an API table linked at a fixed address**: at development time the application is linked against the library and the API service-table address given by the linker script
- After initialization the APEX kernel hands control to the user-supplied `MAIN()`, **starting in COLD_START** (preemption locked, static resources created), then the partition enters **NORMAL** (process scheduler active, full APEX API available)

**Two corollaries**:

```
A thread inside the guest is highest priority, but latency suddenly hits 10 ms
  → do not look only at the pthread scheduler: check whether the current partition has an execution window,
    whether the corresponding system thread is runnable, and what the CPU affinity / partition schedule is

You see many ldr x16, [fixed base + offset]; blr x16
  → first check whether it is the APEX service table, not control-flow obfuscation
```

## 6. Deos: two-level scheduling + slack + SafeMC

- A safety-critical RTOS with time / space / resource partitioning (DAL A certified): partitions let software of **different design-assurance levels** share one processor, and provide fault isolation and application restart
- **Two-level scheduling model** (SafeMC describes it explicitly):

```
Level 1: time is divided into execution windows that are [aligned] across cores
Level 2: each core/window is assigned a concrete scheduler
          ├─ ARINC 653
          ├─ Deos RMA (rate monotonic)
          └─ POSIX
An application is assigned to one or more schedulers; each scheduler can schedule several tasks across several processes/partitions
```

- **The same core can run different scheduling laws in different time spans** (window 1 uses ARINC 653, window 2 uses POSIX, window 3 uses RMA is expressible in this architecture) — **a scheduling-law change in a trace cannot automatically be called a corrupted scheduler state**
- **Slack scheduling (sliding time windows)**: a window can **compress, expand, and slide** — a partition that finishes early can compress its window, one that needs more time and has idle can expand, and others can be started early or late. **So "the budget was 10 ms, the task used 6 ms, and another task got the remaining CPU" is not a time-partition escape**; it is slack reclamation; **CPU near 100% can still be inside budget**
- **Cache partitioning**: **implemented in software and configurable**, isolating cache down to application / partition level (not only core level), **avoiding a cache flush on a partition switch** (that would affect WCET), and complementary to **memory pooling** (controlling where an application lands in physical memory)
- The development tools themselves may also **use slack time** for communication / profiling / monitoring so they disturb the critical load less — "application runs → a short tool burst → application runs" in a trace should be checked for this first
- Multicore uses **BMP (an extension of SMP) + safe scheduling + cache partitioning + memory pooling** to limit interference from shared resources. **A task is READY and a CPU is free, but execution is constrained by multicore policy**; that is not necessarily an ordinary scheduling decision — recover core assignment / window / cache partition / memory pool / cross-core interference policy
- It can also host other environments: for example some para-virtualized RTOS implementation runs inside its safety partition and presents a POSIX interface outward — **seeing `pthread_*` does not mean it has left Deos partition control**
- Two different safety partitions **being able to see shared memory** does not mean isolation is broken: check whether it is configured as shared, the permissions, who may write, and the lifetime
- If the major-frame start is observed to **drift slowly**: Deos provides external-clock synchronization capability (this check did not hit upstream material directly; **treat it as one candidate explanation and confirm it on the specific model documentation**); do not immediately call it timer drift or a broken trace clock

**Debug order (important)**:

```
A task is not running
 → which process/partition does it belong to?
 → which core?
 → is the current window active?
 → which scheduler is inside the window?
 → local priority / state?
 → budget?
 → SafeMC limits?
 → only then look at deadlock / bug
```

**For this class of system, configuration and the partition schedule come before guessing the internal scheduler from disassembly** — public documents may not open every kernel detail.

## Related systems in the same family

- XtratuM (a configuration-driven separation hypervisor): likewise "static configuration + major frame + time slots", plus a fixed-priority plan and multi-plan switching; see [[re-hypervisor/xtratum]]
- LynxSecure (a static separation kernel): see [[re-hypervisor/lynxsecure]]
- Quest-V (multikernel sandboxes + one monitor per sandbox): see [[re-hypervisor/questv]]
- Jailhouse / Bao (static partitioning hypervisors): see [[re-hypervisor/jailhouse]], [[re-hypervisor/bao]]

## Decision tree

```
Given a partitioned-RTOS target
├─ Separate layers first: partition-level scheduling vs intra-partition scheduling
│    ├─ Align the major frame / partition window (duration, offset, period)
│    └─ Only then talk about process/task priority
├─ A high-priority thread is not running
│    ├─ Check whether its partition currently has an execution window
│    ├─ Check the partition mode (still in COLD/WARM_START, not yet NORMAL)
│    └─ Check whether the resource / time budget is already exhausted (intentional isolation)
├─ A communication fault
│    ├─ Sampling port: overwrite semantics; "only the latest was read" is normal
│    └─ Queuing port: FIFO, no overwrite; full means fail / block
├─ You see a function table at a fixed address
│    └─ Consider an ABI such as the APEX service table first; do not immediately call it obfuscation
└─ Multicore / performance attribution
     └─ Count shared-resource contention and budget isolation (WCET can grow by a large factor)
```

## Tools and verification

- Scheduling: partition schedule / time-window configuration, MAF and window parameters, partition-mode state
- Resources: CPU-time and memory quotas of partitions / processes, static configuration files and the boot table
- Communication: port type (sampling / queuing) and each one's parameters
- Verification: you can state together "partition-level time window + intra-partition scheduling result + budget / mode state"; missing any one of the three cannot explain "why it did not run"

## Pitfalls on this platform (summary)

- **Explaining scheduling with one unified priority queue**: at least two layers (three in the PikeOS case)
- **Treating "a high-priority thread does not run" as starvation or a scheduler bug**: look at the partition window and the budget first
- **Ignoring partition mode**: under COLD/WARM_START only the main process is schedulable, so a process of course "does not run"
- **Treating a sampling port as a queuing port**: under overwrite semantics "only the latest was read" is normal
- **Treating a queuing port as a sampling port**: messages do not overwrite each other; a loss is definitely a problem
- **Treating resource / time budget isolation as a performance defect**: a fixed budget is part of the isolation mechanism
- **Reversing only guest contents**: in a system such as PikeOS the guest scheduler is not the final scheduler
- **Treating the fixed-address APEX service table as control-flow obfuscation**
- **Ignoring shared-resource contention in a multicore analysis**: WCET can grow by a multiple

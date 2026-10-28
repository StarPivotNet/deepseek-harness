# XtratuM: XM_CF configuration-driven / scheduling plans / IPVI

<CORE RULE>
XtratuM is a **configuration-driven** separation hypervisor: resources are not negotiated at runtime. They are stated statically by the **XM_CF configuration file**:

```
partitions / memory / interrupts / I/O ports / communication ports / schedule
```

**No dynamic object can be added at runtime.** So when you see "there is no runtime resource-allocation code", first suspect **you do not have the configuration file**, not that the code was stripped.
</CORE RULE>

## 1. XM_CF: the contract between the system integrator and the partition developer

The configuration is XML. After validation it is **translated into a binary form** (configuration tables) and integrated into the final system image.

Main contents:

| Section | Contents |
|---|---|
| **Memory** | the board memory layout, and memory given to the hypervisor and each partition; a partition memory region can carry flags (unmapped / mapped somewhere / shared / read-only / uncacheable / IOMMU) |
| **Processor** | how CPUs are assigned to partitions, including **scheduling plans** |
| **Peripherals** | peripherals not managed by XtratuM, I/O port ranges, and each partition's **interrupt lines** and device identifiers |
| **Health monitoring** | what to do after an error is detected (a direct action / hand it to the failed partition / log it / reset…) |
| **Inter-partition communication** | ports and channels (**sampling** and **queuing**), connecting a source port to a destination port |
| **Trace** | where trace messages are stored, and the trace scope |

The configuration parser does both syntactic and semantic checks: memory-region overlap / containment, duplicate partition names and IDs, CPU assignment, duplicate ports, **consistency of a cyclic schedule** (whether every partition is assigned, whether time slots overlap, whether a slot's partition ID is valid), hardware-interrupt assignment, I/O-port alignment and occupancy, channel assignment, and so on.

## 2. Two schedulers: cyclic and priority

**Cyclic scheduling (ARINC 653 style)**: a `(partition, virtual CPU)` pair is scheduled in a **fixed cycle**; a time slot is defined in the configuration as **start time + duration**; the **major frame (MAF)** repeats periodically, usually the least common multiple of the partition / thread periods.

**Priority scheduling**: schedule by the priority given to the partition in the configuration (**priority 0 is highest**), preemptive; a CPU configured as fixed-priority **is not affected by other CPUs' cyclic plans**.

**Multiple scheduling plans** (an important detail):

- **Plan 0 is reserved for initialization**: the system starts on Plan 0 until some system partition requests a switch
- **Plan 1 is reserved as the maintenance plan**: health monitoring can switch to it immediately when it detects a situation, or a system partition can request it
- The designer may define **Plan X (X>1)**
- **A plan switch happens after every remaining slot of the current plan has executed**
- On multicore: only a **cyclic plan** is associated with multiple plans; a priority CPU is independent of the plan; a plan that involves several processors **must define the same MAF**

Scheduling can be seen as a state machine: each state is some partition executing according to the plan; **a `next_slot` timer interrupt causes a context switch**; the slot-duration timer is used exclusively by XtratuM.

## 3. Interrupts and the inter-partition virtual interrupt (IPVI)

- The configuration states which device a partition may access, the device identifier, and the interrupt line that partition uses; XtratuM is responsible for mapping the memory region the device lives in
- **IPVI simulates a real inter-processor interrupt**: any partition can raise one through a hypercall, delivering a virtual interrupt to the destination partition; **each partition has at most 8 IPVIs**, implemented as the last eight extended virtual interrupts
- A partition event is usually handled by the partition itself; the hypervisor provides a notification mechanism according to the action in the configuration; writing a port / sending a new message can also raise an extended interrupt (XtratuM keeps a port-status bitmap in the partition control table)

## 4. Runtime authority

**Only a system partition** is allowed to control the state of the system and of other partitions, and to query their state. When you see "some partition wants to change global state and cannot", first see whether it is a system partition.

## 5. **Two timing semantics** of a plan switch

- **Plan 0 is the initial plan after reset**, and **it cannot be switched back to the way an ordinary user plan can**; Plan 1 is the maintenance plan; user-defined plans usually start above 1
- **A switch from an ordinary request is not immediate**: when a system partition requests a switch, the switch to the new plan happens **only after every slot of the current plan has run** (the major frame ends)

```
The old plan keeps running for a while after the switch was requested → completely normal
```

- **But a health-monitor switch to the maintenance plan can happen immediately**: it belongs to the class of action "end the current slot and start the maintenance plan at once"

**So the same "the plan changed" event has two completely different timing semantics — one model cannot explain all of them.**

- **Several requests inside the same major frame**: the plan that finally takes effect can be the one named by **the last request** — **do not mark an intermediate plan that never appeared as "the request was dropped"**

## 6. Refresh and invalidation of a sampling port

- A sampling port is a **latest value**: a new message overwrites the old one, and there is no queue; **the refresh period decides how "fresh" the data is, and old data may be marked invalid**
- A queuing port is the real "buffered unicast message" — the two must be kept strictly apart
- **No notification reached the guest after a port write**: XtratuM object notification uses an extended interrupt, and **the corresponding extended interrupt is masked by default when the partition starts** — **"the message exists but there is no interrupt" should first check the mask state**

## 7. Control flow after a fault is not decided by the failed partition

- Health monitoring maps **event / scope / partition identifier / fault address or device** onto a predefined action
- So "the system automatically switched the schedule after a fault" must be explained from the health-monitoring policy, **not only by looking at the failed guest itself**

## Decision tree

```
Given an XtratuM target
├─ Ask for the configuration file first (XM_CF)
│    ├─ Partitions / memory / interrupts / I/O / channels / schedule are all in it
│    └─ Without it, every judgment about "why this cannot be accessed" is a guess
├─ Scheduling
│    ├─ Cyclic plan: MAF + slots (start + duration) + partition/vCPU pairs
│    ├─ Priority plan: priority 0 is highest, preemptive
│    └─ A plan switch happens only after the current remaining slots have executed
├─ A partition is not running
│    ├─ Check which Plan is current (Plan 0 = initialization, Plan 1 = maintenance)
│    ├─ Check whether that partition is in the current time slot
│    └─ Check whether health monitoring triggered a switch
├─ Communication
│    ├─ Sampling port vs queuing port (overwrite semantics differ)
│    └─ Notification can go through IPVI (at most 8 per partition)
└─ Changing the configuration at runtime
     └─ Impossible: no dynamic objects; only a system partition can control system state
```

## Tools and verification

- Configuration: the sections of XM_CF and the generated configuration tables; the parser's semantic checks (usable as a checklist for "is this configuration legal")
- Scheduling: the cyclic-plan table / fixed-priority table in the processor section; the current Plan and time slot
- Communication: the port table and channel definitions; IPVI source / destination and number
- Verification: you can state together "what this partition was assigned + which plan and time slot it is in now + which port / channel the communication uses"

## Pitfalls on this platform (summary)

- **Analyzing resource ownership without XM_CF**: everything is in the configuration
- **Assuming objects can be added at runtime**: static configuration, no dynamic objects
- **Treating a plan switch as taking effect immediately after the request**: wait until the current plan's remaining slots have executed
- **Ignoring the reserved meaning of Plan 0 (initialization) and Plan 1 (maintenance)**
- **Applying a cyclic plan to a priority CPU on multicore**: a priority CPU is independent of the plan
- **A multiprocessor plan that does not define the same MAF**: configuration validation fails
- **Treating a sampling port as a queuing port**: overwrite semantics differ
- **Assuming any partition can control system state**: only a system partition can
- **Ignoring a configured health-monitoring action**: it can directly cause a plan switch or a partition-state change

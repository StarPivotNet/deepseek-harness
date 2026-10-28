# Quest-V: multikernel sandboxes / one monitor per sandbox / faults and online recovery

<CORE RULE>
It is not "one hypervisor managing every VM". It is **multiple sandbox kernels, each with its own monitor**:

```
sandbox domain = one or more CPUs + a span of host physical memory
                 (containing [a local monitor] + the sandbox kernel + local applications)

A monitor maintains EPT mappings for [only one] sandbox
  → it avoids the cost of a traditional hypervisor scheduling / switching guest address spaces
```

So two observations that are easy to misread as "missing" are actually the design:

```
Not many VM-exits              → the sandbox manages its own I/O
No central scheduler / global clock → each sandbox schedules itself and has its own physical clock
```
</CORE RULE>

## 1. When the monitor is actually called

**It intervenes on only four things**:

```
1. Bootstrapping each kernel
2. Handling a fault
3. Managing and initiating shadow page tables
4. Establishing an inter-sandbox communication channel
```

The rest of the time **the sandbox runs directly on the hardware**.

- A monitor can be built **per core**, or for a **cluster of cores** (a "domain / cell") — **it is not naturally one monitor per core**
- The monitor tracks **shadow page-table mappings**. Those mappings express **immutable memory-access capability**, so **sandbox code cannot modify "the EPT mappings that govern host-memory access"**

## 2. EPT is for memory isolation, not CPU virtualization

- EPT / nested page tables are used mainly for **memory isolation** (an extra logical protection ring); **instructions execute directly on the hardware**
- **The sandbox kernel's code segment is effectively read-only** — because sandbox code **has no way to access its own EPT mappings**
- Each sandbox does **its own local scheduling and device management**

## 3. Interrupts and I/O: handed directly to the sandbox

- **Interrupts are directed at the sandbox kernel** (I/O APIC broadcast or IPI), and **demultiplexed early** in the driver — avoiding monitor intervention and complicated I/O virtualization
- **Some driver data structures are shared across sandboxes**; others are copied or synchronized

## 4. Inter-sandbox communication

- **Explicit message passing + a shared-memory channel**, carrying messages of **cache-line size**
- A service in one sandbox can access a service in another sandbox
- **IPI is used for inter-sandbox communication**; the APIC mechanism **is also used to reroute interrupts for remote fault recovery**

## 5. The fault path (the first clue for locating the monitor)

- When a fault is detected it produces an **EPT violation → a control transfer (VM-exit) to the corresponding monitor**
- **If some fault does not trigger a VM-exit automatically, the fault handler can force it** (for example with an instruction that necessarily traps)
- Fault-detection code in the sandbox kernel's **read-only segment** is **assumed safe**
- **A preemption timeout can periodically force a trap into the monitor** — so **the detection logic lives inside the monitor**, isolated from a tampered sandbox

## 6. Recovery: local and remote, both online

- **Local recovery**: the monitor frees the failed component's memory, **may reinitialize the whole sandbox**, or replaces the component with an **alternate implementation** (functional / implementation diversity), and **activates the alternate implementation by adjusting that sandbox's EPT mappings**
- **Remote recovery**: the local monitor picks a target sandbox (random, round-robin, or by load) and **notifies it by IPI**; the remote monitor performs the recovery and **takes state from shared memory by message passing**
- Recovery **completes online, without rebooting the whole machine**; unaffected sandboxes keep running normally

## 7. In practice: which span of this image is the monitor

A few usable criteria (in order of reliability):

1. **Who holds and modifies the EPT mappings / shadow page tables** — this is a capability unique to the monitor (sandbox code cannot access its own EPT mappings)
2. **The fault entry**: the target of the VM-exit, and the path that "forces a trap"
3. **The preemption-timeout timer logic**: it is deliberately placed inside the monitor, isolated from a tampered sandbox
4. **Bootstrap / channel-setup code**: it appears only at startup and when a channel is built

Conversely, **a large amount of device-driver and local-scheduling logic belongs to the sandbox kernel, not the monitor**.

## 8. Time and migration

- **There is no global clock**: each sandbox has its own physical clock; event timing is managed by a **per-core local timer** and **is not guaranteed to be synchronized**
- With neither a global scheduler nor a global clock → **timing analysis of cross-sandbox migration and communication must count clock skew** (related research specifically derives communication bounds that include clock skew)
- A timestamp across sandboxes **cannot be compared on a single timeline**

## Decision tree

```
Given an image of a multikernel sandbox system
├─ You cannot find a central hypervisor
│    └─ Normal: one monitor per sandbox
├─ Very few VM-exits
│    └─ Normal: the sandbox schedules itself and manages I/O; interrupts are delivered directly
├─ You need to locate the monitor
│    ├─ Who holds / modifies the EPT and the shadow page tables
│    ├─ The VM-exit target and the "force a trap" path
│    ├─ The preemption-timeout timer logic
│    └─ Bootstrap / channel-setup code
├─ Faults and recovery
│    ├─ EPT violation → VM-exit to the corresponding monitor
│    ├─ Local recovery can reinitialize the whole sandbox or swap the implementation (activated by changing the EPT)
│    └─ Remote recovery uses IPI + shared memory to pass state, entirely online
├─ Cross-sandbox communication
│    └─ Explicit messages + a shared-memory channel (cache-line-size messages) + IPI
└─ Timelines do not line up
     └─ No global clock: sandbox clocks are not guaranteed synchronized; do not assert on a single timeline
```

## Tools and verification

- Resources: the mapping of a sandbox domain onto CPU / memory / devices
- Monitor: EPT / shadow page tables, the fault entry, the preemption timeout, bootstrap and channel-setup code
- Communication: the message flow of the shared-memory channel, and IPI
- Time: each sandbox's local clock and the skew
- Verification: you can state together "whether this code belongs to the monitor or the sandbox kernel + which path this fault takes to the monitor + whose clock is the timing baseline of this cross-domain data"

## Pitfalls on this platform (summary)

- **Treating "no central hypervisor" as something missing from the system**: one monitor per sandbox is the design
- **Treating "very few VM-exits" as no virtualization isolation**: executing instructions directly on the hardware is the design
- **Assuming the monitor participates in every I/O**: it intervenes only at bootstrap, faults, shadow page tables, and channel setup
- **Treating device drivers as part of the monitor**: drivers and local scheduling belong to the sandbox kernel
- **Assuming the EPT mappings can be changed**: sandbox code cannot access its own EPT mappings
- **Comparing timestamps from different sandboxes on a single timeline**: there is no global clock
- **Assuming recovery always reboots the whole machine**: both local and remote recovery happen online
- **Treating "replace a component with an alternate implementation" as an anomaly**: that is a recovery method inside the design
- **Assuming one monitor per core**: a monitor can be built for a cluster of cores

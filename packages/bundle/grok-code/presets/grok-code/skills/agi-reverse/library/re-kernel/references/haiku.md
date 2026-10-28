# Haiku: device_node tree / kernel object model / KDL / the BeOS compatibility boundary

<CORE RULE>
Haiku has **two things that are easy to misread**, and **the entry for reversing a driver is completely different from the entry for reversing a system component**:

```
driver side: device_node tree + on-demand exploration + two layers, driver module / device module
system side: the kernel object model of team / thread / area / port / semaphore + user-mode services
```

**If the target is not a driver**, do not keep looking in the Device Manager — move to the kernel object model and the user-mode service layer.
</CORE RULE>

## 1. Driver side: the device_node tree and on-demand discovery

- The device manager is built around a **device_node**: each driver publishes one or more nodes, forming a tree that represents the hardware dynamically
- A device_node = **module + attributes + resources** + parent / child pointers; **the module is the only required part**
- At boot there is only the root node; the main buses register; **a smart bus creates a child node for every device it discovers**
- **On-demand exploration**: when a function is needed, the system scans the device filesystem, translates a device path into a device node by built-in rules (nodes on a smart bus carry PCI-style type information), and **queries only the matching module directory**

```
the driver was not there at boot, and appeared later when some device was accessed
  → it may only be on-demand exploration
```

- There is an on-demand flag meaning "search this only when the system asks"

## 2. Driver side: two module layers (driver module / device module)

A **driver module** (the name must end in `driver_v1`) implements: `supports_device`, `register_device`, `init_driver` / `uninit_driver`, `register_child_devices`, `rescan_child_devices`, `device_removed`, `suspend` / `resume` (**the last two are never called**)

- `register_device` registers the node and may **claim I/O resources** (a port or a memory range) — **the same resource can be claimed by only one node**

A **device module** (the name must end in `device_v1`, published to `/dev` through a publish-style call) exports: `init_device` / `uninit_device` / `device_removed`, `open` / `close` / `free` / `read` / `write` / `io` / `control` / `select` / `deselect`

**Not finding `read` / `write` in the driver module is normal** — that is the device module's interface.

- Node attributes include a display name, a unique id, **fixed child nodes**, vendor / device / type / subtype / interface, and flags
- **Fixed child nodes and dynamic child nodes cannot be mixed**, and their registration timing differs (fixed comes first)
- Newer versions add a "path / driver name" attribute to a node, used to show which driver serves a device and which `/dev` path it uses

## 3. System side: the kernel object model

When reversing a **non-driver** target, the entry is here:

| Object | Notes |
|---|---|
| **team** | the process equivalent: address space and resource container |
| **thread** | the unit of execution, belonging to a team |
| **area** | a memory region (shareable / mappable); the answer to "where this memory came from" |
| **port** | a **kernel message queue** — the basic means of communication between threads and between teams |
| **semaphore** | a synchronization primitive |

- **Several semaphore flags change the behavior**: interruptible (it can be interrupted by a termination signal even if the caller did not ask), **release every waiter**, **decrement only when there is a waiter** — the last two are exactly what condition-variable semantics need
- **The debug API corresponds to these objects one to one**: on the debugger side there are model classes for area / semaphore / image / team / thread / syscall information

**Reversing meaning**: "where this memory is, who is waiting for whom, who sends a message to whom" is answered by area / port / semaphore, not by the driver framework.

## 4. KDL and the kernel debug interface

**KDL** is an interactive command debugger built into the kernel. Ways in include a kernel panic, an explicit debugger call, an **emergency key combination**, and a hardware exception (page fault, protection violation).

Common commands: help, **stack backtrace**, continue, **thread list**, **switch CPU**, dump the system log, **examine memory**, reboot.

- **The command system is extensible**: each kernel subsystem can register its own commands
- Related output mechanisms each have a context they fit (printing used in the kernel-debugger context differs from ordinary kernel printing)
- **Debug-API details matter for analysis**:
  - A message sent to the debugger **starts with a header structure containing thread and team ids**; a **debug-endpoint port** field was added later, so a synchronous debug message can carry the debug channel
  - There is a set of **team debug flags**: team-create events, thread events, **image events**, stop new threads, and **trace before the syscall**
  - **The syscall-argument buffer was enlarged on 64-bit platforms** — before that, tracing risked kernel memory corruption; the debugger side distinguishes by target architecture accordingly

**Note**: **this debug interface is "conceptually similar to BeOS, but incompatible in both source and binary"** — applying BeOS-era debugger-interface assumptions fails outright.

## 5. The BeOS compatibility boundary (do not treat it as "just BeOS")

- The goal is **broad binary and source compatibility with BeOS R5 (x86), but not the other way around**; in some cases **source compatibility is deliberately broken to keep binary compatibility**
- Known differences, for example: header paths changed from `be` to `os`; some header names differ; private fields of classes were renamed; some undocumented APIs were not implemented; **the private device-map API was replaced by the disk-device API**
- **The debug interface is incompatible**; **the filesystem API also changed** (a BeOS-era filesystem driver cannot be used)
- Compatibility support for still earlier versions has been dropped
- **A change inside the kernel can also break compatibility explicitly** — for example, one change that turned a spinlock into a structure to measure lock contention was explicitly marked as breaking binary compatibility

## 6. The user-mode service boundary

Not every "Haiku component" is in the kernel: a graphics server, an application registrar, and similar are **user-mode services**, with their own protocol and lifetime. When reversing that kind of target:

```
do not look for a kernel driver interface
look at the user-mode service's communication endpoint and protocol
```

## Decision tree

```
Got a Haiku target
├─ decide first: driver / kernel subsystem / user-mode service
│    ├─ driver → device_node tree + two module layers
│    ├─ kernel subsystem → team / thread / area / port / semaphore + KDL
│    └─ user-mode service → service endpoint and protocol (not in the kernel)
├─ the driver "does not exist"
│    ├─ on-demand discovery: it is searched / loaded only when requested
│    └─ check bus-type rules and the on-demand flag
├─ read / write cannot be found in the driver module
│    └─ that is the device module (device_v1) interface
├─ an anomaly about memory / synchronization / messages
│    └─ it lands on area / semaphore (note the extended flag bits) / port
├─ live debugging
│    ├─ KDL can show a stack backtrace, threads, memory, the system log, and switch CPU
│    └─ the debug interface is incompatible with BeOS; do not apply the old interface
└─ a compatibility judgment
     ├─ R5 binary / source compatibility is one-way
     └─ the debug interface and the filesystem API are among the incompatible parts
```

## Tools and verification

- Driver: the device_node tree (module / attributes / resources), the two module layers' interface sets and naming constraints, uniqueness of resource claims
- System: ownership and relationships of team / thread / area / port / semaphore; semaphore flag bits
- Debug: KDL commands and the debug-API message structure (header fields, team debug flags, syscall tracing)
- Compatibility: whether the target is from the BeOS era (the debug interface / filesystem API will fail outright)
- Verification: be able to state together "whether this target is a driver or a system component + which layer it is on and who loads it + which object model its objects belong to"

## Pitfalls on this platform

- **Treating on-demand discovery as a missing driver**: initially only a minimal set is explored
- **Looking for `read` / `write` in the driver module**: that is the device module's interface
- **Ignoring the `driver_v1` / `device_v1` naming constraint**
- **Expecting `suspend` / `resume` to be called**: the current implementation does not call them
- **Mixing fixed child nodes and dynamic child nodes**
- **Still digging into the Device Manager when the target is not a driver**: the entry should be the kernel object model or a user-mode service
- **Ignoring a semaphore's extended flags**: interruptible, release all, and decrement only while waiting change the behavior
- **Applying BeOS debug-interface or filesystem-API assumptions**: neither is compatible
- **Assuming compatibility is two-way**: it only guarantees "an old program can run", not that a new interface falls back
- **Ignoring the debug-API buffer-structure change on 64-bit**: parsing with the old layout is wrong

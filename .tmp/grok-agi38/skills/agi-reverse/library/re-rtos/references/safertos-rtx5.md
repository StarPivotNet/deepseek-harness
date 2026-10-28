# Isolation features of certified RTOS: SAFERTOS ESM / CMSIS-RTX5 safety features

<CORE RULE>
On top of "functional kernel + certification", this family of RTOS adds **access-control and diagnostic features**, which produce two classes of misread:

```
The same VA: Task A can access it, Task B cannot
  → it may only be per-task region / protection-domain policy

Some API call fails / some thread does not run
  → the caller may simply not have a high enough safety class
```

**Explain it at the "who may access what" layer first, then suspect object corruption or a logic error.**
</CORE RULE>

## 1. SAFERTOS + Enhanced Security Module (ESM)

Base SAFERTOS spatial isolation targets **unintentional memory access** (corruption / programming error); **ESM hardens it against "deliberate" unauthorized access**.

| Mechanism | Role |
|---|---|
| **Access Control Policy (ACP)** | **Limits how many APIs each task may call** (for example, forbidding a task from changing its own privilege, changing access rights, or creating new resources); the more restricted the task, the smaller the attack surface after compromise |
| **Object Access Control Policy (OACP)** | **Limits which RTOS objects each task may access** (queues, semaphores, event groups, and so on), pinning the task to the objects assigned to it at initialization |
| **Indirect object ID** | Replaces the traditional handle (**which is essentially a C pointer**) with an **Object ID resolved through a cross-reference table**, so a task cannot derive the memory location of the object / TCB from the handle |
| **Per-task MPU/MMU regions** | 3 or 5 configurable regions per task (varies with the processor variant); **reprogrammed on every context switch**; by default an unprivileged task can access only its own stack |

- Region requirements: **size must be a multiple of 32 bytes, and the base must be 32-byte aligned**
- A global region visible to every task can be defined; **another task's stack must never be assigned to a task**
- Regions are configured at task creation (readable / writable / executable, user or privileged) and **can be reconfigured at runtime**
- ESM also includes: data obfuscation, a secure user / kernel space separation layer, task-context data isolation (context lives in the TCB rather than on the stack), and penetration-detection monitoring

**RE criterion**:

```
The handle is not a memory pointer (indirect object ID)
  → do not treat the handle as a TCB / object address, and do not expect to derive a structure layout from it
```

## 2. CMSIS-RTX5 safety features

Under switches such as `OS_SAFETY_FEATURES`:

| Feature | Meaning |
|---|---|
| **Safety Classes** | A thread of a lower safety class **cannot modify** a higher-class thread; query / suspend / resume interfaces are provided for thread classes. **Motivation**: RTOS objects are accessed through system calls that "take a numeric ID and run in handler mode", so **MPU protection alone can be bypassed by "calling the API with some other object's ID"** — safety classes add access control on top of object access |
| **MPU Protected Zones** | Spatial isolation: a zone is a set of memory regions / peripherals with access rights, assigned to one or more threads; **the zone ID is the row number of the MPU table**; on a context switch the kernel compares zone IDs and calls a callback (user-implemented, usually loading that row into the MPU); **a memory violation raises a MemManage fault**. Note: **interrupt handlers bypass MPU protection**, so they must be verified at the highest integrity level |
| **Thread Watchdog** | Temporal isolation: a safety-class thread declares the expected period / response time and "kicks the dog"; on a miss a supervisor thread escalates (restart the thread / restart the application / controlled shutdown / hardware reset) |
| **Object pointer checks** | Check an object pointer's **alignment and memory region** |
| **SVC function-pointer checks** | Check alignment and memory region of an SVC function pointer; **the linker must carve out a dedicated execution region** for the SVC veneer input section |

**ISR FIFO queue (deferred processing)**:

- **Calling some RTX APIs from an ISR does not complete immediately** — the request enters the **ISR FIFO queue** first and is processed by the scheduler after the ISR ends
- So:

```
osXxx() is called from an IRQ
  → the object's actual state changes only after the IRQ exits
  → completely normal
```

- **A queue that is too small produces an ISR queue overflow error** (a dedicated error code), **and the system state is already inconsistent at that point**; the fix is to **increase the size of the object that caused the overflow**, not to suspect the queue object is corrupt
- There is also an "invalid SVC function" error code (a function was placed where an object ID belongs)

## 3. The permission model and the meaning of "denied"

- A SAFERTOS task model includes: its own stack, **permitted MPU/MMU regions**, **privilege state**, and the RTOS objects it may access; **the task's memory regions are reprogrammed on a context switch**
- So three observations should be explained at the permission layer first:

| Observation | Prefer this explanation |
|---|---|
| The same address is readable by Task A and faults for Task B | **Per-task region configuration**, not memory corruption |
| An ordinary task cannot access some address, but **an ISR can** | User-task and privileged kernel / ISR contexts simply have different rights |
| A privilege transition appears next to an API call | A normal RTOS API gateway; **do not call it a ROP / trap anomaly** |

**Where "denied" comes from under ESM**:

- Task A succeeds with some handle and Task B is denied with the same handle → it may be an **object-access-policy** denial, **not a corrupt handle**
- The handle does not look like a pointer at all → ESM replaces a handle that points directly at a control block with an **indirect / obfuscated object ID**; recover the path **ID → table lookup → object**, rather than forcing `handle = kernel pointer`
- **A legal API returns denied** → it may also be the **access-control policy**: the current task simply has no right to call that API, rather than a broken API implementation

## Decision tree

```
Given a certified-RTOS target such as SAFERTOS / RTX5
├─ Access rights for the same address disagree
│    ├─ Check per-task region configuration (SAFERTOS) or MPU zone membership (RTX5)
│    └─ Regions may have been reconfigured at runtime
├─ A handle does not look like a pointer / points somewhere strange
│    └─ SAFERTOS ESM uses an indirect object ID + a cross-reference table
├─ Some API call is denied
│    ├─ Check the caller's access-control policy (may it call this API) and object-access policy (may it use this object)
│    └─ Under RTX5, check the calling thread's safety class
├─ An API called from an ISR did not take effect immediately
│    ├─ The request entered the ISR FIFO and is processed after the ISR exits
│    └─ A queue-overflow error → increase the object size, and the system is already inconsistent
└─ A memory-management fault appears
     ├─ RTX5: MPU zone violation
     └─ Note that interrupt handlers bypass MPU protection
```

## Tools and verification

- Access control: ACP/OACP configuration and runtime check points (SAFERTOS); safety class and object attributes (RTX5)
- Space: per-task region / zone tables, region alignment and size constraints, runtime reconfiguration calls
- Deferred processing: ISR FIFO queue capacity and the overflow error code
- Verification: you can state together "which policy constrains this access + what the region / class currently is + whether the failure is a policy denial or something actually broken"

## Pitfalls on this platform (summary)

- **Treating an access failure caused by a per-task region as memory corruption**: the permission difference may be entirely legal
- **Assuming regions stay fixed for the task's lifetime**: they can be reconfigured at runtime
- **Treating a SAFERTOS handle as a memory pointer**: under ESM it is an indirect object ID resolved through a cross-reference table
- **Forgetting the region's size / alignment constraint**: it must be a multiple of 32 bytes and the base must be 32-byte aligned
- **Assuming MPU protection covers interrupt handlers**: interrupts bypass the protection and must be verified separately
- **Looking for the unauthorized-access defense only at the MPU layer**: RTX5 explicitly says MPU alone can be bypassed by "calling the API with some other object's ID"; safety classes are required
- **Treating "an API called from an ISR did not take effect immediately" as a bug**: the request enters the ISR FIFO and is processed after exit
- **Treating an ISR queue overflow as a corrupt queue object**: it is insufficient capacity, and the system state is already inconsistent
- **Ignoring the linker-layout requirement of SVC function-pointer checks**: a dedicated execution region is needed for the veneers

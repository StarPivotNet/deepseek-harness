# eCos: ISR / DSR / thread, the CDL configuration system, HAL, and startup

<CORE RULE>
eCos has two equally important tracks, and **knowing only one of them will mislead you**:

```
Runtime: three layers, ISR → DSR → thread (the interrupt model)
Build time: the CDL configuration system decides what is compiled in, where vectors live, and what runs first
```

**The same sources produce very different images under different configurations** — so the order is:

```
Confirm the configuration (CDL) first, then talk about the code
```
</CORE RULE>

## 1. How ISR and DSR divide the work

- If the ISR return carries the "need to call the DSR" bit, the system calls the associated **DSR (Deferred Service Routine)**
- **If the scheduler is not locked, the DSR runs immediately**; **if the interrupted thread is inside a kernel call that locked the scheduler, the DSR is deferred until unlock**
- That deferral is exactly why a DSR can safely make certain kernel calls — **for example, post a semaphore or signal a condition variable**

## 2. Sync level is a property of the API

| Level | Who may call |
|---|---|
| **Thread** | Thread code only |
| **DSR** | **DSR or thread** code |
| **ISR** | **ISR, DSR, or thread** code |

**Which level the call site sits on decides which APIs are legal.**

## 3. Three synchronization mechanisms

| Mechanism | Role | Who may use it |
|---|---|---|
| **Sync with ISR** (disable interrupts + spinlock under SMP) | Stop ISRs from running inside the critical section | Must be **short** and used sparingly |
| **Sync with DSR** | Stop DSRs from running inside the critical section (inside the kernel this is equivalent to taking the scheduler lock) | **DSR and thread may use it; ISR must not** |
| **Sync with thread** (mutex, condition variable) | Thread-level block and wake | **Only a thread may lock a mutex or wait on a condition variable; a DSR may signal a condition variable** |

**Protect data by "who touches it"**: data accessed from an ISR must be protected with an ISR lock / spinlock at every level (**including inside the ISR**); data shared by DSR and thread uses a DSR lock; data touched only by threads uses a mutex.

## 4. Three typical driver models

1. **All handling stays in the ISR** (the DSR only signals a condition variable to wake a thread)
2. **Handling is deferred to the DSR** (the DSR optionally signals a condition variable and unmasks the interrupt)
3. **Handling is deferred to a thread** (the DSR only signals; the thread then has the full kernel facilities)

## 5. CDL: the configuration system decides everything

Configuration is driven by **CDL definitions**; options decide "what gets compiled in". Categories with reverse-engineering value:

- **Communication-channel selection** (channel count, debug channel, console channel and its baud rate, default console channel)
- **When a ROM monitor is in use these channel options usually have no effect** — the monitor picks the channel; the application can declare via a config option that **it takes over communications itself**
- **Whether a debug / GDB stub is included** directly affects image contents and where exceptions go
- **Build target** (ROM / ROMRAM / RAM, and so on) decides whether the image must relocate at startup

**Reverse-engineering meaning**: for an eCos image, "what is inside" is a product of the configuration, not a natural result of the sources. **Match config options to what was compiled in before you interpret the code.**

## 6. HAL: vector table and VSR

- **Where the vector table sits is entirely a function of the memory map**: decided by the memory-layout tool and recorded in the layout description file
- Startup **initializes the vector table**
- Most synchronous-exception vector entries **point at a default exception vector**: it saves CPU state and calls the exception handler, which, depending on configuration, **routes to the debug stub or routes to eCos**
- **An application loaded by a ROM monitor has vector entries that point at the monitor's own exception vectors** — so exceptions enter the monitor (for example a debugger), **unless the application explicitly replaces that entry**
- Exception-vector offsets are defined by numbers in the HAL headers

## 7. Virtual vectors: the service table a ROM monitor gives a RAM application

- At a **static address** there is a table (dozens of vectors) pointing at service functions or data, so a ROM configuration (such as RedBoot) can **provide services to a separately linked RAM application**
- Services include: communication channels (console / debug), microsecond delay, reset, cache flush, **debug / console channel switch**, **debug system calls (thread information)**, flash configuration access
- Initialized by the ROM monitor, or by policy from a standalone / RAM configuration; **a fixed number of bytes is reserved whether or not they are used**
- **The cost is an indirection layer** (size / performance overhead, plus one more failure point); the benefit is that **an application can be debugged without containing a debug stub**

## 8. Startup order (RedBoot / a typical ROM configuration)

```
reset entry
  → platform setup macro: disable interrupts and caches, initialize the memory controller and clocks, set up and enable the MMU
    (a ROMRAM case also relocates the image)
  → HAL startup: place the vector instruction at slot 0, copy .data, set the stack, clear .bss
    → hardware initialization
    → (if a debug stub is included) initialize the debug stub
    → interrupt (ctrl-C class) initialization
    → [call constructors]
  → enter cyg_start
```

**Constructors run after hardware / stub / interrupt initialization and before the main start path.**

## 9. A real pitfall: constructors vs memory layout

**If the region that holds the vector table overlaps the constructor region, initialization will smash the constructors** — there is a known case where "the expected constructors lived at some address and were overwritten when the vector table was initialized".

**So**: the vector-table location must follow the target memory map, **and if it must be initialized it cannot live in flash**.

## 10. Debug and the GDB stub

- **The debug stub is initialized during HAL startup**; the exception handler **enters GDB when a stub is present**
- A ROM monitor usually includes GDB protocol support, **which can be turned off to save code and memory**
- Virtual vectors let "an application without a stub" still be debugged; but **some older ROM monitors fail on asynchronous debug interrupts** unless the application is also configured with debug support
- Related config options control "whether to build a monitor with GDB" and "whether to include a stub"

## 11. Platform differences and configurability

- eCos covers HALs for many architectures; **HALs differ across architectures in the vector table, startup sequence, and cache and MMU handling**
- The scheduler, timers, and synchronization primitives are all configuration-dependent; **"what this eCos build's thread model looks like" is answered by the configuration**
- Memory-pool and heap configuration are likewise build-time choices

## Decision tree

```
Given an eCos target
├─ Confirm the configuration (CDL) first
│    ├─ Build target (ROM/ROMRAM/RAM) → whether it relocates at startup
│    ├─ Whether a debug stub is included → where exceptions go
│    └─ Channel / console / scheduler options → what was compiled in
├─ You see a very short interrupt handler
│    └─ The real work may be in the DSR (or in a third thread)
├─ You see a function that runs repeatedly with no thread entry
│    └─ It may be a DSR
├─ Decide whether a kernel call is legal
│    └─ Check its sync level (Thread / DSR / ISR)
├─ Exception destination does not match expectation
│    ├─ Is a debug stub included?
│    ├─ Does the vector entry point at eCos or at the ROM monitor?
│    └─ Did the application replace the vector entry?
├─ Constructors "did not run"
│    └─ Check whether the vector-table region overlaps the constructor region (initialization would smash them)
└─ You cannot find some feature
     └─ It may simply not have been compiled in
```

## Tools and verification

- Configuration: CDL options and what was compiled in, build target, whether a debug stub is included
- Layering: ISR return value (whether it schedules a DSR), DSR registration and call sites, sync level of each call
- HAL: vector-table location (layout file), where vector entries point, exception-handler routing
- Startup: reset entry → platform setup → HAL startup → constructors → main start
- Verification: you can state together "which configuration built this image + which layers interrupt handling is spread across + where exceptions go"

## Pitfalls on this platform (summary)

- **Treating the ISR as the complete interrupt handler**: the work may be in the DSR, or even in a third thread
- **Treating a DSR as an ordinary thread callback**: it has a sync level and scheduling constraints, and a scheduler lock defers it
- **Applying DSR-level sync assumptions inside an ISR**: an ISR is not allowed to use a DSR lock
- **Assuming a DSR can wait the way a thread can**: it can signal a condition variable, not wait
- **Inferring timing from "the moment the interrupt fired"**: when a DSR runs depends on the scheduler lock
- **Interpreting code without looking at the configuration**: CDL decides what is compiled in, channels, the debug stub, and the build target
- **Treating exception destination as fixed**: it depends on whether a stub is included, where the vector entry points, and whether the application replaced it
- **Ignoring overlap between the vector table and the constructor region**: constructors get overwritten by initialization
- **Assuming exceptions from an application loaded by a ROM monitor enter eCos**: by default they enter the monitor
- **Treating virtual vectors as pure overhead**: they let a stub-less application be debugged; that is an intentional tradeoff

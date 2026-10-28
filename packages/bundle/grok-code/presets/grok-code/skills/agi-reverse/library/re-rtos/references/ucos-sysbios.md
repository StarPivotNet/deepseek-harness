# µC/OS and SYS/BIOS: interrupt enter/exit and layered scheduling

<CORE RULE>
Both kernels make "interrupts participate in scheduling" an **explicit protocol**, so:

```
A context switch suddenly happens at the end of an ISR
  → reasonable behavior, not an anomaly

A task is already ready, but it waits until the interrupt exits before it runs
  → that is not scheduling latency
```

**When you judge when a schedule happens, you must count the "interrupt enter/exit" span as part of the control flow.**
</CORE RULE>

## 1. Micrium µC/OS: an ISR must notify the kernel

Standard ISR shape:

```
save registers
  → OSIntEnter()          (or OSIntNestingCtr++ directly)
  → …handle…
  → OSIntExit()
restore registers → return from interrupt
```

- `OSIntEnter()` / `OSIntExit()` **must be paired**, and **`OSIntEnter()` must not be called from task-level code**
- `OSIntEnter()` increments the global **interrupt-nesting count**, which **guarantees no task scheduling while an ISR is running**
- Implementation detail: if the kernel is not running it returns immediately; it also returns if the nesting count has hit the limit (250)
- **Incrementing the count directly saves the function-call overhead**, but it requires "interrupts are already disabled at the increment" — **that is not true on every architecture**, and you have to confirm it yourself

**The decision sequence of `OSIntExit()`** (this is the key to recovering control flow):

```
kernel not running → return
disable interrupts → if the nesting count is 0 → enable interrupts and return (prevent count wrap)
decrement the nesting count → if it is still > 0 (a nested ISR remains) → enable interrupts and return
if the scheduler is still locked → enable interrupts and return
find the highest-priority ready task → same as the current task → enable interrupts and return
otherwise update the switch count and perform an "interrupt-level context switch"
```

- That is: **only when the last nested ISR exits** does it decide "whether to switch to a higher-priority task that the ISR made ready"
- On Cortex-M that switch usually **only triggers PendSV** (the lowest-priority exception); **the real switch is deferred until every ISR has finished**

**So**: `ready but not running` can often be explained as "still inside an ISR / the scheduler is locked / PendSV has not run yet".

## 2. TI SYS/BIOS: four thread levels + disabling Swi also disables Task scheduling

Thread hierarchy (priority high to low):

```
Hwi (hardware interrupt) > Swi (software interrupt) > Task > Idle
```

- **A Swi cannot block and always runs to completion**; a Task can block, and it is preempted by any higher-priority thread
- Both Swi and Task have priority levels (a larger number is a higher priority; 0 is lowest)

**The critical coupled effect**:

- **`Swi_disable()` also disables the Task scheduler** — equivalent to calling "disable Task" and "disable Swi" together
- Therefore: `Swi_post()` does not run immediately inside a critical section; even if `Semaphore_post()` makes a higher-priority task ready, **the current task is not preempted before `Swi_restore()`**
- `Swi_restore()` re-enables and enters the Task scheduler, **provided the Task scheduler was not already disabled**
- **Hard constraint**: while the Swi scheduler is disabled you **must never call a blocking API** (such as a semaphore wait / entering a gate mutex), or you "irrecoverably corrupt" the Task scheduler's internal state; behavior is "unpredictable and usually catastrophic"
- Disabling one layer **does not stop a higher layer from preempting** (`Swi_disable()` does not stop Hwi preemption)

**Stack model**:

- **Hwi and Swi share one system interrupt stack (the ISR stack)**, one per program; each Task has a private stack
- If the system has no Task, every thread shares one system stack; the default system stack size is 4096 bytes
- **Each additional nested Hwi/Swi priority level raises the stack requirement**; Swi stack demand is proportional to the number of Swi priorities in use

**So**:

```
A high-priority Task is ready but does not switch
  → first check whether the Swi scheduler is disabled (it also disables Task scheduling)
  → do not look for a deadlock first
```

## 3. Other frequent µC/OS misreads

**Scheduler lock and suspend are nestable**:

- `OSSchedLock()` is **nestable**: even after leaving an ISR, **there is no reschedule while the scheduler stays locked**; unlocks must be paired
- `OSTaskSuspend()` is likewise nestable — **for a high-priority task that stays not-ready for a long time, check the nesting level of both of these before talking about priority inversion**

**Semaphore vs mutex**:

- A resource several tasks may share at once → **semaphore**; **an exclusive resource → mutex** (the mutex implementation handles priority inversion)
- So when "a low-priority task affects a high-priority task", **first confirm the author did not use a semaphore as a mutex**

**A software-timer callback runs in the timer-task context** (this one is worth a lot):

- The callback **runs in the context of the OS's internal timer task** — **it is neither an interrupt nor the task that created / started the timer**
- **It uses the timer task's stack**, so that stack must be sized for the callback's needs
- **A callback must never block / wait** (a delay, any `OS???Pend()`) — because every callback runs **serially** inside the timer task, and blocking one callback stalls the whole timer subsystem
- So:

```
TimerCallback() → there is a blocking wait inside
  → a high-value bug signal (not "an occasional hitch")
```

**PendAbort: being woken ≠ having obtained the resource**:

- Aborting a wait (on a task's built-in message queue or an ordinary message queue) **aborts the wait and makes the task ready**, and is **not a normal delivery**
- **Only a task may call it (not from an ISR)**; a NULL pointer, or a pointer at the caller itself, is an invalid use
- The woken task returns **with a "wait was aborted" error code**

**So**: the task woke up, but there is no new message in the queue / semaphore — first see whether this is the abort-wait path. **"Woken" and "successfully obtained the resource" are two different things**.

## Decision tree

```
Given a µC/OS or SYS/BIOS target
├─ Schedule timing does not line up
│    ├─ µC/OS: check OSIntNestingCtr (still inside an ISR?), the scheduler lock, whether PendSV has run
│    ├─ SYS/BIOS: check whether the Swi scheduler is disabled (it also disables Task scheduling)
│    └─ Do not call it "scheduling latency / deadlock" first
├─ A kernel API is called from an ISR
│    ├─ µC/OS: are OSIntEnter/OSIntExit called as a pair
│    ├─ SYS/BIOS: was a blocking API misused (calling one while Swi is disabled corrupts scheduler state)
│    └─ Note that a SYS/BIOS Swi cannot block
├─ A stack-related fault
│    ├─ SYS/BIOS: Hwi and Swi share the ISR stack; nesting depth and the Swi priority count affect stack demand
│    └─ Default system stack is 4096 bytes; watch the configuration item
└─ You see the "increment the nesting count directly" form
     └─ Safe only on architectures where "interrupts are already disabled at the increment"; confirm per architecture
```

## Tools and verification

- Interrupt protocol: whether the ISR's enter/exit calls are paired; read and write sites of the nesting count
- Scheduling disable: scheduler lock, Swi/Task disable flags, and the restore points
- Stacks: the split between the system (ISR) stack and task stacks, nesting depth, and stack configuration
- Verification: you can state together "whether we are currently in ISR context + which layer's scheduling is disabled + when the switch actually happens"

## Pitfalls on this platform (summary)

- **Treating the switch at the end of an ISR as an anomaly**: that is the normal scheduling decision at interrupt exit
- **Ignoring the nesting count**: only the exit of the last nested ISR decides whether to switch
- **Assuming triggering PendSV equals having switched**: the real switch is after every ISR has finished
- **Letting task-level code call `OSIntEnter()` in µC/OS**: the protocol forbids it
- **Copying the "increment the count directly" optimization**: safe only on specific architectures
- **Forgetting `Swi_disable()` also disables Task scheduling**: this is the least intuitive point in SYS/BIOS
- **Calling a blocking API while the Swi scheduler is disabled**: it irrecoverably corrupts scheduler state
- **Estimating SYS/BIOS stack demand as "each thread has its own stack"**: Hwi and Swi share the ISR stack

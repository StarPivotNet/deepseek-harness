# FreeRTOS: ISR context / FromISR API / MPU-restricted tasks

<CORE RULE>
FreeRTOS looks small on the surface. **The biggest pitfall is not "simplicity"; it is context**:

```
xQueueSend()            vs  xQueueSendFromISR()
xTaskNotifyGive()       vs  vTaskNotifyGiveFromISR()
taskENTER_CRITICAL()    vs  taskENTER_CRITICAL_FROM_ISR()
```

**These are not aliases you may swap at will.** If you see a task-variant API inside an ISR, do not keep analyzing it as "normal business logic" — first decide **whether it is actually in ISR context**, and whether a symbol or wrapper was identified wrong.
</CORE RULE>

## 1. Why FromISR variants exist

Inside an ISR, **the scheduler is effectively frozen**: an ISR cannot block, and the kernel cannot switch tasks from inside the ISR. An ordinary API may block (for example, waiting for a free queue slot) or trigger a schedule internally — **both are forbidden in interrupt context**.

What `...FromISR()` variants share: **they do not block, they use a lighter critical section, and they hand the scheduling decision back to the application**.

## 2. `pxHigherPriorityTaskWoken` and `portYIELD_FROM_ISR`

- Take `xQueueSendFromISR(queue, item, pxHigherPriorityTaskWoken)`: if this send unblocks a task **and that task's priority is higher than the currently running task**, `*pxHigherPriorityTaskWoken` is set to `pdTRUE`, meaning **a context switch should be requested before leaving the interrupt**
- **Since V7.3.0 the parameter is optional (NULL is allowed)**. The tradeoff must be clear:
  - Pass NULL and then call `portYIELD_FROM_ISR(pdTRUE)` → **always force a yield** (possibly an unnecessary switch, even to a peer of the same priority in round-robin)
  - Pass NULL and do not yield → **a higher-priority ready task may wait until some later event before it is scheduled**
- Typical shape:

```c
BaseType_t xHigherPriorityTaskWoken = pdFALSE;
xQueueSendFromISR(xQueue, &item, &xHigherPriorityTaskWoken);
if (xHigherPriorityTaskWoken) { portYIELD_FROM_ISR(); }
```

- **`portYIELD_FROM_ISR()` does not switch at the call site**: on Cortex-M it usually **pends PendSV**, and the real switch happens after the interrupt exits (tail-chaining) — that matters for timing analysis

**So**: a CFG where "scheduling / yield code suddenly appears at the end of a function" **may just be an ISR normally requesting a switch to a higher-priority task**.

## 3. `configMAX_SYSCALL_INTERRUPT_PRIORITY`: an interrupt past this line must not touch any API

- This setting defines the **highest interrupt priority (lowest numeric value) that is allowed to call a FreeRTOS API**
- **An ISR that is numerically lower (more urgent) than this must not call any FreeRTOS API (including FromISR versions), and must not use `portYIELD_FROM_ISR`** — that class of ISR may only do pure hardware work or set a flag
- Cortex-M critical sections are implemented by writing **BASEPRI**: only interrupts at that priority and below are masked, so the most urgent interrupts still get through
- **Watch the numeric direction of priority**: on Cortex-M / STM32 a smaller number is a higher priority, **the opposite of task priority** — this one often causes a wrong call
- Typical failure: an ISR calls `xQueueSendFromISR` but **never set an NVIC priority** (default 0 = highest), which trips the port-layer priority-check assert (something like `vPortValidateInterruptPriority`)

## 4. FreeRTOS-MPU: restricted tasks and runtime region changes

A **restricted task** is created with `xTaskCreateRestricted(TaskParameters_t *, TaskHandle_t *)`. The argument is a statically configured structure: task function, name, stack depth, parameter, priority, **stack buffer**, and **`xRegions[portNUM_CONFIGURABLE_REGIONS]`** (3 on Cortex-M3).

- **OR `uxPriority` with `portPRIVILEGE_BIT`** → a privileged-mode task; otherwise the task runs in **user mode**
- The stack buffer must satisfy MPU constraints; compile-time alignment is common (for example `__attribute__((aligned(...)))`); passing NULL uses the port's aligned allocator
- **`xTaskCreateRestrictedStatic()`**: no dynamic allocation at all (static-allocation support must be on), and the application must also supply `StaticTask_t` storage — you can place that in the kernel's privileged data region
- **`MemoryRegion_t { pvBaseAddress, ulLengthInBytes, ulParameters }`**: **region size and alignment must be the same power of two** (a hard constraint)
- `ulParameters` may be (and may be OR-ed): read-write, privileged read-only, read-only, privileged read-write, cacheable / bufferable, **never-execute**, and similar flags
- **On every task switch the MPU is reprogrammed dynamically**, granting the incoming task read-write on its own stack
- **Regions can change at runtime**: `vTaskAllocateMPURegions(handle, regions)` (NULL handle means the current task), and the port function writes the hardware underneath

**So**:

```
Task A can access buffer X; task B faults on the same address
  → not necessarily memory corruption; it may be MPU policy

The same task could access it yesterday and cannot after some stage
  → MPU regions may have been reallocated at runtime
```

Also: a privileged task can access the whole memory map; a user-mode task can access all RAM / FLASH except what is "privileged-only". The port's privilege-drop entry (switch to user mode) **is one-way — there is no way back to privileged mode**.

## Decision tree

```
Given a FreeRTOS target
├─ You see an interrupt service function
│    ├─ Does it call the task variant or the FromISR variant?
│    ├─ Task variant → first confirm what is wrong (context classification / symbol or wrapper identification)
│    └─ pxHigherPriorityTaskWoken + portYIELD_FROM_ISR → the ISR is normally requesting a switch, not obfuscation
├─ An exception related to interrupt priority
│    ├─ Check whether this ISR's priority is above configMAX_SYSCALL_INTERRUPT_PRIORITY (more urgent)
│    ├─ More urgent → it must not call any FreeRTOS API
│    └─ Note that the numeric direction is the opposite of task priority
├─ Some address is "sometimes accessible, sometimes not"
│    ├─ Check whether it is an MPU-restricted task (xTaskCreateRestricted)
│    ├─ Check whether vTaskAllocateMPURegions was called at runtime
│    └─ Do not immediately call it heap / stack corruption
└─ Context classification
     └─ Separate task context from ISR context (can it block, can it trigger a schedule)
```

## Tools and verification

- Context: entries of ISR and task code, the port layer's enter / exit macros, which API variant the session uses
- Priority: settings related to `configMAX_SYSCALL_INTERRUPT_PRIORITY` and each interrupt's actual NVIC priority
- MPU: the task's `xRegions` configuration, runtime region-change calls, the port path that writes the hardware
- Verification: you can state together "context is task or ISR + whether the API variant matches + which MPU region set the address permission comes from"

## Pitfalls on this platform (summary)

- **Treating task-variant and FromISR-variant APIs as interchangeable**: blocking and scheduling semantics are completely different
- **Continuing the analysis with blocking semantics in interrupt context**: an ISR cannot block, and cannot trigger a schedule internally
- **Ignoring `pxHigherPriorityTaskWoken`**: missing the yield delays a higher-priority ready task
- **Assuming `portYIELD_FROM_ISR()` switches immediately**: it usually pends; the real switch is after the interrupt exits
- **Treating scheduling code at the end of an ISR as obfuscation**: that is a normal switch request
- **Forgetting that interrupt-priority numbers run opposite to task priority**: the "may this call an API" decision comes out backwards
- **Calling any API from an ISR above `configMAX_SYSCALL_INTERRUPT_PRIORITY`**: not even FromISR
- **Calling an MPU access failure memory corruption**: a restricted task's region constraints are decided by configuration
- **Assuming MPU regions stay fixed for the task's lifetime**: they can be reallocated at runtime
- **Ignoring "dropping to user mode cannot be undone"**: one-way behavior, not a lost permission

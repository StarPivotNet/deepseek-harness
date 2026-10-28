# AUTOSAR Classic: the RTE execution graph / implicit access / OS-Application protection

<CORE RULE>
In AUTOSAR Classic, **a large amount of the real control flow is configuration-driven + generated code**:

```
TimingEvent / DataReceivedEvent / OperationInvokedEvent / ...
        ↓
       RTE (generated glue code)
        ↓
   AUTOSAR Task or ISR2
        ↓
 RunnableEntity (the business function)
```

So:

```
void Runnable_10ms(void);   ← 0 cross-references
```

**You must never judge it dead code directly.** First find the `Rte_*` wrapper, the OS Task, `ActivateTask` / `SetEvent` / `WaitEvent` / Alarm / ScheduleTable, and the generated configuration.
</CORE RULE>

## 1. The execution graph: the RTE has no independent scheduling capability

- A RunnableEntity is activated by an **RTEEvent**; event types include timing, data received / receive error, data send complete / write complete, an operation invocation, an asynchronous service-call return, a mode switch (and its confirmation/error), external and internal triggers, an init event, an OS task-execution event, and others
- **The RTE does not schedule**: every RTE Event must be mapped to a concrete OS Task, and **when the OS schedules that Task the RTE calls the matching runnable in the configured order**; the mapping must be written into the ECU configuration description, as input to the RTE generator
- A RunnableEntity runs inside an **OS Task or ISR2**
- Distinguish two moments: **activation** (the event the RTEEvent points at occurs) and **start** (its C function is called inside an already-started task/ISR2)
- If a runnable is not referenced by any RTEEvent in the `startOnEvent` role, the RTE **never** activates it (but a runnable mapped to a BSW schedulable entity can still be activated by the BSW scheduler)

## 2. Implicit access: a consumer seeing an "old value" may be the design

- An **implicit read** generates `Rte_IRead_<port>_<data_element>`; an **implicit write** generates `Rte_IWrite_<port>_<data_element>`; an explicit read is `Rte_Read_<port>_<data_element>(DataType*)`
- Under implicit communication, **the RTE automatically reads the data before the runnable is called and writes it back after the runnable ends**; the runnable itself does not initiate the transfer; **a write counts as complete only when the runnable ends**
- The observable order: first copy the data element for the implicit read, and **only then** fire the runnable-call event; the runnable-termination event **precedes** the implicit write-back
- Implicit S/R communication **does not support RTE API trace events**

**So**:

```
Producer:  x = 10;  x = 20;
The consumer runnable sees x = 10 the whole time it runs
```

**This may fully match RTE semantics**, and it is not a cache/consistency bug.

**Analysis requirement**: distinguish `Rte_Read_*` / `Rte_IRead_*` / `Rte_Write_*` / `Rte_IWrite_*`, rather than only chasing the underlying RAM address. The communication form is fixed by configuration and **cannot be "changed away" in the code afterward**.

## 3. `E_OS_ACCESS` is not necessarily "the object is broken"

The AUTOSAR OS **partition representation is the OS-Application**, with ownership and a protection state:

- If an OS object identifier is passed to a system service (for example `ActivateTask`), and **the caller was not granted access to that object at configuration time** (such as `OsTaskAccessingApplication`), the service **returns `E_OS_ACCESS`**
- If the service call targets an object that **belongs to another OS-Application that is not in an accessible state**, it likewise returns `E_OS_ACCESS`
- **Trusted and non-trusted applications are treated the same**: deny by default, and cross-application access is possible only when configuration grants it explicitly
- Exception: check-class services (`CheckObjectAccess` and similar) do not need a grant — they can be used to pre-judge before a call
- The trust level affects only a few services (for example terminating an application: a task/interrupt of a trusted application may terminate any OS-Application)
- An access error may also fire a protection hook

**So the investigation order is**:

```
Which OS-Application does the object belong to? Application state? trusted / non-trusted?
Memory protection? The current call context?
        ↓
rather than first judging "the task ID was written wrong"
```

- Also: **a Category 1 ISR is not fully managed by the OS**, so ordinary OS protection cannot simply cover this context

## 4. Concurrency problems are mostly in the OS configuration, not in application logic

A large amount of mutual-exclusion handling is **generated** (RTE automatic protection, OS resources, BSW critical sections), not written by hand. When a concurrency anomaly appears, first check the OS configuration: **which Task the runnable maps to, the priority, and the ISR preemption relationship**, and only then look at application code.

## Decision tree

```
You have an AUTOSAR Classic target
├─ Some runnable has no caller
│    ├─ Find the Rte_* wrapper and the RTEEvent mapping
│    ├─ Find the OS Task it is mapped to (ActivateTask/SetEvent/Alarm/ScheduleTable)
│    └─ Do not mark it dead code
├─ A variable's value does not match the expectation
│    ├─ Distinguish explicit access (Rte_Read_/Rte_Write_) from implicit access (Rte_IRead_/Rte_IWrite_)
│    ├─ Implicit access snapshots/writes back at the runnable boundary → "seeing an old value" may be the semantics
│    └─ Do not first judge a cache-consistency or memory-corruption problem
├─ A service call returns E_OS_ACCESS
│    ├─ Check which OS-Application the object belongs to and that instance's state
│    ├─ Check the current call context (which task/ISR) and the trust level
│    └─ Do not first judge a bad argument
├─ A process/task does not run
│    ├─ Check the runnable-to-Task mapping and whether the Task is activated
│    └─ Check init/mode-related events
└─ A concurrency anomaly
     └─ First check the OS configuration (Task mapping, priority, preemption), then talk about application logic
```

## Tools and verification

- Execution graph: the ECU configuration description (the runnable → RTEEvent → OS Task mapping) and the generated RTE glue code
- Access semantics: call sites and port configuration of `Rte_Read_*` / `Rte_IRead_*` / `Rte_Write_*` / `Rte_IWrite_*`
- Protection: OS-Application ownership and access-right configuration, state-check services, protection hooks
- Verification: you can say at the same time "who activates the runnable and which Task it runs in + whether the data access is explicit or implicit + whether cross-application access is granted"

## Pitfalls of this platform (summary)

- **Treating a runnable with no caller as dead code**: it is activated by an RTEEvent through the RTE, and the mapping is in the configuration
- **Thinking the RTE schedules itself**: the RTE has no independent scheduling capability, and an event must be mapped to an OS Task
- **Confusing the two moments activation and start**
- **Treating an implicit-access "old value" as a cache/consistency bug**: implicit access snapshots and writes back at the runnable boundary
- **Chasing only the RAM address and not the Rte_I* family**: you cannot distinguish explicit/implicit semantics
- **Treating `E_OS_ACCESS` as a bad argument**: first check OS-Application ownership and the access-right configuration
- **Thinking a trusted application can freely access across applications**: deny by default, and the grant comes from configuration
- **Ignoring that a Category 1 ISR is not fully managed by the OS**: the ordinary protection assumption does not hold here
- **Looking for a concurrency root cause in application code**: first check the Task mapping, priority, and preemption configuration

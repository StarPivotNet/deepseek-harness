# AUTOSAR Adaptive: a manifest-driven lifecycle / service discovery / PHM / update

<CORE RULE>
Underneath it is usually indeed a POSIX OS, **but the application lifecycle, service discovery, update, and health monitoring are not decided by the ELF and the process tree**:

```
Executable
  ├─ Execution Manifest   → Modelled Process / startup arguments / priority / resource group / FG State mapping
  ├─ Service Instance Manifest → service deployment / SOME-IP or DDS binding / security and E2E / instance mapping
  └─ Machine Manifest     → network / service discovery / Machine State / Function Groups / PHM / platform configuration

State Management → Execution Management → start/stop Processes
ara::com → service discovery / IPC
PHM → supervision → State Management
UCM → software cluster install / update / rollback
```

So:

```
the binary is clearly installed, but the process does not exist at all
  → first check the current Machine State / Function Group State / Execution Manifest
  → do not first judge a crash or a loader failure
```

**By design, this process should not be running right now.**
</CORE RULE>

> Version note: the public version has advanced to R25-11, and most details in this section come from the fully public R24-11 specification; the core model still applies, and **a concrete item must be fingerprinted against the target version**.

## 1. A Modelled Process ≠ an OS process

- A **Process (Modelled Process)** in the metamodel is an ARXML model element: "a loaded instance of an executable executing on a Machine"
- The specification uses an unprefixed "process" for a **running process in the POSIX sense**, to distinguish the two
- At runtime: EM **creates one OS process for each modelled Process**; after that EM is related to it only for state management and deterministic execution
- Variants: **reporting** (reports execution state through ExecutionClient), **non-reporting** (usable for a binary not adapted to AP), **self-terminating** (exits itself or is terminated by EM with a signal)
- **`identity = Executable + Modelled Process instance + Function Group State`**, not an ELF hash

## 2. The same ELF can have several processes with different behavior

The specification explicitly allows **each startup instance of one Executable binary to be configured separately**, and **different Machine States / FG States may use different configuration sets**. So:

```
foo
├─ Process A  priority 20
├─ Process B  priority 40
└─ Process C  different args / resource group
```

can all be different Modelled Processes of the same executable. **Do not assume 1 executable = 1 process configuration.**

## 3. The lifecycle caller is not inside the target process itself

A process terminated "for no reason", with another batch of processes starting immediately after, can be the normal path:

```
external event → State Management → SetState(FunctionGroupState X)
        → Execution Management → terminate A/B → start C/D
```

- An FG State itself defines "**which Processes should be running now and which should not**"
- On a state switch EM **first terminates the processes that are running, then starts the processes active in the new state in execution-dependency order**, and only then confirms to SM
- The specification covers failure cases such as termination timeout, startup timeout, and restart attempts
- At startup EM is pulled up by the OS as one of the initial processes (**not necessarily the first process**), and itself moves MachineFG to **Startup**; after that it **no longer initiates** a state switch on its own — SM must request it

**Dynamic-analysis requirement**: besides the fork/exec/exit graph, you must also build a **state transition graph**.

## 4. Service discovery: an empty result and a repeated callback can both be normal

- **`FindService()` explicitly allows returning an empty set** — there is simply no matching service instance available right now
- **`StartFindService()` is itself continuous asynchronous availability monitoring**:

```
StartFindService() → callback([]) → the service appears → callback([service]) → the service disappears → callback([])
```

**The first callback is allowed to be empty.** So "service discovery returned zero" cannot immediately be judged a network fault / a damaged manifest / a provider crash; **you must observe the availability lifecycle**.

- The specification requires: **re-call the handler whenever the availability of a matching service instance changes**, and **the implementation is responsible for serializing the same handler** — so the same callback being called several times **is not a double-registration bug**

## 5. A handle can point at a remote instance

Having a service handle but finding no provider process locally is **completely normal**:

```
A Proxy handle exists + this machine has no provider executable
  → you cannot judge the service table forged
  → follow: Service Instance Manifest → network binding → instance mapping → the remote machine
```

## 6. `ara::com` ≠ necessarily SOME/IP

An Adaptive service can be deployed onto different communication technologies — the public model explicitly describes service-instance deployment for both **SOME/IP and DDS**.

```
ara::com API → binding → it may be DDS, not UDP/TCP SOME/IP
```

**So: when you cannot find SOME/IP traffic, check the Service Instance Manifest first**; an analyzer that hard-codes "ara::com → SOME/IP" produces a factual error immediately.

Corollary: when building a cross-ECU graph, recover the **logical service interface** and the **technical binding/deployment** separately — **the same interface with a different underlying protocol** can be normal.

## 7. PHM: no crash does not mean healthy

- PHM supervises at **process granularity** (unlike Classic's WdgM task-level + a hardware-watchdog reset)
- The basic unit is a **Supervised Entity (SE)**: it can map to a process **or part of a process**; the application reports progress through `ReportCheckpoint`
- **Three kinds of supervision**:

| Supervision | Criterion |
|---|---|
| **Alive** | Whether the number of checkpoints reported in a period is inside the expected range (too many and too few both count) |
| **Deadline** | Whether the execution time between the start and end checkpoints falls in the configured interval |
| **Logical** | Whether the checkpoint report order matches a predefined supervision graph (independent of time) |

- States: local state OK / FAILED / **EXPIRED (a terminal state; it cannot return to OK)**; the global state also contains STOPPED beyond the aggregation (after the tolerance period is exceeded)
- **A supervision mode is defined as `<machine state, function group state>`**, and is notified by state management
- **Recovery actions** (defined in the manifest): ask SM to switch FG state, ask EM to restart the process or enter an unrecoverable state, **ask the watchdog driver to reset**, report a diagnostic, or forward to a safety application for a complex response
- **PHM itself does not start or stop processes** — EM does that on its behalf
- PHM also supervises the liveness of the EM daemon; its failure escalates to a watchdog/machine reset (because ordinary recovery through EM/SM is no longer reliable)

**So**:

```
process wasn't segfaulted  ≠  process was healthy
the system rebooted but no reboot caller can be found  → check the PHM supervision state / the SM reaction / the watchdog path
```

## 8. UCM and Persistency: installed ≠ in effect

- UCM separates **transfer/install, verify, and activate**; before activation it checks Software Cluster dependencies, and when EM finds during Verify that an execution dependency is not satisfied it can cause a **rollback** through SM/UCM
- So "there is a new package on disk" **cannot** imply "the new version is in effect"; confirm separately: package received? installed? verified? **activated?** rollback?
- **Persistency update strategies** (per element/file):

| Strategy | Meaning |
|---|---|
| `keepExisting` | Keep the existing data and ignore the manifest initial value (user data) |
| `overwrite` | Replace with the manifest value (force a configuration sync) |
| `delete` | Delete the existing element (used for obsolete configuration) |

- Manifest constraints: `keepExisting`/`overwrite` require an initial value to exist; `delete` requires that it does not exist
- **Version handling**: manifest version > stored version → update; equal → no operation; **lower → rollback** (when a valid backup exists)
- **A deployment-time setting can override a design-time setting**: when reversing a production system, **the deployed artifact on the target takes priority over the default configuration in the design repository**

**So**: "new program + old data" after an update may be `keepExisting`, and "the data suddenly disappeared" may be `delete`. **Neither is an update failure.**

## Decision tree

```
The Process does not exist
├─ The current Function Group State?
├─ The current Machine State?
├─ The StartupConfiguration in the Execution Manifest?
└─ Has UCM activated it?

The Service cannot be found
├─ Can FindService legally return empty?
├─ StartFindService has not yet seen a provider (the availability lifecycle)?
├─ Is it a remote service instance?
├─ Is the binding SOME/IP or DDS?
└─ What does the Service Instance Manifest say?

The Process has no crash but restarts/resets
├─ Which PHM class: Alive / Deadline / Logical?
├─ SM's state transition?
├─ The PHM → watchdog reset path?
└─ Is EM itself supervised?

Update behavior is strange
├─ Is the package installed or activated?
├─ Did dependency Verify pass?
├─ Was there a rollback?
└─ Is the Persistency strategy keep / overwrite / delete?
```

## Tools and verification

- The three manifests: Execution Manifest (Modelled Process, startup arguments, resource group, FG State mapping), Service Instance Manifest (deployment, binding, E2E/security, instance mapping), Machine Manifest (network, service discovery, Machine State, FG, PHM)
- State: the current Machine State and Function Group State; supervision mode = `<machine state, function group state>`
- Health: the SE's supervision type and local/global state, and the recovery-action definition
- Update: UCM's phase state, the Persistency strategy, and the version-comparison result
- Verification: you can say at the same time "what the current state is + which processes/services the manifest says should be active + whether that behavior comes from the manifest or the implementation"

## Pitfalls of this platform (summary)

- **Treating "the bin exists but the process does not" as a crash or a load failure**: look at the Function Group/Machine State first
- **Comparing a Modelled Process and an OS process 1:1**: the specification distinguishes them explicitly
- **Assuming 1 executable has only 1 process configuration**: different configurations can be given per state
- **Treating the lifecycle as the target process's own responsibility**: the real caller is SM→EM
- **Using a fork/exec/exit graph instead of a state-transition graph**
- **Treating "service discovery returned empty" as a fault**: an empty result is a legal value, and the first callback may be empty
- **Treating a repeated callback as a double registration**: the specification requires a callback when availability changes, and the implementation serializes it
- **Judging it forged because the provider cannot be found locally**: a handle can point at a remote instance
- **Hard-coding ara::com = SOME/IP**: it may also be DDS
- **Treating no crash as healthy**: Logical/Alive/Deadline supervision and a crash are two different things
- **Looking only for a reboot caller to explain a reset**: the watchdog path is triggered by PHM
- **Treating "the package is installed" as "the new version is in effect"**: install/verify/activate are separate, and there may also be a rollback
- **Treating data kept or disappearing after an update as an update failure**: keepExisting / delete are both strategies
- **Using design-time ARXML as the basis for production behavior**: a deployment-time setting takes priority

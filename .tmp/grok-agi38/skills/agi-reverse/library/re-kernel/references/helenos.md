# HelenOS: fibril / user-mode DDF drivers / devman

<CORE RULE>
HelenOS is a multiserver microkernel, and **a driver is a user-mode server task**. Two layers are easy to misread:

```
a thread preemptively scheduled by the kernel
   └─ a fibril cooperatively scheduled in user mode (the kernel does not know it exists)
```

So:

```
a lot of "thread switches" happen inside one OS thread
  → it may only be the user-mode fibril scheduler switching; from the kernel's point of view nothing happened
```

**Looking, from the thread's point of view, for "why this thread was preempted" finds nothing.**
</CORE RULE>

## 1. fibril: an execution entity the kernel does not know about

- Each task (process) contains several **threads preemptively scheduled by the kernel**; each thread can contain several **fibrils cooperatively scheduled by a user-mode library**
- **The kernel does not know fibrils exist** — scheduling, switching, and synchronization all happen in user mode
- The driver framework uses fibrils heavily: `libdrv` protects the device table and driver state with a fibril mutex
- devman also **runs driver initialization in a separate fibril**, to avoid the deadlock of "driver init still needs devman services"

**RE test**: dense user-mode "context switch" traces that do not match kernel scheduling should make you suspect fibrils first; mutex / yield calls inside a driver are fibril-level, not thread-level.

## 2. DDF: the user-mode driver framework

DDF (generic device driver support) is implemented in a **user-mode library** (`uspace/lib/drv`, public header `ddf/driver.h`). Key structures:

| Structure | Role |
|---|---|
| `driver_t` | the driver itself: binary path, device table, fibril mutex, name, phone, state, and **`driver_ops_t *driver_ops`** |
| **`driver_ops_t`** | generic driver operations — **called by the generic connection handler when a connection arrives** |
| `ddf_dev_ops_t` | device / function-level operations |

The lifetime is built around device / function: create (`ddf_fun_create`) → add a match id (`ddf_fun_add_match_id`) → bind (`ddf_fun_bind`) → online (`ddf_fun_online`) and similar calls; soft state is managed with `ddf_dev_data_alloc` / `ddf_fun_data_alloc`.

Entry shape: the driver's main stores the `driver_t` (**"driver_ops will be called by the generic handler when a connection arrives"**), registers with the device manager through `devman_driver_register(name, connection)`, sets up interrupt handling, then enters the async-manager loop. **When devman sends an "add device" message, generic code calls `driver->driver_ops->add_device(dev)`**.

**RE meaning**: it is normal for a driver to have no "main-loop dispatch" — dispatch is in the generic layer, and the work is in the `driver_ops` callbacks.

## 3. devman: the device tree and matching

devman is a **user-mode service** that maintains:

- the **device tree** (device node / function node) and the driver list
- **match scoring**: score by match id and pick the best driver
- automatic driver start, device enumeration, and hot-plug handling

Related actions: register a running driver, assign a driver, start a driver task; **a child device is added by its parent driver's registration action**, and a function can be registered into a class for the device mapper.

**RE mainline**:

```
match id / score → devman selects a driver → start that driver task → DDF callback → device function
```

**Do not look for a kernel-side driver dispatch table** — it lives in a user-mode service.

## Decision tree

```
Got a HelenOS target
├─ finding a driver
│    ├─ a user-mode server task (not a kernel module)
│    ├─ match and start are in devman; the work is in driver_ops callbacks
│    └─ do not look for a kernel dispatch table
├─ "thread switches" are abnormally dense
│    ├─ distinguish first: a kernel-preempted thread vs a user-mode cooperative fibril
│    └─ the kernel does not know about fibrils; do not look for the evidence in kernel scheduling
├─ driver init looks stuck
│    └─ note that devman does init in a separate fibril (to avoid re-entrancy deadlock)
└─ which device belongs to which driver
     └─ walk the device tree (device node / function node) and the match score
```

## Tools and verification

- Execution entity: the distinction between thread and fibril (the user-mode scheduler library, and where fibril mutexes are used)
- Driver: the `driver_ops_t` callback set and the `ddf_*` lifetime calls
- Topology: the device tree maintained by devman, and match id / score
- Verification: be able to state together "which layer the execution entity is on (kernel thread / user fibril) + how the driver was matched and started in user mode + which ops the work callbacks land in"

## Pitfalls on this platform

- **Treating a fibril as a kernel thread**: the kernel does not know about fibrils, and the scheduling evidence does not match
- **Looking in kernel scheduling for evidence of a fibril switch**: not finding it is normal
- **Looking for a kernel driver dispatch table**: a driver is a user-mode server, and dispatch is in the generic DDF layer
- **Assuming a driver has its own dispatch main loop**: the work is in the `driver_ops` callbacks
- **Ignoring devman's match score**: who binds to whom is decided by match-id scoring
- **Treating a "stuck" driver init as a bug**: devman initializes in a separate fibril to avoid re-entrancy deadlock

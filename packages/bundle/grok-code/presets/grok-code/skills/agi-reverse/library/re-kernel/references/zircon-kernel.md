# Fuchsia / Zircon: handle model / DFv2 driver framework / FIDL

<CORE RULE>
Two facts that send the whole analysis chain the wrong way:

① **A Zircon handle integer is meaningful only inside the current process** — the same class of pitfall as a seL4 CPtr (see [[sel4-kernel]]);
② **A driver is a user-mode component** — it is not in the kernel, and it is not "another kind of kext / `.sys`".

```
handle (process-local integer)
  → that process's handle table
  → kernel object
  → rights
```

All three must be recovered together. **Aligning processes by the handle integer alone makes every conclusion untrustworthy.**
</CORE RULE>

## 1. Handle semantics: the integer is not a global object id

- A handle's integer **means something only to the current process**: **the same integer in another process may correspond to no handle at all, or to a completely different kernel object**
- **After a handle is closed, its integer may be reused**
- So this inference is **invalid**:

```
A: zx_channel_write(0x4f, ...)
B: zx_channel_read(0x4f, ...)
  → "the same channel"
```

  The correct method is to recover each process's handle table separately and **align on the underlying kernel object**, not on the integer.

## 2. A handle can "move with a message": in-transit and transfer

- A channel does not only carry bytes; **it can also carry a capability**: after a handle is written into a channel, it is **removed from the sending process** and attached to the message; the receiver gets a **new handle** when it reads
- **While in flight it is in-transit**: bound only to a process, or bound only in the kernel; **a handle bound in the kernel is invisible to user mode** — "an in-transit handle is not visible from user mode" is by design, not a loss
- So a trace sequence like this **can be completely normal**, not a UAF:

```
A once held handle 0x57
  → channel_write sent it away
A touches 0x57 again → BAD_HANDLE
```

- Rights constraint: the channel itself needs `ZX_RIGHT_WRITE`; **every handle being sent needs `ZX_RIGHT_TRANSFER`**
- **A failed write does not mean the handle is still there**: on failure the handle is **discarded, not transferred** (the write was changed to an "always consume" semantic). "The call failed, so it should still hold this handle" is wrong
- Atomicity: the handles in one write **either all enter the channel, or all are discarded**
- Variant `zx_channel_write_etc`: each handle is wrapped in a `zx_handle_disposition_t`, and the operation is **`ZX_HANDLE_OP_MOVE`** (equivalent to `handle_replace` + write; the source handle is always closed) or **`ZX_HANDLE_OP_DUPLICATE`** (the source handle is kept)
- **Rights can only be narrowed, never widened**: they can be reduced on transfer, even set to `ZX_RIGHT_NONE`; **if `ZX_RIGHT_TRANSFER` was removed, the handle the receiver gets cannot be passed on** — a common explanation of "why this hop cannot continue"
- Special case: **in-transit, and the channel / socket it sits on is destroyed → that handle is closed**

**Corollary**: a reachability / security graph must record **object + handle + rights** together — two handles can point at the same object and still hold different READ / WRITE / MAP / TRANSFER rights; "the same object" is not "the same capability".

## 3. DFv2: a driver is a user-mode component, and bind is bind rules, not probe

DFv2's division of labor:

| Entity | Job |
|---|---|
| **driver manager** | start / stop drivers, route FIDL capabilities to drivers, **maintain the topology of every node** |
| **driver host** | the process that hosts driver instances (its own address space and threads); **one driver host can co-locate several drivers** |
| **driver index** | registers every available driver and its metadata (component URL + **bind rules**), and matches nodes on request |
| **driver runtime** | the local communication mechanism between co-located drivers |
| **FIDL** | the main way drivers talk to each other, to the framework, and to non-driver components |

Bind sequence:

```
parent driver creates a child node
  → driver manager sends MatchDriver to the driver index
  → driver index compares node properties against each driver's bind rules (bytecode)
  → returns the URL of the best-matching driver
  → driver manager creates or reuses a driver host and starts the driver instance (Start())
  → the driver may create more child nodes, and the loop continues
```

**So do not look for a Linux-style `bus probe()`**: recover

```
node properties → bind rules → driver index → driver component → driver host → FIDL services
```

Drivers also have a tier (boot driver / base driver / universe driver) — **"this driver is not in the system" should be read by load source first**; a universe driver is registered by hand during development.

## 4. Co-located drivers: no channel calls in the syscall trace is not necessarily a bad analysis

- **Co-located**: a driver can ask to be placed in the parent driver's driver host, and thus **share the same address space**
- Between co-located drivers, **driver runtime provides an in-process path** — faster than a kernel channel, at the cost of **producing no syscall trace such as `zx_channel_write()`**

So: **driver A → driver B IPC clearly happened, but the syscall trace is clean** — suspect driver-runtime local transport first, not "I missed it" or "the sample is hiding the call".

- Related: node "symbols" (key/value pairs; values may contain virtual addresses) are **used for in-process communication only when parent and child share a driver host**; otherwise the path is FIDL
- The reverse inference: **a lot of direct memory-address exchange usually means these two drivers are co-located** — that itself is topology evidence, and it can recover the driver-host partition

## 5. `/dev/foo` is not a Unix device file

- After opening a devfs entry, **what you usually get is a FIDL channel**; later traffic is FIDL, not the read / write / ioctl device-file model
- Newer toolchains are also **moving gradually from devfs to service discovery**: how a device capability is exposed changes with the era, and **"I did not find it under `/dev`" does not mean it does not exist**

## Decision tree

```
Got a Fuchsia target
├─ ask first: is this a user-mode component or the kernel?
│    ├─ user mode (most drivers and system services) → DFv2 model
│    └─ kernel (Zircon itself) → kernel objects and the handle table
├─ handle-related
│    ├─ comparing handle integers across processes → invalid; align on the kernel object
│    ├─ there was a handle, now BAD_HANDLE → check whether channel_write sent it away (in-transit / transfer)
│    └─ it will not pass onward → check whether ZX_RIGHT_TRANSFER was removed (rights were narrowed)
├─ device / driver related
│    ├─ do not look for bus probe() → recover node properties → bind rules → driver index → driver host
│    ├─ the driver "did not load" → distinguish boot / base / universe source
│    ├─ IPC but no syscall → check whether they share one driver host (driver runtime local transport)
│    └─ finding a device → do not only walk devfs; a modern path may be service discovery
└─ rights / capability anomaly → draw the object + handle + rights triple, not only the object graph
```

## Tools and verification

- Topology: the node topology maintained by driver manager, and driver index match results (node → bind rules → driver URL)
- Components and processes: a driver host is a process — **co-location can be read directly from the driver-host partition**, and that is the key evidence for "IPC with no syscall"
- Communication: the FIDL call chain (the main path between a driver and the framework / other components)
- Verification: be able to state together "object ownership (which handle in which process) + rights + communication path (FIDL / co-located local channel / kernel channel)"

## Pitfalls on this platform

- **Treating a handle integer as a global object id**: the integer is valid only inside the process, cross-process comparison is meaningless, and the integer can be reused after close
- **Treating in-transit as lost**: a handle bound in the kernel being invisible to user mode is the normal state
- **Treating "BAD_HANDLE after it was sent" as a UAF**: after a successful transfer the sender no longer holds it
- **Assuming a failed write means the handle is still there**: on failure it is discarded, not transferred
- **Ignoring rights**: two handles on the same object can have different capabilities; removing `ZX_RIGHT_TRANSFER` stops further passing
- **Looking for `bus probe()` the Linux way**: Fuchsia bind is node properties + bind rules matched by the driver index
- **No IPC in the syscall trace, so the analysis is wrong**: co-located drivers use driver runtime's in-process channel and never make that kernel call
- **Reading `/dev/foo` as a Unix device file**: open usually returns a FIDL channel; newer code is moving to service discovery
- **Treating co-located drivers' memory-address exchange as a leak or an anomaly**: that is the normal in-process mechanism when parent and child share a driver host

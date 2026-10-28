# QNX Neutrino: resource managers / message passing / io-pkt

<CORE RULE>
A large share of QNX "drivers" are **user-mode servers**, not kernel modules.

```
open("/dev/foo")
  → pathname resolution (process manager)
  → resource-manager process
  → MsgSend / MsgReceive
  → io_open handler
```

Not:

```
syscall → VFS → kernel driver file_operations
```

So a process that **has no ioctl syscall handler, has no kernel module, and still controls hardware** is not strange on QNX. It is the normal case.

The first lesson is not "disassemble the kernel first". It is **classify the form first**: is this code a resource manager, a shared object loaded by io-pkt, or actually in kernel mode? Get the form wrong and every later inference is void.
</CORE RULE>

## 1. Classify the form first (it decides everything after)

| Form | What it looks like | Analysis entry |
|---|---|---|
| **resource manager process** | A standalone process that registered a pathname and loops receiving messages | the path from `resmgr_attach` + the connect/io function tables |
| **network driver loaded by io-pkt** | a `devnp-*.so` shared object, **neither a standalone process nor a kernel module** | loaded by `io-pkt -d <name>`; driver callbacks run inside io-pkt |
| **kernel mode (procnto)** | microkernel + process manager in one | IFS image → `dumpifs` extracts procnto, then analyze it |

## 2. Resource manager: recognize the API sequence, not toolchain habit

A typical resource manager skeleton is a fixed sequence:

```
dispatch_create() / dispatch_create_channel(-1, DISPATCH_FLAG_NOLOCK)
  → resmgr_attr_t (nparts_max / msg_max_size)
  → iofunc_func_init()          # load the default POSIX handler tables
  → iofunc_attr_init()          # per-device attributes
  → resmgr_attach(dpp, &attr, path, file_type, flags, &connect_funcs, &io_funcs, &handle)
  → dispatch_context_alloc()
  → loop: dispatch_block() → dispatch_handler()
```

- There are two tables: the **connect function table** (`open` / `unlink` / `rename` / `mknod` / `readlink` / `link` / `unblock` / `mount`) and the **I/O function table** (`read` / `write` / `devctl` / `stat` / `lseek` …)
- `resmgr_attach()` does three things at once: registers the pathname into the namespace, creates the channel used to receive messages, and binds the dispatch handle to the function tables
- **The receive underneath is `MsgReceive` / `MsgReceivev`** — `rcvid` inside `resmgr_context_t` comes from it; `dispatch_block()` blocks waiting for a message, `dispatch_handler()` parses it and dispatches by table
- **`iofunc_func_init()` supplies usable default implementations** — many handlers are defaults; not every device rewrites the `stat` / `chmod` set; only an explicit override (for example `io_funcs.read = io_read;`) is that device's own logic
- Multithreaded form: `thread_pool_attr_t` (`block_func = dispatch_block`, `unblock_func = dispatch_unblock`, `handler_func = dispatch_handler`, `context_alloc/free`) + `lo_water` / `hi_water` / `increment` / `maximum` → `thread_pool_create()` / `thread_pool_start()`. **`lo_water` is "how many threads to keep blocked in RECEIVE"**
- Private messages go through `message_attach()`, and then **you use `dispatch_*()` rather than `resmgr_*()`**

**Recovery point**: once you have a process, first find the path argument of `resmgr_attach` — **the pathname it registered is its identity**; then find the overridden table entries — **entries that were not overridden keep default semantics; overridden ones are the business logic**.

## 3. The control channel is devctl, not ioctl

- The control path is `devctl` in the I/O function table (`io_devctl_t`); command codes use `_IO_DEVCTL`; custom messages use `_IO_DEVCTL` or `_IO_MSG`
- The old `other_func` is explicitly discouraged — **seeing it in an old sample means the code is from an earlier era**; do not treat it as "the main protocol entry"
- Recovery order: `devctl` command code → parameter structure → the matching hardware / shared-memory operation; command-code constants often appear in groups in the binary's read-only data

## 4. io-pkt: the third form of a network driver

- io-pkt is a **multithreaded process** containing the network stack and a resource-manager dispatcher; **the stack context is single-threaded** (blocking is handled with a pseudo-thread)
- **Blocking the stack context = blocking the whole io-pkt resource manager**: `ifconfig` hanging is often the stack context being blocked, not a problem in ifconfig itself
- A native network driver is a **`devnp-*.so` shared object**: `io-pkt -d some_driver` looks for `devnp-some_driver.so` and loads it as a native driver; if that is missing it falls back to `devn-some_driver.so` (through the **`devnp-shim.so`** compatibility layer)
- **`devnp-shim.so`** provides backward compatibility for io-net-era `devn-*` drivers (usually loaded automatically; it can also be explicit: `io-pkt -d shim "/lib/dll/devn-speedo.so"`); a driver loaded through the shim has an interface name of the form `enX`; use `pidin me` to confirm what was loaded
- Threads created inside a driver **should not use a raw `pthread_create()`**; use `nw_pthread_create()` (tracked by io-pkt, and required to implement a quiesce callback); timers use `callout_*`

**RE meaning**: a NIC driver may have neither a standalone process nor a module file — it is only **some `devnp-*.so`**. To analyze it you first confirm "who loads it, and into which process".

## 5. Priority inheritance: a priority jump in a trace ≠ a call to `pthread_setschedparam`

- QNX Send/Receive/Reply carries **message-driven priority inheritance**: a server thread **inherits the sender's priority**, and requests are received in priority order
- The boost can happen **at send time** (without waiting for the server to receive) — this avoids the inversion where "a medium-priority thread stalls delivery of a high-priority client's message"
- **After the server replies, priority is not restored automatically**: it stays until a new message / pulse raises or lowers it, or something changes it explicitly
- **`_NTO_CHF_FIXED_PRIORITY`** on `ChannelCreate()` turns this inheritance off
- **Server boost**: when no thread is RECEIVE-blocked on the channel (clients are SEND-blocked), the kernel **boosts some server thread associated with that channel**; its original priority is recorded on the first boost, and the kernel re-evaluates the next time a message is received

So: **a thread priority that suddenly changes in a sample should first be treated as normal IPC inheritance**; correspondingly, "a well-designed multithreaded server should always have at least one RECEIVE-blocked thread".

## 6. "Blocked for a long time" is often a normal state on QNX

- `MsgSend()` is **synchronous**: the sending thread enters `STATE_SEND` (sent, not yet received) or `STATE_REPLY` (received, not yet replied) until `MsgReply*()`, a signal, a timeout, server death, or similar clears it
- A **pulse** is a different thing: **fixed size, non-blocking**, payload is 4 bytes of data + 1 byte of code; used for interrupt-handler notification or for a server to notify a client without blocking; it is also queued and received by priority
- Note: under adaptive partitioning, **a pulse does not inherit the sender's partition** (Send/Receive/Reply does) — do not treat that observational difference as a scheduling bug

Therefore: **"a thread stuck in IPC" and "a pile of RECEIVE-blocked threads inside a server" are not deadlock evidence**, unless you can also name the blocked object (who was supposed to reply and did not).

## 7. Analysis spine

```
pathname
 → resource manager (which process registered it)
 → channel / connection (who connects to whom)
 → message type (_IO_* / private message / pulse)
 → handler (connect table / io table / devctl command code)
 → hardware / shared memory / another server
```

On a multi-server system this chain can keep going: **a QNX "driver stack" is often a string of servers** (for example filesystem, block device, and network are each a server), not one call chain inside the kernel.

## Decision tree

```
Given a QNX target
├─ Classify the form first
│    ├─ A resmgr_attach / dispatch_* sequence → user-mode resource manager
│    │    ├─ What is the path of resmgr_attach (that is, the "device name")
│    │    ├─ Which connect/io table entries were overridden (the rest take iofunc defaults)
│    │    ├─ devctl command codes → the control path
│    │    └─ channel/connection: who is MsgSend-ing it
│    ├─ It is a devnp-*.so → find the io-pkt that loads it; decide native driver vs old devn-* through devnp-shim
│    └─ Actually kernel mode → IFS image (startup header 0x00ff7eeb + "imagefs") → dumpifs extracts procnto
├─ A dynamic observation looks wrong
│    ├─ Priority suddenly changes → treat it first as IPC priority inheritance / server boost, not an explicit schedule change
│    ├─ A thread blocked for a long time → treat it first as synchronous MsgSend wait, not deadlock
│    └─ Stack context is blocked → the whole io-pkt resource manager stalls with it
└─ Multi-server system → keep walking pathname → channel → server; do not expect a complete call chain inside the kernel
```

## Tools and verification

- Threads / processes: `pidin` (including `pidin me` to confirm what a process loaded), and side channels such as `DCMD_PROC_TIDSTATUS` on `/proc/<pid>/ctl` to read thread state
- Namespace: which pathname a process registered, and who opened it — **treat the pathname as the cross-process anchor**
- Static: identify the form from the API sequence first (`resmgr_attach` / `dispatch_*` / `MsgReceive` / `io_*`), then talk about logic; do not chew forward from `_start`
- Network: confirm which io-pkt loaded the driver, and whether it is `devnp-*` or a shimmed `devn-*`
- Verification: you can state together "form (user-mode server / io-pkt shared object / kernel mode) + registered pathname or loader + message and command-code path"

## Pitfalls on this platform (summary)

- **Looking for "the driver" with a Linux driver mindset**: on QNX the process that controls hardware may have neither a kernel module nor an ioctl handler — it is a user-mode resource manager
- **Treating `iofunc_*` default implementations as business logic**: `iofunc_func_init()` fills a full set of usable defaults; **only explicitly overridden table entries are this device's logic**
- **Reading IPC priority inheritance in a trace as an explicit schedule change**: the server inherits the sender's priority, the boost can happen at send time, and it is not restored after reply; `_NTO_CHF_FIXED_PRIORITY` is the off switch
- **Treating MsgSend's synchronous block as deadlock**: the sending thread is supposed to wait until reply; a pulse is the non-blocking class
- **Forgetting that pulses and messages differ under adaptive partitioning**: a pulse does not inherit the sender's partition
- **Failing to find a network driver in the process list**: it may be a `devnp-*.so` loaded by io-pkt (neither its own process nor a module)
- **Treating `devn-*.so` as a native driver**: that is the io-net-era form, loaded for compatibility through `devnp-shim.so`, and the interface naming differs (`enX`)
- **Assuming it is fine to block some driver callback**: the callback may run in io-pkt's **single-threaded stack context**; blocking it blocks the whole network resource manager
- **Seeing a raw `pthread_create` in a driver and analyzing it as an ordinary thread**: io-pkt requires `nw_pthread_create()` plus a quiesce callback
- **Treating `other_func` as the main protocol entry**: that mechanism is explicitly discouraged and is usually old code

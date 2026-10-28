# Unikraft / MirageOS: library operating systems and unikernels

<CORE RULE>
This family's model is:

```
application + the selected OS libraries + drivers + runtime
        → linked into a single image / a single address space
```

So:

```
do not force a search for a "user → syscall → kernel process" boundary
```

**A "system call" may be only a function call, and the "kernel" may live in the same protection domain.**

The second pitfall: **the same application source can be built into completely different targets**, and runtime I/O, boot, the device model, and the address layout all change with it — seeing the same application name, **do not assume the binary / runtime architecture is the same**.
</CORE RULE>

## 1. Unikraft: a library operating system

- OS function is split into fine-grained **micro-libraries**, selected by a Kconfig-style build system, and **linked with the application into a single binary**; POSIX compatibility is supported
- A single address space and a single protection domain, **with no protection boundary between components**; a kernel function can be **executed directly** — a dedicated call mechanism makes entering the "kernel" **require no trap / interrupt / privilege-level switch**
- **Scheduling is optional**: a single-threaded or run-to-completion unikernel can be built

Two build routes (the distinction matters a lot for RE):

| Route | Method | Result |
|---|---|---|
| **Native (API compatible)** | the application's **source** is compiled and linked with Unikraft; system calls are resolved to handlers through a shim micro-library | at runtime the shim "steps aside", and **a syscall actually becomes a cheap function call** |
| **Binary-compatible (ABI compatible)** | run an **unmodified Linux ELF** directly, with no recompile | system calls are **trapped** and redirected through the shim to each subsystem; a missing syscall falls to an ENOSYS stub by default |

- The binary-compatible route needs: the ELF format, binary-compatible function interfaces and data representation, Linux system calls, and a compatible runtime environment
- **Whether it is PIE affects address-space layout**: a non-PIE executable **decides the layout and is limited to a single non-PIE application**; PIE provides layout flexibility, allows several applications in one address space, and **does not need an address-space switch on a context switch**

**RE meaning**:

- Do not automatically assume a privilege-level switch when you see a "system call" — **inside the same protection domain it may be only a function call**
- "Kernel functions" mixed with "application functions" is also normal
- Decide native vs binary-compatible first: their call paths differ

## 2. MirageOS: treat the configuration as the wiring diagram

- Written in OCaml and built into a **standalone unikernel**; the same source can be built for many targets: a **Unix process** (local development), **Xen** (PVH mode), the **Solo5 family** (hvt hardware virtualization, spt strict seccomp sandbox, virtio, muen, genode), a Unikraft target, and so on
- The build flow is "**write the configuration manifest first, then generate the build**":
  1. Write a configuration that describes the components (**a wiring diagram, not the application itself**) — this expresses "the type of the application functor" and "which concrete implementation is plugged in"
  2. Run the configuration for the target, generating Makefile / Dune files, **the main glue code**, and **a per-target package description**
  3. Build
- **Changing the target of the same source changes only one replaced module** (the platform main module) plus the target's package set; the application code does not change

**The important corollary**:

```
the source has no explicit "new Driver()"
but a device appears at runtime
  → that is not strange: device wiring is decided by the build-time configuration
```

- Device drivers are packaged per target (network, console, block device, and clock each have a matching package); some targets support multiple networks / multiple block devices, others are limited to one
- Cross-target behavior differences (I/O, boot, device model, address layout) come from this layer, not from application logic

## 3. Unikraft's startup tables and syscall symbols

**Multi-level init tables** (this is the right explanation of "0 xrefs, yet it runs at startup"):

| Table | Stage | Notes |
|---|---|---|
| early table | earliest | **before the allocator is available**, handles bootinfo |
| constructor table | immediately after | also before the allocator; library-level constructors |
| init table | after that | standard library init **after the scheduler is available** |

**Init levels (in order)**: constructor → early → platform → library → rootfs → system → late; **each level has 10 priorities (0 is highest)**, entries live in **dedicated link sections sorted by name**, bounded by start and end symbols.

**So**: `init function, 0 xrefs` **is not dead code**.

**Several symbols in the syscall shim**: the same operation often has both a **libc-style** wrapper and a **raw-error-style** wrapper (plus the shim itself) — **do not call that "three duplicate implementations"**; they are ABI wrapper layers.

**A native build has no privilege transition**: a syscall-shaped API **lands directly in the library implementation** (for example it eventually reaches the VFS write path), and `write() → an ordinary call` is entirely possible.

**A binary-compatible build really does present the Linux syscall ABI**: so **split first on "native link, or loading a Linux ELF"** — the two cannot share one CFG mental model.

**A missing syscall returns ENOSYS and the application still works**: the documentation explicitly says this happens — many applications call syscalls they do not actually depend on. **"A missing syscall" cannot be read directly as "the application is incompatible".**

## 4. MirageOS's Lwt and target fingerprints

- **No OS threads, yet it looks like hundreds of "threads"**: Mirage uses **Lwt** heavily — **cooperative lightweight threads plus an event loop**, not preemptive native threads
- **One function entering a tight loop makes the whole unikernel look dead**: an Lwt thread runs until it yields on purpose; a CPU-heavy path that does not yield can **starve every task on the same event loop** — **no mutex is required, and no kernel deadlock is required**:

```
every network timer stops / every async task stops / CPU at 100%
  → check first whether there is a cooperative yield
```

- **A background task fails and the main program behaves strangely**: an Lwt background exception is handed to the **async exception handler**, and whether the unikernel terminates depends on that handler's configuration — **it is neither a certain crash nor certainly ignored**; the async-exception policy must be recovered
- **Target fingerprint**: different targets have completely different isolation mechanisms (hardware virtualization / a sandbox process / a virtio-compatible hypervisor / Xen PVHv2) — **"this is a MirageOS unikernel" is not enough to decide what to look for** (a VM-exit? a Linux syscall? a Xen grant? a virtio queue?), and **the target must be identified first**

## 5. Shared RE strategy for this family

1. **Confirm the build target / build type first** (native vs binary; Unix vs hvt vs Xen …) — it decides the syscall path, the address layout, and the device model
2. **Do not assume a privilege boundary exists**: a single address space is the design
3. **A device's appearance and wiring come from the build-time configuration**, not from the application source
4. The picture "the application runs fine but there is no trace of it calling the kernel" is normal in a native build

## Decision tree

```
Got a unikernel target
├─ decide the build type / target first
│    ├─ Unikraft: native (compiled from source) or binary-compatible (runs a Linux ELF)
│    ├─ MirageOS: unix / xen / hvt / spt / virtio / …
│    └─ the target decides I/O, boot, the device model, and the address layout
├─ no trap / privilege switch for a syscall
│    └─ under a single protection domain it may just be a function call (native build)
├─ the source of the device wiring cannot be found
│    └─ it comes from the build-time configuration (manifest / DSL), not the application source
├─ address-layout related
│    └─ non-PIE decides the layout and limits to one application; PIE allows several applications in one address space
└─ the same application name, different behavior
     └─ do not assume the binary / runtime architecture is the same; confirm the target first
```

## Tools and verification

- Build type: the build system's configuration items, whether there is an ELF loader (the binary-compatible route), the package set
- Call path: where the shim micro-library is used; the "step aside" behavior of the native route
- Device wiring: the build-time configuration manifest / DSL and the generated main glue code
- Verification: be able to state together "which build / which target this is + whether the call enters the kernel as a function call or a trap + which configuration the device wiring came from"

## Pitfalls on this platform

- **Forcing a search for a user / kernel boundary**: a single address space and a single protection domain are the design
- **Assuming a "syscall" is a privilege-level switch by default**: under a native build it may be only a function call
- **Assuming the same application name means the same runtime architecture**: the build target decides everything
- **Looking for device init in the application source**: the wiring comes from the build-time configuration
- **Ignoring whether PIE restricts the address layout**: non-PIE decides the layout and limits to one application
- **Ignoring the stub semantics of the binary-compatible route**: a missing system call may fall to an ENOSYS stub, and the behavior differs from returning an error
- **Reading the image with a "dynamic library / dynamic linker" model**: this family is usually a static whole link
- **Treating a startup function with 0 xrefs as dead code**: multi-level init tables register through dedicated link sections
- **Treating the shim's several symbols as duplicate implementations**: libc style / raw-error style / the shim itself are three wrapper layers
- **Treating ENOSYS as "the application is incompatible"**: many applications call syscalls they do not depend on
- **Treating "every task stuck together" as a kernel deadlock**: a cooperative thread that does not yield starves the whole event loop
- **Treating a background-task exception as a certain crash or as certainly ignored**: it depends on the async-exception policy
- **Looking for a VM-exit / syscall without confirming the target**: different build targets have completely different isolation mechanisms

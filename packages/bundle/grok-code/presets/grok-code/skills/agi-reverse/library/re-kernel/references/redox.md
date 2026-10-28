# Redox OS: scheme / boot chain / relibc / a driver is a user-mode daemon

<CORE RULE>
Redox's core abstraction is not "VFS + kernel drivers". It is a **scheme**:

```
an ordinary program's read() / write() / mmap()
  → the kernel translates it into an SQE message
  → a scheme provider (usually a user-mode daemon) handles it
  → a CQE message → the kernel turns it into the syscall return value
```

So **`read()` does not necessarily mean a filesystem** — it may be the network, a device, an IRQ abstraction, or any system service, and **the meaning is decided by the target scheme**.

Second point: **a handle descriptor on the scheme side ≠ the client's fd**; the kernel maps the two, and **the integers must not be compared across sides**.

Third point (where to analyze): **the syscall ABI is deliberately unstable** — the stable layer was pushed into the user-mode library. So the binary in hand **may not match the current kernel's syscall numbers**; a version mismatch is not a reason to conclude "it was modified".
</CORE RULE>

## 1. The shape of a scheme

| Kind | Provider |
|---|---|
| **user-mode scheme** | a user-mode program (usually a daemon) — **whatever can be implemented lives in user mode** |
| **kernel scheme** | implemented directly by the kernel (only the critical part stays there) |

- The root scheme (`:`) is a special kernel-provided scheme, the **container of every other scheme name**
- A provider creates a scheme by creating `":myscheme"`; **the returned file descriptor is its message channel with the kernel**
- **Scheduling class**: filesystem calls that involve a path are marked **path-class** or **file-class** — the kernel **matches the scheme name by path prefix**, or **remembers which scheme was used when that fd was opened**; the two match methods decide "why the behavior changed when the path changed"
- On the kernel side a scheme is a trait (corresponding to a user-mode daemon's `UserScheme` implementation)
- **Other IPC does not go through a scheme**: pipes and similar use ordinary syscalls; a dedicated IPC daemon provides shared-memory / channel-style IPC

## 2. Translation and mapping on the kernel side

- An ordinary program's file operations are **translated by the kernel into SQE messages** and handed to the provider; the provider answers with a **CQE message**, which the kernel turns into the syscall result
- An SQE / CQE is a bidirectional queue entry: **opcode (Open / Read / Write …), flags, tag (request id), caller (caller process id), args (operation-specific parameters)**
- **Descriptor mapping is the key**: an `open` request carries the name of the item to open, and the scheme allocates its own numbered descriptor; **that descriptor is not the same as the client's file descriptor** — the kernel maps `(client process, fd number)` to `(provider process, handle number)` and puts both into the message packet

**RE meaning**: each side of a trace has an integer handle, and **they are not supposed to be equal**; the relationship goes through the kernel's mapping, not through comparing integers.

- **Blocking semantics**: a client doing a blocking read / write is suspended; the kernel sends an event packet on the provider's event descriptor to wake it; when finished, the client is marked ready and put on the run queue
- **Buffer capture**: for an operation such as `read(fd, buf, len)`, the kernel exposes the caller's buffer to the provider — a head copy, **a zero-copy middle of pages** (pinned), and tail handling
- **FD passing**: a scheme can act as an IPC broker and insert a descriptor into the caller's file table
- **Memory mapping**: a user-mode scheme provides an mmap region through a dedicated opcode
- **Namespace**: a process inherits its parent's namespace; newer architecture moved namespace management to a **user-mode manager daemon**; schemes are created anonymously in the kernel, and requests are dispatched through `openat` plus a namespace descriptor

## 3. The daemon's fixed pattern (it decides the behavior boundary)

A scheme provider's typical init:

1. Create the scheme (obtain the fd)
2. Open the resource fds it needs (interrupt, timer, events, and so on)
3. **Enter the null namespace — after this it can no longer open ordinary resources by name**
4. Register the event fds to listen on with the event scheme
5. Enter the loop: wait for an event → read the event and decide timer / resource event (for example a device interrupt) / scheme request → handle the request → reply by tag

**So**:

```
after init the driver enters the null namespace and then cannot open ordinary resources
  → that is not a sandbox anomaly; it is the security design
```

## 4. Boot chain: from the bootloader to the first user-mode program

```
bootloader (BIOS build / EFI build; the latter covers x86_64, aarch64, riscv64)
  → load the kernel and initfs into memory, build the initial page tables
  → jump to the kernel entry (architecture-specific assembly entry)
  → Rust entry: check BSS / data, build the initial stack, enter with a "kernel parameters" structure
  → initialize debug output, the memory manager, paging and the heap, (x86) GDT / IDT and the syscall instruction
  → main initialization
  → enter the user-mode scheduling loop
```

- That "kernel parameters" structure carries: the kernel image, the stack, the environment, a **hardware description** (ACPI RSDP on x86, a device tree on aarch64 / riscv64), memory regions supplied by the bootloader, and the **bootstrap / initfs region**
- Secondary cores on a multiprocessor take **a different entry path**

**bootstrap (the first user-mode program)**:

- The kernel loads the initfs blob, builds an address space for it, and jumps to the offset the bootloader gave
- bootstrap allocates a stack in an assembly stub, **sets memory protection on itself**, then execs `init`, and starts the initfs scheme daemon
- It is itself a **tiny ELF loader** (written in Rust, with a per-architecture custom linker script, statically linked)

**initfs is a compressed archive** containing the minimum binaries and configuration for a two-stage boot: architecture-specific drivers (block device, input, and so on) and core daemons. **That is how the system can support many filesystem drivers without compiling them into the kernel.**

## 5. relibc and the C runtime

- **relibc** is a C library written in Rust (including the headers, except macros), and **it supports both Redox and Linux, with two backends**: raw syscalls on Linux, the runtime library on Redox
- **The stable ABI layer is in user mode**: applications face a stable ABI, and the unstable parts (syscall ABI, IPC, process management) are pulled into the runtime library
- **C startup sequence**: `_start` (crt0) → the runtime startup function parses the **auxiliary vector**, builds argc / argv / env, initializes the thread control block → `.init_array` constructors → `main()`
- The auxiliary vector has platform-specific items (for example the process fd, the thread fd, the inherited signal mask), **and the program-header pointer the dynamic linker needs** — so "is this binary static or dynamic" can be confirmed from the auxiliary-vector side
- The thread control block is carried in an **architecture register**; a thread is created with `clone`, and **on Redox each thread is represented by a file descriptor**, sharing the address space and inheriting the file table
- The syscall wrapper layer is responsible for **restartable semantics** (retry after a signal interrupt) and for mapping kernel errors to errno

## 6. The actual shape of drivers and daemons

- **A driver is a standalone user-mode program** (driver schemes, presented as file-style services)
- They have fixed locations in the filesystem, and **PCI-related device configuration is also stored as data files** (organized by vendor / device)
- **Drivers are built twice**: the initfs copy uses a **size-optimized + panic-abort** build, and the main filesystem uses a **standard release** build

**Reversing meaning**: the same driver in two places **is not the same artifact** — do not infer main-system behavior from the initfs copy.

## Decision tree

```
Got a Redox target
├─ decide first: kernel / user-mode daemon / application
│    ├─ the kernel is small, and the syscall ABI is deliberately unstable → a version mismatch is not "it was modified"
│    └─ a user-mode daemon is the most likely target
├─ what is behind one read / write
│    ├─ locate which scheme it is (the scheme name in the path is the "type")
│    ├─ match method: path prefix, or "remember the scheme used at open"
│    └─ do not assume it is a filesystem
├─ the handles on the two sides do not match
│    ├─ the client fd and the provider descriptor are not supposed to be equal
│    └─ establish the relationship through the kernel mapping
├─ some process can no longer open new resources
│    └─ the provider may have entered the null namespace on purpose
├─ you want the message contents
│    └─ parse SQE / CQE entries: opcode / flags / tag / caller / args
├─ boot / load related
│    ├─ find bootstrap and initfs (two-stage boot, a tiny ELF loader)
│    └─ device wiring comes from initfs and user-mode daemons, not from the kernel
└─ two artifacts of the same driver
     └─ the initfs build and the main-system build are built differently
```

## Tools and verification

- Service topology: scheme name in the path → provider daemon; the scheme's creation point (`:name`)
- Request flow: SQE / CQE entry fields (opcode / tag / caller / args) and response matching
- Handles: the kernel mapping between the client fd and the provider descriptor
- Boot: bootloader kind, the hardware-description source in the kernel parameters (ACPI vs device tree), initfs contents
- Runtime: auxiliary-vector items (static / dynamic, thread and process handles carried as fds)
- Verification: be able to state together "which scheme this I/O landed on + who the provider is + how the two handles correspond + which build pass this artifact belongs to"

## Pitfalls on this platform

- **Assuming read / write is a filesystem by default**: the meaning is decided by the scheme
- **Comparing handle integers across sides**: the client fd and the provider descriptor are mapped by the kernel, and inequality is normal
- **Treating entry into the null namespace as a sandbox anomaly**: that is the provider's security design
- **Looking for device drivers in the kernel**: drivers are mostly user-mode daemons
- **Ignoring the two scheme match methods**: path prefix vs remembering the scheme used at open
- **Hard-coding syscall numbers**: the ABI is deliberately unstable; the stable layer is the user-mode runtime
- **Treating the initfs driver as the same artifact as the main system**: two build passes, with different optimization and panic policy
- **Attributing a block to deadlock**: client blocking is by design, driven by the provider's event-wakeup mechanism
- **Ignoring FD-passing capability**: a scheme can act as an IPC broker
- **Getting the boot-time hardware-description source wrong**: x86 differs from aarch64 / riscv64 (ACPI vs device tree)

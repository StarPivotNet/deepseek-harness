# NuttX: three memory models, FLAT / PROTECTED / KERNEL

<CORE RULE>
Before analyzing NuttX **you must ask one question: is this a FLAT, PROTECTED, or KERNEL build?**

If you do not know which, the decompiled syscall and address semantics **are very easy to get entirely wrong** — the same API produces completely different artifacts under the three models.
</CORE RULE>

## 1. The three models

| Model | Structure | Address space |
|---|---|---|
| **FLAT** | OS and application live in one flat image and can access each other directly | Single |
| **PROTECTED** | A two-pass build produces **two blobs**: a privileged kernel blob + an unprivileged user blob; the MPU enforces the limits; **user-side APIs are auto-generated syscall proxies** | Kernel / user split |
| **KERNEL** | A kernel address space + **an independent address environment per user process**; requires an MMU | Per-process |

## 2. The same API decompiles completely differently

Take `getpid()`:

```
FLAT      : a direct call into the NuttX implementation
PROTECTED : pid_t getpid(void) { return (pid_t)sys_call0(SYS_getpid); }
            → privilege switch → kernel-side stub → the real getpid
```

- **Under PROTECTED, the user-facing API is an auto-generated syscall proxy**: generated from `syscall/syscall.csv` by `tools/mksyscalls`; the kernel side has a separately auto-generated stub that maps the syscall back to the real call
- Therefore:

```
getpid() is only two or three instructions, then an immediate SVC/trap
  → do not call it "libc was hooked" or "the syscall wrapper is abnormal"
  → this is the normal shape of that build
```

**RE criterion**: when you see a large pattern of "very short function + immediate privilege trap", first confirm whether this is a PROTECTED build, then talk about suspicion.

## 3. Two heaps (under PROTECTED)

- By default there can be **only one user-space heap**, shared by kernel-mode and user-mode code — simple, but kernel-mode allocations are not isolated
- After `CONFIG_MM_MULTIHEAP=y` and `CONFIG_MM_KERNEL_HEAP=y` there are two allocators:
  - **Unprotected user heap**: shared by kernel and user code (the allocator physically lives in the user address space; the kernel learns its address from information at the head of the user blob)
  - **Protected kernel heap**: accessible only to the NuttX kernel, built into the kernel blob; `CONFIG_MM_KERNEL_HEAPSIZE` sets its size (default 8192 bytes), and the rest of memory goes to the user heap; **after alignment to the minimum memory-protection region the kernel heap may actually be larger**
- Interface split: `up_allocate_heap()` returns the user heap, `up_allocate_kheap()` provides the kernel heap
- That option defaults on for protected/kernel builds and off for flat builds

**So**:

```
Address A came from malloc and the user can access it
Address B came from malloc and the user faults
  → not necessarily heap corruption; they may have come from malloc and kmalloc respectively
```

## 4. Heap layout in the KERNEL model

One kernel heap + **one user heap per task group**; only the kernel heap is initialized in the architecture's `up_allocate_kheap()`. Typical memory map: kernel `.data` / kernel `.bss` / kernel idle stack / padding / user `.data` / user `.bss` / kernel heap (`CONFIG_MM_KERNEL_HEAPSIZE`) / user heap (extends to the end of SRAM).

## 5. Drivers split into upper half and lower half

NuttX drivers are usually two layers:

| Layer | Location | Duty |
|---|---|---|
| **upper half** | `drivers/` (generic, hardware-independent) | Registered with `register_driver()` / `register_blockdriver()`, implements standard interfaces such as `read` / `write` / `close` / `ioctl` / `poll`, **and calls the lower half through callbacks** |
| **lower half** | `arch/<arch>/src/...` or `boards/<arch>/<chip>/<board>/src` | Register access and configuration, interrupt handling, exposing capability through a standard callback structure (for example a UART's `uart_ops_s`) |

- One upper half can serve **multiple** lower-half instances (one-to-many)
- **Board logic is responsible for creating the lower-half instance and binding it to the generic upper half**
- Network drivers are isomorphic: the interface is in `include/nuttx/net/netdev_lowerhalf.h`, the upper half is `drivers/net/netdev_upperhalf.c`, and registration uses an interface such as `netdev_lower_register()`
- Driver initialization is staged: `drivers_early_initialize()` (before the heap / scheduler are available) → `drivers_initialize()` (registers core pseudo-devices such as `/dev/null` and `/dev/zero`) → `board_app_initialize()` (registers the board lower half via `boardctl`)

**So**:

```
open/read("/dev/foo")
  → VFS → generic upper half → ops callback → board lower half → the real MMIO
```

**Reversing only `drivers/foo.c` will very likely miss the code that actually touches registers.**

## Decision tree

```
Given a NuttX target
├─ First classify the build model: FLAT / PROTECTED / KERNEL
│    ├─ Look for a user blob, MPU/MMU use, and a pile of very short syscall wrappers
│    └─ A wrong call here → every later address and call semantic is wrong
├─ You see a very short API wrapper + an immediate trap
│    └─ PROTECTED auto-generated proxy (syscall.csv → mksyscalls), not a hook
├─ A memory-related fault
│    ├─ Separate malloc / kmalloc and user heap / kernel heap
│    ├─ Under PROTECTED the default may be a single shared heap; a kernel-only heap exists only after MM_KERNEL_HEAP is enabled
│    └─ An address the "user cannot access" may simply have come from the kernel heap
├─ You cannot find the code that operates the hardware
│    └─ Walk the two layers, upper half → lower half: drivers/ is the generic layer; the real MMIO is in arch/ or boards/
└─ Timing / initialization
     └─ Separate drivers_early_initialize / drivers_initialize / board_app_initialize
```

## Tools and verification

- Build model: whether a user blob exists, MPU/MMU configuration, syscall proxies and auto-generated stubs
- Heaps: `up_allocate_heap()` / `up_allocate_kheap()` and the related Kconfig options
- Drivers: the binding between the upper half (`drivers/`, registration interfaces) and the lower half (`arch/`, `boards/`, the hardware implementation)
- Verification: you can state together "build model + whether this API is a direct call or a syscall proxy + which heap / which address space the address belongs to"

## Pitfalls on this platform (summary)

- **Not classifying FLAT/PROTECTED/KERNEL first**: the same API's artifact and address semantics are completely different
- **Treating a syscall proxy as the real implementation**: under PROTECTED the user-side API is two or three auto-generated instructions plus a trap
- **Calling the proxy a hook / libc anomaly**: that is the design
- **Ignoring the dual heap**: an address the user cannot access may come from the kernel heap, not heap corruption
- **Assuming every build has a kernel heap**: `MM_KERNEL_HEAP` defaults off under flat
- **Looking for hardware operations by reversing only `drivers/`**: the real MMIO is usually in the lower half under `arch/` or `boards/`
- **Ignoring board binding logic**: the instance is created by board code and bound to the generic upper half
- **Mixing up driver initialization stages**: early / drivers / board have different facilities available

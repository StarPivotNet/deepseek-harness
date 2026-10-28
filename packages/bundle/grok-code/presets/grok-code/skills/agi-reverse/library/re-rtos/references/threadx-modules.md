# ThreadX Modules: module preamble / dispatch request ID / XIP

<CORE RULE>
An API call inside a module **may not be an ordinary API call at all**:

```
Module
  → a predefined request ID
  → a software dispatch function
  → the resident Module Manager
  → the real ThreadX service
```

So inside a module you see:

```
mov  request_id, #37
branch common_dispatch
```

**Do not call it "a large amount of functionality was obfuscated by one strange dispatcher"** — it is very likely the ThreadX Module ABI. What you actually recover is the **request ID → service name** map (essentially close to a syscall table).
</CORE RULE>

## 1. Module Manager: one resident copy

- The Module Manager is **a single resident copy of code**, responsible for creating the module's initial thread, starting its execution, and **accepting every ThreadX API request the module issues**
- Source files are named `txm_module_manager_*`; module-side files do not carry "manager" (for example `txm_thread_relinquish.c`) and share `txm_module.h`
- Composition: module loader (load / relocate / prepare), **API dispatch**, memory management, thread management
- There is **no upper bound** on how many modules are loaded at once (limited by available memory), but **there is only one Module Manager**

## 2. Module preamble: it must be at the module's first address

The layout is fixed:

```
[module preamble][module instruction area][module RAM area]
```

The preamble describes the module's basic characteristics and resources:

| Contents | Meaning |
|---|---|
| module ID / major and minor version / preamble size | identity and format version |
| **properties bitmap** | see below |
| shell entry | the module shell entry point |
| start / stop thread entry | the module's main thread entry |
| start / stop thread priority and stack size | thread configuration |
| callback thread entry / priority / stack size | callback-thread configuration |
| code size / data size | region sizes |

**Properties bitmap (each bit means something different)**:

- **bit 0**: privileged mode vs user mode (**user mode = MMU protection**)
- **bit 1**: no MPU protection vs MPU protection (**MPU protection requires user mode**)
- **bit 2**: the switch for shared / external memory access
- **bits 31–24**: compiler ID (distinguishes toolchains such as IAR / ARM / GNU)

Field offsets developers often change (for example module ID at `0x10`, the start thread at `0x1C`, priority at `0x24`, stack size at `0x28`) must be checked on the sample across versions / toolchains; **do not copy them across versions**.

A module must also be **built with position-independent code / data (PIC/PID)** so it can execute from an arbitrary memory region.

## 3. Request ID and software dispatch

A module calls ThreadX through the `txm_*` API variants, for example:

```
(_txm_module_kernel_call_dispatcher)(TXM_THREAD_RELINQUISH_CALL, 0, 0, 0);
```

- The Module Manager supplies that function pointer; it calls the Module Manager's dispatch function with the **ID** of some service, and the dispatch function executes the **real API**
- Defining `TXM_MODULE` in the module sources **remaps** ThreadX API calls onto these module-specific versions
- **On ARM an unprivileged module uses the SVC instruction to enter kernel (privileged) mode to execute the API**; if the preamble configures the module as privileged, it **may call the API directly, with no trap**

**RE spine**: collect the dispatch call sites and **build a request ID → service name map**; only then is the rest of the module code readable.

## 4. Load method and XIP

- A module's **instruction area can execute in place (XIP), or be copied into the module memory area and then executed**; **the module's data-memory requirement is always allocated from the module memory area**
- So you can see:

```
The code address is entirely outside the module RAM allocation
  → not necessarily control-flow hijacking
  → it may only be an XIP module (code still in Flash, data in RAM)
```

- The only hard requirement is still: **the preamble is always at the module's first address**
- Load flow: allocate memory → check integrity → process the preamble → relocate code and data → initialize → create the module thread → start

## 5. Two details of threads and stacks

- Each module provides **one thread entry** plus its stack size / priority / module ID, and a callback thread's stack size / priority
- **A module thread executing in memory-protected kernel mode uses another kernel stack** (given by the port configuration)
- **The top of a module thread's stack holds a thread-entry information structure** (of the `TXM_MODULE_THREAD_ENTRY_INFO` class) — **stack-usage accounting must include it**, or you will misread a stack overflow
- A module has full ThreadX API access, including creating more threads inside the module

## 6. Memory protection is optional

When it is enabled, **only that module's threads can access its code and data memory**; any out-of-bounds access causes a memory fault and **terminates the offending thread**. So "some thread was silently terminated" may come from here, not from a watchdog.

## Decision tree

```
Given a ThreadX Modules target
├─ Locate the module preamble first (it is necessarily at the module's first address)
│    ├─ Read properties: privileged/user mode, MPU protection, shared memory, compiler ID
│    └─ Read thread entry / priority / stack size and code / data size
├─ You see many "fill in a request ID → jump to a common dispatcher"
│    └─ This is the Module ABI; build a request ID → service name map; do not call it obfuscation
├─ The code address is outside the module memory area
│    └─ Consider XIP first (instructions in Flash, data in RAM)
├─ A thread terminates abnormally
│    ├─ Check whether an out-of-bounds access raised a memory-protection fault
│    └─ Check whether stack-usage accounting included the entry-info structure at the top of the stack
└─ How the thread enters kernel mode
     ├─ Unprivileged module → the API runs only after an SVC trap
     └─ Privileged module → a direct call, no trap
```

## Tools and verification

- Preamble: parse it field by field (including the properties bits and the compiler ID), and use it to locate the instruction area and the data area
- API path: `txm_*` call sites and the dispatch function, and where request-ID constants are distributed
- Load method: distinguish XIP from copy-load (the relationship between code addresses and the module memory area)
- Verification: you can state together "how the module was loaded (XIP/copy) + how APIs come in (dispatch ID) + whether protection is on and which kind"

## Pitfalls on this platform (summary)

- **Treating request ID + a common dispatcher as control-flow obfuscation**: that is the normal shape of the Module ABI
- **Forgetting the preamble must be at the first address**: without it, instruction-area / data-area boundaries are hard to locate
- **Copying preamble field offsets across versions**: they change with version and toolchain
- **Treating an XIP module's code address as control-flow hijacking**: the instruction area can stay in Flash
- **Ignoring the properties bits**: privileged/user mode and the MPU switch decide whether the API goes through an SVC trap
- **Leaving the thread-entry information structure at the top of the stack out of stack-usage accounting**: you will misread a stack overflow
- **Blaming "the thread was terminated" on a watchdog**: a memory-protection fault also terminates the thread
- **Assuming there can be only one module**: the module count is limited by memory; what is resident as a single copy is the Module Manager

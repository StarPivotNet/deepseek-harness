# Zephyr: compile-time device graph / iterable sections / LLEXT

<CORE RULE>
**A large share of Zephyr "runtime objects" were in fact generated at compile time by Kconfig + devicetree + the linker.**

```
driver_init()   ← 0 direct xrefs
```

**This is not a dead function.** It may have been registered into the system by `DEVICE_DEFINE` / `SYS_INIT` / an iterable section — **the reference is established at link time, not in the source**.

So the first judgment is: **see whether it was "registered" in, then talk about whether it is reachable.**
</CORE RULE>

## 1. A device is not "registered"; it is "linked in"

- `DEVICE_DEFINE` (base) / `DEVICE_DT_DEFINE` (devicetree-aware, single instance) / `DEVICE_DT_INST_DEFINE` (instantiated driver, with `DT_DRV_COMPAT`) place device metadata into a **dedicated linker section**, which the kernel **walks as a whole** at startup
- Historically devices and `SYS_INIT` shared one init infrastructure, and **they were later split**: devices enter their own section, but they keep the same init levels
- Within one level, **devices are initialized first, then `SYS_INIT` calls run**; order is guaranteed by linker sorting
- The order in which the kernel iterates sections is **deterministic** — so "init order" in Zephyr is derivable, not a runtime accident

**RE meaning**: when a `struct device` instance is referenced by no code, **first find which section it landed in**, rather than marking it dead data.

## 2. `SYS_INIT`: a registration-style entry, and **the return value has consequences**

- Shape: `SYS_INIT(func, level, prio)`, function signature `int (*)(const struct device *dev)`
- Levels: **`PRE_KERNEL_1` → `PRE_KERNEL_2` → `POST_KERNEL` → `APPLICATION`** (SMP has corresponding extra levels); `prio` decides order **within the same level** (a smaller number runs first)
- **`PRE_KERNEL_1` / `PRE_KERNEL_2` run in kernel-initialization context (the interrupt stack)**; the other levels run in the kernel's main task
- **A non-zero return (an error code) can fail boot** — when analyzing "why it does not come up", this is a path to check one by one, not a reason to suspect hardware first

## 3. Iterable sections: do not treat a registry as an obfuscation table

Zephyr iterable sections put **instances of the same structure into a contiguous linker section** and walk them together at runtime; **entries are even sorted by name**.

So when you see the following, **do not casually call it a vtable / jump table / obfuscation table**:

- A whole run of **regularly arranged** function pointers or structures
- Entries **ordered by name**, with identical field layouts
- A count that exactly equals a value some Kconfig option can compute

**Assume first that it is a linker-generated registry**, check it in the build products (map file, section names), then conclude.

## 4. Semantic constraint of init levels: the "missing behavior" of early init is by design

During `PRE_KERNEL_1` / `PRE_KERNEL_2`, **kernel services are not yet usable in the normal way**. Therefore:

```
In early init: no mutex / thread / sleep calls; only IRQ / MMIO setup
```

**This matches the design**. It is not "the code was stripped" or "missing synchronization, therefore a vulnerability".

**The converse is the anomaly**: if early init contains calls that create a thread, take a mutex, or sleep, **first suspect the stage was classified wrong** (it may not be early init), rather than calling it "a violation of the contract" first.

## 5. When recovering a devicetree: `/chosen` and `/aliases` are not hardware

- `/chosen` and `/aliases` **are not hardware nodes themselves**; they are only **references / selections of other nodes** (plus boot-parameter-class information)
- So when reversing a DT **you must not create a fake device node "chosen"** — that turns a "reference" into an "entity", and every later inference that depends on it goes wrong with it
- Likewise, a node with `status = "disabled"` **still exists in the DT**: **"it is in the DT" ≠ "it was compiled into the device graph"**; judge from the node's actual references and the build configuration

## 6. The map file is this domain's "substitute for cross-references"

**The most direct evidence for device / init membership is the build product**:

- Searching section names such as `__init_PRE_KERNEL` / `__init_POST_KERNEL` in `build/zephyr/zephyr.map` shows directly **who landed in which init section**
- The same check covers members and order of the device section and iterable sections

**The RE spine is therefore**: source symbols are only clues; **membership questions are always decided by the linker section / map file**.

## 7. LLEXT: an ELF extension loaded at runtime, but not a Linux `.ko`

Modern Zephyr supports runtime-loaded ELF extensions (**Linkable Loadable EXtensions**):

- An extension is a **precompiled ELF executable**, which can be verified, loaded, linked with the main image, and later unloaded
- It has **its own export symbol table**; architecture support is limited (not every architecture can use it)
- Load: `llext_load(loader, name, &ext, ldr_parm)` returns `struct llext` or a negative error code; the loader may be a buffer implementation and similar
- Initialization: `llext_bringup` (calls `.preinit_array` / `.init_array`), `llext_teardown` (cleanup), `llext_bootstrap` (both, and it can be paired with `k_thread_create`)
- **After `llext_unload`, every symbol pointer previously obtained is invalid** — "the pointer still works after unload" is wrong
- Two symbol tables must be kept apart: **`sym_tab`** (every global symbol inside the extension, for internal linking) and **`exp_tab`** (symbols the extension **exports**, for the main image to look up; the macro is `LL_EXTENSION_SYMBOL`); lookup uses `llext_find_sym(table, name)`; **passing a NULL table means look up the main image's symbol table**
- The main-image side has a dedicated LLEXT symbol table (one name→address entry per exported symbol). Turning on **SLID** (replacing the name with a pointer-width hash) speeds lookup and shrinks the table, but **the main image and the extension must use the same setting** — a mismatch shows up as "symbol not found"

**The special case most worth remembering**:

```
The extension loaded successfully, and the kernel can call it
but a user thread faults as soon as it touches it
```

If **User Mode** is enabled, first check whether **the extension was never added to the corresponding memory domain** — an extension **belongs to no user memory domain by default**, and you must explicitly call `llext_add_domain(ext, domain)` to add the extension's memory regions to a `k_mem_domain`; when User Mode is not enabled that function returns `-ENOSYS`.

## Decision tree

```
Given a Zephyr target
├─ Some init/device function has no direct xref
│    ├─ Check whether it was registered by DEVICE_DEFINE / DEVICE_DT_DEFINE / SYS_INIT
│    ├─ Check which linker section it landed in (map file / __init_* section names)
│    └─ Do not mark it dead code
├─ A whole run of regularly arranged structures / function pointers
│    ├─ Understand it first as an iterable section / registry
│    └─ Check it against the map and section names, then consider vtable / jump table / obfuscation
├─ Early init calls no kernel services
│    └─ That matches the PRE_KERNEL_* design constraint; it was not stripped
│    (Conversely: a thread / mutex / sleep inside early init → first suspect the stage was classified wrong)
├─ Recovering a devicetree
│    ├─ /chosen and /aliases are references; do not build a fake device node
│    └─ A disabled node is still in the DT: in the DT ≠ in the device graph
└─ LLEXT
     ├─ Load / link failure → symbol tables (sym_tab/exp_tab), whether the SLID setting matches the main image, whether the architecture is supported
     ├─ The kernel can call it, a user thread faults → check whether llext_add_domain added it to a memory domain
     └─ Pointers going invalid after unload is expected, not a UAF
```

## Tools and verification

- Membership and order: search `zephyr.map` in the build products for `__init_PRE_KERNEL*` / `__init_POST_KERNEL*` and device section names
- Configuration: Kconfig (decides which objects get generated) + devicetree (decides whether nodes and instances exist)
- Debug: raise the log level on the LLEXT side; symbolize with a symbol file plus the correct load offset (usually the start of `.text`)
- Verification: you can state together "object origin (source / linker-generated / runtime extension) + which section or init level it belongs to + whether it entered the device graph"

## Pitfalls on this platform (summary)

- **Treating an init/device object with no xref as dead code**: they are registered by a linker section; the reference is established at link time
- **Treating a regularly arranged registry as a vtable / jump table / obfuscation table**: iterable-section entries are contiguous and sorted by name by design
- **Treating early init's "does not call kernel services" as stripping or a defect**: during `PRE_KERNEL_1` / `PRE_KERNEL_2` those services are not yet available; that matches the design
- **Missing the converse**: a thread / mutex / sleep inside early init — first suspect "this is not early init at all"
- **Inventing hardware device nodes for `/chosen` and `/aliases`**: they are only references, not entities
- **Assuming a node that is in the DT necessarily takes effect**: a node with `status = "disabled"` is still in the DT; whether it entered the device graph depends on the build and on references
- **Replacing a linker-membership decision with the source call graph**: order and membership should be decided in the section / map file
- **Treating LLEXT as a Linux `.ko`**: it is an ELF extension, with its own export symbol table, architecture limits, and init-array semantics
- **Assuming a successful LLEXT load means user mode can use it**: an extension belongs to no user memory domain by default; it needs `llext_add_domain`
- **Continuing to use old symbol pointers after unloading the extension**: after `llext_unload` those pointers are all invalid
- **A symbol-lookup setting mismatch between the main image and the extension (such as SLID)**: it shows up as a mysterious "symbol not found"

# RTEMS: single address space / build-time configuration / runtime linker

<CORE RULE>
RTEMS has three special properties:

| Property | Consequence |
|---|---|
| **Single address space** | OS, libraries, and application can be treated as **one process**; there is no "each process has its own set of mappings" |
| **Many structures are generated at build time by configuration macros** | Task count, scheduler, drivers, clock tick, and the initialization task come from `CONFIGURE_*` macros in `confdefs.h` |
| **`dlopen()` is not the Unix dynamic-library model** | The runtime linker is closer to **linking a relocatable object into the current system address space**, not loading a shared library |

The third one misleads especially easily — **seeing `dlopen` and applying the ELF `DT_NEEDED` / shared-library namespace model produces a whole set of wrong conclusions**.
</CORE RULE>

## 1. What a single address space means

- There is no room for runtime code sharing ("on RTEMS there is nothing that needs to be shared"), so **loading code is closer to a static absolute link** than to a Unix shared library
- Loadable objects are compiled as **position-independent code**, **relocated into the target address space** at load time, and the address is **fixed at load**
- **Execution performance is close to the same code linked statically** — do not explain a performance observation with priors such as "a dynamic-library call has PLT/GOT overhead"
- The base image (the statically linked executable that runs after reset) contains: the base application, a **global symbol table**, and the referenced OS / library code

## 2. `confdefs.h`: configuration is generation

`<rtems/confdefs.h>` is a **configuration-table template**, instantiated by a set of `CONFIGURE_*` macros:

- **`CONFIGURE_INIT` must be defined in exactly one source file** (otherwise the configuration data structures are instantiated more than once → link errors). This is a useful criterion: **finding the configuration instantiation point means finding the translation unit that defines `CONFIGURE_INIT`**
- It works by **estimating** the memory each configuration item needs and summing, to compute `work_space_size` — **the estimate can be high or low** (for example, device-driver requirements and resources of add-on libraries are not counted)
- The device-driver count is computed automatically from **the number of entries in the device-driver table**: that table is **conventionally named `Device_drivers`**; if the application supplies its own driver table it must define `CONFIGURE_HAS_OWN_DEVICE_DRIVER_TABLE`
- Related capacity macros: maximum driver count / maximum device count; console, clock, timer, RTC, stub, and similar drivers are pulled in through `CONFIGURE_APPLICATION_NEEDS_*_DRIVER`
- **Network drivers are not configured in the device-driver table** — "no network driver in the driver table" is not a missing piece

## 3. Device model: driver address table + major/minor

The core structure is the `rtems_driver_address_table` array. Each entry has **six slots**:

```
initialization_entry  open_entry  close_entry  read_entry  write_entry  control_entry
```

- **The major number is the index into this table**; the **minor number** identifies a concrete device within the same device class (the same driver, or different drivers, can serve minor 0/1)
- `rtems_io_register_name(name, major, minor)` associates `(major, minor)` with a file name (for example `/dev/ttyS0`), usually called during minor-level initialization
- Startup path: `boot_card` → `rtems_initialize_device_drivers` → `_IO_Initialize_all_drivers` → `rtems_io_initialize` → each driver's `initialization_entry`
- Empty entries of the form `NULL_DRIVER_TABLE_ENTRY` in the table are placeholders / fallbacks

**So what you recover is**:

```
Device Driver Table → major (table index) → callback functions
```

**Not** Linux `file_operations`. The I/O manager dispatches by the driver table; **the semantic "major number is a table subscript" does not exist on the Linux side at all**.

## 4. Special semantics of `dlopen()` (each one has an analysis consequence)

The runtime linker runs on the target and, through `<dlfcn.h>`, provides `dlopen` / `dlclose` / `dlsym` / `dlinfo` / `dlerror`. It can load an **ELF relocatable object file** and resolve its external function / data symbols. But:

- **The object file can be a standalone file or a member of a static library (archive)**, using RTEMS's own encoding: **`libfoo.a:bar.o`**, with an optional `@offset` after the member name (the absolute offset of the object inside the archive); an offset avoids the cost of searching the archive. **This encoding is RTEMS-specific** — Unix shared-library naming habits cannot explain it
- **`RTLD_LAZY` and `RTLD_NOW` behave the same: all relocation is finished before `dlopen` returns**. So the inference "lazy binding resolves only on the first call" does not hold here
- **An unresolved symbol does not make `dlopen` fail** (so mutually dependent objects can be loaded as a pair); unresolved items can be read with `dlinfo(handle, RTLD_DI_UNRESOLVED, ...)`. Therefore **`dlopen` success ≠ every symbol of that object is ready**
- **A symbol that collides with the base image or with a previously loaded object is treated as an error, and that object is not loaded**; **symbol versions are not supported**
- A repeated `dlopen` of the same object only bumps the reference count; **only one copy stays in the address space** (even if the path names differ)
- `dlopen(NULL, ...)` returns a handle to the global symbol table covering "the base image + objects loaded with `RTLD_GLOBAL` and their dependencies"
- `dlclose` unloads when the reference count hits zero; **it cannot unload if symbols it provides are still referenced by other resident objects**; an object that was not explicitly loaded and has no references is removed automatically. Initializers run in **load order** before `dlopen` returns
- **The base image itself has no symbol table**: use `rtems-syms` to extract global / weak symbols from the base image, generate a symbol-table object, then **embed it in the base image (link twice) or load it first at runtime**. **The symbol table must match the base image, and there is no check** — the wrong symbol table is a silent error
- A loaded object must be **the target architecture, the same ABI flags as the base image**, and **bound to the RTEMS version**; `rtems-execinfo` can report the build flags
- **Dynamic loading is not treated as a real-time activity**: it should happen while the system is stable, not in response to a real-time event; its memory cost is higher than static linking, and the load address depends on load order and the allocator

## Decision tree

```
Given an RTEMS target
├─ Confirm first: single address space (OS / libraries / application share it)
│    └─ Do not interpret addresses or visibility as "per-process independent mappings"
├─ Find the configuration
│    ├─ Find the one translation unit that defines CONFIGURE_INIT → the configuration instantiation point
│    ├─ Recover from CONFIGURE_* macros: task count, scheduler, clock tick, initialization task, driver capacity
│    └─ The driver table is conventionally named Device_drivers (or CONFIGURE_HAS_OWN_DEVICE_DRIVER_TABLE is defined when it is custom)
├─ Find devices
│    ├─ Walk rtems_driver_address_table: major = table index → six callbacks
│    ├─ File-name association is rtems_io_register_name(name, major, minor)
│    └─ Do not apply Linux file_operations; network drivers are not in the driver table
└─ You see dlopen
     ├─ Do not apply the Unix shared-library model: it is "relocate into the current address space", close to a static absolute link
     ├─ The object may be an archive member (libfoo.a:bar.o[@offset])
     ├─ Lazy vs immediate binding makes no difference: relocation is finished before return
     ├─ dlopen success ≠ symbols are ready (unresolved symbols are not an error; check with dlinfo)
     └─ The base image has no symbol table → rtems-syms must generate one and it must match that image (no check)
```

## Tools and verification

- Configuration: `confdefs.h` and where it is instantiated (the file that contains `CONFIGURE_INIT`)
- Devices: the device-driver table (conventional name `Device_drivers`), and the association of `major` / `minor` with `rtems_io_register_name`
- Loadable objects: `rtems-syms` (generate a symbol table that matches the base image), `rtems-execinfo` (view the ELF build flags)
- Runtime: the unresolved-relocation report from `dlinfo` (`RTLD_DI_UNRESOLVED`)
- Verification: you can state together "configuration source (which macro / which table) + device dispatch path (major index) + where a loadable object's symbols come from and whether they match"

## Pitfalls on this platform (summary)

- **Reading `dlopen()` as Unix dynamic-library loading**: it relocates a relocatable object into the current address space, closer to static linking
- **Explaining behavior with shared-library namespaces, `DT_NEEDED`, and symbol versions**: RTEMS does not support symbol versions; a duplicate symbol is simply an error
- **Assuming lazy binding defers resolution**: `RTLD_LAZY` and `RTLD_NOW` behave the same; all relocation finishes before return
- **Treating `dlopen` success as "every symbol is ready"**: unresolved symbols do not cause failure; query them separately
- **Not understanding an object name like `libfoo.a:bar.o`**: that is RTEMS's own archive-member encoding (an offset is allowed)
- **Looking for device callbacks with the Linux `file_operations` model**: recover the device-driver table and major (table index) / minor
- **Looking for a network driver in the device-driver table**: network drivers are not configured in that table
- **Ignoring uniqueness of `CONFIGURE_INIT`**: it must be defined in only one source file, and that is also the clue to the configuration instantiation point
- **Treating a configuration estimate as an exact memory requirement**: `confdefs.h` estimates, and device-driver and add-on-library resources are outside its calculation
- **Assuming the base image ships its own symbol table**: a statically linked base image does not; `rtems-syms` must generate one and it must match (a mismatch is not reported)

# NetBSD: on-demand module autoload / compatibility constraints / module-path layout

<CORE RULE>
NetBSD's loader looks a lot like Linux, but the module model differs: **the kernel can load a module automatically when it needs it**.

So the scene can look like this:

```
no modload
no obvious startup script
but xyz.kmod suddenly entered the kernel
```

**There is not necessarily a hidden loader** — it may only be:

```
an operation request → the kernel module subsystem loads on demand (dependencies are pulled in recursively)
```

That matters for **timeline reversing**: the moment a module appears corresponds to **some operation**, not to some process.
</CORE RULE>

## 1. On-demand load and automatic unload

- Kernel components use `module_autoload(name, class)` to locate and load optional system components (also used to load dependencies other modules need)
- **Typical trigger**: the first mount of a filesystem class automatically brings in the matching module
- **Automatic unload**: an autoloaded module is marked eligible for automatic unload — a kernel thread tries to unload it shortly after load (about 10 seconds in the current implementation), via `MODULE_CMD_AUTOUNLOAD`, and **the module may return non-zero to refuse**
- If `kern.module.autounload_unsafe` is set, a module that returns `ENOTTY` (meaning it was not audited as safe to autounload) **may also be unloaded automatically**
- The **`noautoload` property** (set true in the same-named `.plist`) makes the system **refuse to load** that module
- **A module loaded by hand with modload is never automatically unloaded**

## 2. Compatibility: a module matches only a specific kernel version

- The loader checks module version against `__NetBSD_Version__`; on mismatch it prints a warning like
  `module 'X' built for 'N', system 'M'`
- **Without the force flag the load fails** (`EPROGMISMATCH`)
- **`MODCTL_LOAD_FORCE` (`modload -f`) forces the load** and records `forced load, system may be unstable` — **this is a path the project explicitly warns about**; an incompatible module can corrupt data or crash
- The same flag can also force a reload of a **disabled built-in module**: unloading a built-in marks it disabled, and afterwards **only a forced load can bring it back**
- `MODCTL_NO_PROP` skips locating the module's `.plist` property dictionary (by default the same-named `.plist` is found and its properties merged)

**So**:

```
the module ELF looks fine, the symbols are there, and load still fails
  → check exact kernel version/build and module compatibility first
  → do not suspect the loader or file corruption first
```

## 3. Where modules live: the path is not a permanent contract

- Traditional layout: kernel at `/netbsd`, debug kernel `/netbsd.gdb`, modules at `/stand/<arch>/<version>/modules/`
- **Since 2025-04-28 (UPDATING 20250427) there is a build option `KERNEL_DIR`**: it puts **the kernel, its debug kernel, and the kernel modules in one directory named after the kernel** —

```
old: /netbsd (kernel), /netbsd.gdb, /stand/amd64/<version>/modules
new: /netbsd/kernel, /netbsd/kernel.gdb, /netbsd/modules
```

- The option **applies only to i386 and amd64**, and is **entirely optional** (one machine can have either layout)
- **It needs an updated third-stage bootloader** (GPT/EFI boot needs the boot program on the EFI partition updated); the bootloader tries `/netbsd/kernel`, `/onetbsd/kernel`, `/netbsd.old/kernel` in order
- Known issue: with `KERNEL_DIR` set but the kernel still stored as a file at `/netbsd`, `dmesg` reports a wrong `kern.module.path`

**RE / forensics meaning**: **tools that hard-code `/stand/...` will start missing samples**; "where is the module" should be read from the runtime report (`kern.module.path`) or probed in both layouts.

## 4. Other field constraints

- **A common cause of a MODULAR kernel failing to boot is a missing module or a bootloader that cannot load it**; the symptom can look like `Cannot mount root, error 79` — do not treat that as disk / kernel corruption first
- **The limit on module load**: a module becomes part of the kernel; loading a new module is allowed only when **securelevel ≤ 0** or the kernel was built with `INSECURE`

## Decision tree

```
Got a NetBSD target
├─ a module "appeared by itself"
│    └─ explain it as on-demand module autoload first (including recursive dependencies), and align it to the operation that triggered it
├─ a module disappeared
│    └─ check automatic unload (the attempt about 10 seconds later) or noautoload / disabled state
├─ load failed but the file looks fine
│    ├─ check exact kernel version/build and compatibility
│    └─ do not jump to -f / forced load (the project warns of instability / data corruption)
├─ the module file cannot be found
│    ├─ read the runtime module-path report
│    └─ probe both layouts: /stand/<arch>/<ver>/modules and <kernel>/modules
└─ boot failure
     └─ check missing modules / whether the bootloader can load them before blaming the kernel or the disk
```

## Tools and verification

- Module subsystem: the modctl family of tools (load / unload / query) and the module's `.plist` properties
- Path and layout: the runtime module-path report, directory probes of both layouts, and the bootloader search order
- Compatibility: compare the module version report with the kernel version report
- Verification: be able to state together "why the module appeared / disappeared (autoload or autounload vs manual) + version-compatibility state + actual path layout"

## Pitfalls on this platform

- **No explicit load action, so the module was not loaded**: it may be on-demand autoload (including recursive dependencies)
- **Treating automatic unload as "the module was maliciously removed"**: an autoloaded module is attempted for unload, and the module itself can refuse
- **Ignoring `.plist` `noautoload`**: that makes the system refuse the load; it is not file corruption
- **Load failure, so patch the loader / the module**: check kernel version and compatibility first
- **Casually forcing with `-f`**: the project explicitly warns that an incompatible module can corrupt data or crash
- **Assuming an unloaded built-in module is gone**: it is only marked disabled, and still needs force to load again
- **Hard-coding `/stand/<arch>/<version>/modules`**: the new layout puts modules under the kernel directory, and samples will be missed
- **Treating boot failure as kernel / disk corruption**: check missing modules and bootloader load capability first

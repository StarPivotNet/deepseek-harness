# Linux kernel-module branch (.ko / LKM / the running kernel)

<CORE RULE>
**Three don'ts**:
① do not treat a `.ko` as an ordinary ELF program (it is ET_REL; relocation is the main line);
② do not treat **the code on disk** as the absolute truth of the running state (relocation, KASLR, alternatives, jump labels, ftrace / livepatch / paravirt patching, and init-section release all make the two differ);
③ after you suspect a rootkit, **do not trust a single enumeration produced by that kernel itself**.

What makes Linux harder than seL4 is exactly this: **a large number of things that "look tampered with" are actually the kernel's legal dynamic-patching mechanisms**. Not knowing `__ex_table`, jump labels, livepatch, ftrace, BTF, MODVERSIONS, and init release produces a lot of factual misreads.
</CORE RULE>

## 1. First decide what you actually have

| Target | Nature and handling |
|---|---|
| `vmlinux` | a complete ELF (best to analyze; symbols / types / sections are all there) |
| `bzImage` / `Image` / `zImage` | **a boot image, not an ELF you can analyze directly** |
| `*.ko` | a loadable module, usually **ET_REL** |
| `*.ko.xz` / `*.ko.zst` | a compressed module (the loader has a decompress stage; it is not a packer) |
| built-in driver | there is simply no independent runtime `.ko` |
| livepatch module | a special ELF (dedicated sections; see §14) |
| eBPF object | it also looks like an ELF, but **the model is completely different** |
| runtime memory image | the running state (relocations applied, init sections released) |

- An x86 **bzImage is itself a compressed boot image**: dropping it into IDA / Ghidra shows a boot stub, a lot of 16-bit code, and then something that will not identify — **that is not "the kernel was obfuscated"**. The normal path: identify architecture / boot format → **extract the real kernel image** → get a vmlinux-style ELF or a raw Image → then recover symbols / types
- A modern kernel supports module decompression (`.ko.xz` / `.ko.zst`): inside the loader flow, `kernel_read_file → module decompress → ELF processing` is an **independent stage**; a system report of `failed_decompress` is checked as a compression algorithm / file corruption first, not as a symbol dependency

## 2. A `.ko` is not a shared library: relocation comes first

- The core property of a `.ko` is **ELF ET_REL** (not ET_EXEC / ET_DYN) — **relocation is the reversing main line**
- Information-value order for a stripped module (it is not "no symbols, so you can only grind the assembly"):

```
relocations / imported symbols  →  modinfo  →  BTF/DWARF  →  kernel API call patterns  →  raw disassembly
```

- Example: the decompiler did not recover a function name, but `.rela.text` has `offset 0x183 / R_X86_64_PLT32 / symbol = pci_register_driver` — **that edge is in fact already recovered**. A stripped driver that still has imports such as `pci_register_driver`, `request_irq`, `dma_alloc_coherent`, `copy_from_user`, and `misc_register` already has a functional skeleton

## 3. Eat `.modinfo` first (absurdly cheap, and often skipped)

- Fields: `license` / `author` / `description` / `alias` / `depends` / `vermagic` / `srcversion` / `parm` / `firmware` / `retpoline` / `intree` / `livepatch`
- **`alias` states the device match directly**: `alias: pci:v00008086d0000....` → what device this is for; a lot of `alias: usb:...` → recover along `usb_driver` / `probe` / `disconnect` / `usb_control_msg` / `urb` first
- **built-in also has modinfo**: `modules.builtin.modinfo` (fields are prefixed with the module name); newer builds also generate `modules.builtin.ranges` (`CONFIG_BUILTIN_MODULE_RANGES`) — it gives the address-offset range of a built-in module by ELF section, and together with `System.map` can associate a symbol back to a module name

## 4. "This .ko cannot be found" ≠ the logic is absent

- It may be `CONFIG_FOO=y` (linked into vmlinux) rather than `=m`
- Check: `modules.builtin` / `modules.builtin.modinfo` / kernel config / `System.map` / `vmlinux`
- A built-in driver can even accept a **kernel command-line parameter** (`foo.option=value`)

## 5. Code is on disk, not in memory → think `__init` release first

- After initialization the kernel **releases init-only memory** (`__init` / `__initdata` / `.init.text` / `.init.data`); after a module's init succeeds, the matching initialization memory is discarded the same way
- So not finding `foo_init` in a runtime dump **can be normal**
- This matters especially for memory forensics: if a rootkit's critical setup (`install_hook()` / `patch_table()` / `register_callback()`) is entirely on the `module_init()` path, the init code itself is gone after load, **but the callback / hook / patched pointer / persistent object it created is still there**
- So the question for runtime reversing is not "where is the malicious init function", but "**what state change did init finally leave behind**"

## 6. Module load failure: diagnose by stage, do not patch at random

The loader itself splits failure into stages (the official `CONFIG_MODULE_STATS` counters are divided the same way):

```
read (kernel_read_file_from_fd)
  → decompress (vmap decompress buffer)
  → early checks: module_sig_check (signature) / elf_validity_cache_copy (ELF check)
              / early_mod_check (blacklist, section-header rewrite, vermagic, livepatch requirements, already loaded)
  → layout_and_allocate (final placement)
  → symbol resolution → init
```

- Matching counters: `failed_kreads` / `failed_decompress` (the official comment: **this should not appear unless compress / decompress is broken**) / `failed_becoming` (failed after the read, before placement) / `failed_load_modules`; the debugfs `stats` file directly gives "Mods failed on kread / decompress / becoming / load"
- So `modprobe foo → Invalid module format` **must not be answered by editing vermagic the moment you see it** — it may be a bad ELF, a bad signature, a bad MODVERSIONS, a wrong architecture, or a bad livepatch format; judge from `dmesg` + `modinfo` + `readelf` together

## 7. The same vermagic ≠ the same ABI

- With `CONFIG_MODVERSIONS=y`, the kernel compresses an exported symbol's prototype into a **CRC**; a CRC mismatch refuses the load even when `uname -r` / vermagic look the same
- What has to match is: **release + config + build flags + `Module.symvers` + symbol CRC** (`Module.symvers` records every exported symbol and its CRC)
- **There are two format generations; do not hard-code the old parser**:
  - basic (`CONFIG_BASIC_MODVERSIONS`): an imported symbol's name+CRC lives in the module's `__versions` section, with a 64-byte symbol-name limit
  - extended (`CONFIG_EXTENDED_MODVERSIONS`): names are in `__version_ext_names` (consecutive NUL-terminated strings), CRCs are in `__version_ext_crcs`, and long symbol names are supported; at load the two are checked to be **both present or both absent**, and a mismatch reports `-ENOEXEC`
- Export side: `__ksymtab` / `__ksymtab_gpl` (names in `__ksymtab_strings`), CRCs in `__kcrctab` / `__kcrctab_gpl`

## 8. "Data at the end of the file that is not ELF": check the module signature first

- A Linux module signature is **appended directly after the ELF**: `ELF` + signature blob + `~Module signature appended~.`
- Seeing "the section table has ended but the file still has data" **must not be judged automatically** as an overlay / packer / malicious append — check the module signature first
- **Stripping after signing breaks the signature** (the project calls this kind of signature brittle: the whole module file is the signature payload) → to analyze a signed module: **keep the original → copy → strip / decompress / patch only the copy**

## 9. Stripped, but `.BTF` / `.BTF.ext` is present — it may actually be easier to reverse

- BTF gives: struct / union / enum / typedef / function prototypes / member offsets
- **`.BTF.ext`** also contains function info, line info, and **CO-RE relocations**
- So a stripped `.symtab` does not mean the type information is all gone: check `.BTF` / `.BTF.ext` first, then decide how to recover types

## 10. Type IDs inside `.BTF` are all wrong → check split BTF first

- A module's BTF can be **split BTF**: `vmlinux BTF` is the base, the module stores only new types, and a type ID can refer to the base
- Parsing the module `.BTF` alone and getting "type 38291 does not exist" **is not corruption**
- A newer external module may carry **`.BTF.base`**: it is used to relocate split-BTF references after the base BTF changes (what `btf__relocate()` is for)

```
.BTF
├── standalone → parse directly
└── split → find the matching vmlinux BTF
        └── if .BTF.base is present → relocate, then parse
```

## 11. A struct offset does not match the source: check in order

① exact kernel build? ② does the BTF correspond? ③ are the CONFIG options the same? ④ **structure-layout randomization** (`CONFIG_GCC_PLUGIN_RANDSTRUCT`; this kind of kernel carries taint `T`) ⑤ a vendor patch?

**BTF / DWARF that came with the running kernel is more trustworthy than an offset from "source of the same version on the internet"** — it is not IDA being wrong, and it is not a calculation error.

## 12. Disk code ≠ memory instructions: rule out **legal dynamic patching** first (the most important rule in this branch)

The following mechanisms all make runtime bytes differ from disk, and **all of them are legal**:

| Mechanism | Behavior |
|---|---|
| **static keys / jump labels** | `nop` ↔ `jmp target` rewritten at runtime (an almost zero-cost branch) |
| **alternatives** | instructions replaced at boot by CPU feature / erratum |
| **paravirt** | `pv_ops` binary patching at boot, replacing a generic path with a native / hypervisor implementation |
| **ftrace** | function tracing itself modifies the execution path; the function graph tracer also handles the function return path |
| **livepatch** | really switches execution to the patched function (symbol lookup + relocation + registering patched functions) |
| **kprobes / fprobe** | dynamic instrumentation |

Decision chain:

```
runtime bytes != disk bytes
   → rule out alternatives / static keys / ftrace / livepatch / paravirt / breakpoints first
   → what remains is an unexplained modification
   → only then raise the rootkit suspicion
```

## 13. Seeing `.klp.*` is not a corrupted ELF (livepatch)

- Marks: `livepatch: Y` in `modinfo`; section `.klp.rela.<object>.<section>`; symbol `.klp.sym.<object>.<symbol>,<pos>`
- The special point: a livepatch needs to reference symbols that are **unexported global / local / inside a module that is not loaded yet** → they cannot all be resolved during ordinary module load
- So "the target driver does not exist right now" also **does not mean the livepatch is broken**: the matching relocation can be applied when the target module loads

## 14. `.orc_unwind` / `.orc_unwind_ip` is not a junk array

- They are **unwind metadata generated by objtool**, describing the stack state at each relevant instruction location, used for kernel stack unwinding — not encrypted data / a lookup table / a malicious blob
- Value for reversing: **function boundaries, stack state, exceptional control flow, unwindability**, which can help recover stripped code

## 15. `__ex_table` creates "invisible control flow"

```
faulting instruction → CPU exception → __ex_table lookup → fixup handler
```

- The CFG has no traditional `jmp fixup`, but after a page fault control really does transfer there (the official documentation uses `get_user()` to show the correspondence of faulting instruction ↔ `__ex_table` entry ↔ fixup code)
- When reversing low-level code near `copy_from_user` / `get_user` / `put_user` / `probe_kernel_read`, **the exception table must be treated as part of the CFG**
- Otherwise you see "this fixup code has no xref" → **and mislabel it dead code** (it is actually an exception edge)

## 16. A lot of x86 `ENDBR64` is not obfuscation

- When kernel IBT is enabled (`CONFIG_X86_KERNEL_IBT`), `endbr64` is **the legal marker of an indirect call / jump target**, and a function head of `endbr64; push rbp; ...` is normal
- The other way around, when **recovering function-pointer targets**, ENDBR can be an auxiliary signal

## 17. A function with no normal `call` xref is not necessarily uncalled

- Linux kernel function-pointer density is extremely high: `file_operations`, `net_device_ops`, `proto_ops`, `bus_type`, `device_driver`, irq callbacks, timer, workqueue, notifier, `security_hook_list`, `seq_operations`, `proc_ops`
- Real control flow is often `VFS → function pointer → foo_read`, and a static decompiler may not give a pretty call graph
- So: **recovering the callback-registration graph is often more important than recovering the ordinary call graph**. Follow registration sites first:

```
register_*() / *_register() / proc_create() / misc_register() / register_chrdev()
pci_register_driver() / usb_register() / netlink_kernel_create() / register_netdev()
request_irq() / queue_work()
```

Then work backward to "who calls these callbacks".

## 18. `kallsyms` addresses are all 0, and that is not necessarily a rootkit

- The system may have `kernel.kptr_restrict` on (it limits kernel-pointer exposure through `/proc` and similar interfaces)
- Seeing `0000000000000000 T some_kernel_symbol` → check `sysctl kernel.kptr_restrict` first, then analyze permissions and the kernel config, and **do not immediately judge "kallsyms was hooked"**

## 19. Addresses do not match the static vmlinux at all → KASLR

- Both the kernel text base and the module load base are randomized
- So `vmlinux: foo = 0xffffffff81012340` / `runtime: foo = 0xffffffff9ac12340` **cannot be judged "not the same kernel"** — recover the runtime slide first
- For dynamic debugging, `nokaslr` makes GDB addresses line up with vmlinux one to one

## 20. Not seeing it in `lsmod` does not mean the module is absent (widen the cross-view)

- The classic technique: **unlink** the module from the kernel module linked list → `/proc/modules` and `lsmod` both cannot see it, but the module is still working
- The old method was to cross `module list` against the `/sys/module` kset; **modern analysis must not depend on only those two views**. The comparison surface should widen to:

```
/proc/modules · /sys/module · module list · module_kset
kernel executable memory ranges · callback owner · symbol ranges · vmalloc/module address ranges
```

- The core: **after you suspect the kernel is already compromised, do not trust "a single enumeration produced by that kernel itself"** (offline memory / multi-view cross-check comes first)

## 21. "The syscall table is not hooked" also cannot rule out a rootkit

- Landing sites go far beyond `sys_call_table`: `file_operations`, `proc_ops`, `seq_operations`, `net_device` / `proto_ops`, ftrace, kprobe, inline text, **LSM hooks**, notifier, and timer / workqueue have all been used (a classic case changes both the syscall path and the operation structure used to display network information)
- The correct judgment is not "sys_call_table is clean → the kernel is clean", but:

```
a critical callback pointer → does it land in a normal vmlinux / module text range
                     → is the owner reasonable
                     → are the runtime bytes explainable
```

## 22. kprobe / ftrace can themselves make you misread a hook

- Dynamic forensics finds "the first few bytes of some function changed" → **confirm tracing first** (kprobes / kretprobes / fprobe / ftrace / tracepoints are all mechanisms the kernel officially supports)
- A complete inline-hook check cannot be only `runtime bytes != disk bytes → malware`; it has to explain: who changed it? legal tracing / livepatch / jump label / alternatives / paravirt? or unexplained?

## 23. When the behavior is intermittent, do not jump on a kprobe first

- If the problem is in an interrupt / NMI / locking / timing-sensitive race, **the instrumentation itself can change the timing**
- The more stable order: **an existing tracepoint → ftrace event → fprobe → kprobe → KGDB / QEMU breakpoint** (an existing tracepoint is a static typed probe point, designed for observation in the first place)
- "The bug disappeared after the probe was added" **does not necessarily mean the bug is gone** — the observation may only have changed the timing
- Also, fprobe and kprobes do not have exactly the same recursion semantics; a callback in interrupt context can nest

## Overall decision tree

```
Got a Linux kernel / module sample
├─ identify the artifact first: vmlinux / bzImage(Image) / .ko / compressed .ko / built-in / livepatch / runtime dump
├─ is it a module?
│    ├─ modinfo (alias → device; built-in also has modules.builtin.modinfo / .ranges)
│    ├─ ELF sections / relocations / imported + exported symbols
│    ├─ MODVERSIONS (basic __versions / extended __version_ext_*)
│    └─ BTF (standalone, or split + .BTF.base)
├─ the code cannot be found?
│    ├─ built-in? __init already released? stripped? split BTF? runtime relocation?
├─ addresses do not match?
│    ├─ KASLR (kernel text + module base) → recover the slide
├─ runtime bytes != disk bytes?
│    ├─ alternatives / static key jump label / ftrace / livepatch / paravirt → legal
│    └─ an unexplained hook → raise the suspicion
├─ the CFG looks strange?
│    ├─ __ex_table (exception edge) / ORC unwind metadata / callbacks
│    ├─ IBT ENDBR / compiler optimization and inlining
├─ module load failed?
│    ├─ by stage: read → decompress → signature / ELF / blacklist / vermagic / livepatch → layout → symbols → init
│    └─ CONFIG_MODULE_STATS failed_kreads / decompress / becoming / load tells you which stage it stuck on
└─ suspect a rootkit?
     ├─ do not trust a single live view (widen the cross-view to kernel executable memory / callback owner / symbol ranges)
     ├─ module cross-view · callback ownership · code integrity
     └─ offline memory > userspace output from the infected system
```

## Tools and verification

- Identity and structure: `file` / `readelf -h` (confirm ET_REL and the artifact type), `readelf -S` (`.modinfo` / `.BTF` / `.BTF.ext` / `.BTF.base` / `.klp.*` / `.orc_unwind*` / `__ex_table` / `__versions` / `__version_ext_*`), `modinfo` (vermagic / dependencies / signature / livepatch / alias)
- Symbols and relocations: `nm`, `objdump -r` (the main clue in a stripped module), `Module.symvers` (exports and CRCs)
- Types: `pahole`, `bpftool btf dump file <ko>` (split BTF needs the base)
- Runtime: `/proc/kallsyms` (watch `kptr_restrict`), `/sys/module/<name>/sections/`, `/sys/module/<name>/`, `bpftrace` / `perf probe` (kprobe), `ftrace`, the module `stats` in debugfs
- Load-failure diagnosis: cross `dmesg` + `modinfo` + `readelf`, and use the `CONFIG_MODULE_STATS` counters to locate the stage
- Verification: for the target `.ko`, be able to give together "artifact / build identity (vermagic / CRC; KMI is unrelated but MODVERSIONS is related) + the functional skeleton inferred from imported symbols + an explanation of the disk-vs-runtime difference"

## Pitfalls on this platform

- **Analyzing a .ko as an ordinary ELF executable**: it is ET_REL; relocation is information, not noise
- **Dropping a bzImage into a decompiler and judging "the kernel was obfuscated"**: that is a boot stub + a compressed payload
- **Truncating / stripping a .ko that has a signature trailer in order to "fix" it**: that breaks the signature (and only a copy should be touched)
- **Treating `.ko.xz` / `.zst` as a packer**: it is the loader's normal decompress stage
- **Seeing type IDs in `.BTF` that do not line up and judging "the file is corrupt"**: it may be split BTF (it needs the base; if `.BTF.base` is present, relocate first)
- **Forcing offsets from source of the same version**: rule out RANDSTRUCT first (taint `T`)
- **Treating a livepatch `.klp.rela` as a corrupted relocation**
- **Explaining a symbol-resolution failure with pre-5.7 experience**: `kallsyms_lookup_name()` is no longer exported to modules
- **Running only `lsmod` and concluding "there is no rootkit"**: it must be a cross-view, and a single enumeration is not trusted
- **Treating legal dynamic patching as tampering**: rule out alternatives / static keys / ftrace / livepatch / paravirt / kprobe first
- **Marking `__ex_table` fixup code as dead code**: it is an exception edge, and it belongs to the CFG
- **Treating ORC unwind data as an encrypted blob / treating ENDBR64 as obfuscation**
- **Treating all-zero kallsyms as a hook**: look at `kptr_restrict` first
- **Treating an address mismatch as "not the same kernel"**: recover the KASLR slide first
- **Waiting only for a pretty call graph**: in the kernel the callback-registration graph is closer to the real control flow
- **Putting a kprobe on an intermittent path first**: the ladder is tracepoint → ftrace → fprobe, and observation changes timing

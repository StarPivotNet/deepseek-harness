# Unicorn / Qiling tool-specific pitfalls and boundaries

## Version differences

- **Unicorn 2.x is the current line** (pip default; 2.1.4 released 2025-09): hook callback signatures match 1.x (`(uc, address, size, user_data)` / memory class `(uc, access, address, size, value, user_data)`), but since 2.0 the C library API/internal behavior has changed (for example some hook types, PC-guarantee semantics) — old tutorials that write rare python bindings against the 1.x C API will fail; the Python binding layer is basically compatible
- **Qiling version differences**: snapshot support has existed since early 1.x (from 1.1.x, `ql.save/restore` already had a snapshot parameter and reg/mem/fd switches); from 1.2 the parameters expanded (new switches such as os_context/loader); rootfs layout (`examples/rootfs/`) adds and removes OS profiles by version — trust the current structure of the cloned official repo
- **capstone 5.x**: `pip install capstone` is currently 5.0.x; 5.x mnemonic output for some instructions differs from 4.x (`capstone.x86` naming is the same); watch disassembly comparison scripts
- **unidbg / Chomper are independent tools**: unidbg (Java, Android JNI emulation) and Chomper (Unicorn wrapper, iOS Objective-C emulation) do not depend on the unicorn pip package version; use each repo's release

## Environment-semantics pitfalls (emulation ≠ real)

- **Syscalls not handled**: Unicorn does not emulate a kernel; a bare run of a real program stops or faults at syscall/`int 2e` — switch to Qiling (forwards syscalls automatically), or hook_intr and fake-return by eax number
- **Environment detection**: CPUID/rdtsc timing and API probes (a special `GetModuleHandleA` return, a dladdr query) can notice a non-real environment — locate detection points statically first ([[re-triage]] / [[re-deobfuscate]]), hook that path to return real-environment values; the conclusion must be cross-checked against a real sandbox run
- **Missing time/thread/network semantics**: Unicorn is single-threaded, rdtsc needs a fixed hook, and there is no network stack — tasks that depend on these go to QEMU ([[re-fw-emulate]]) or a real sandbox ([[re-sandbox]])
- **Loader semantics**: Unicorn does not parse ELF/PE — extract segments and load them by hand; Qiling has a loader, but dynamic-link resolution differs from real ld.so; doing `ql.save` after dlopen, then branching, avoids repeating the resolve cost

## Memory pitfalls

- **Page alignment**: mem_map address and size must be 0x1000-aligned (4KB), or it errors; the stack is at least 1 page (0x1000), `UC_PROT_READ|UC_PROT_WRITE`
- **Write to a read-only segment**: `Invalid memory write` may be permissions, not a missing map — retry after `mem_protect(addr, size, UC_PROT_ALL)`
- **Unmapped-access callback**: returning True from `UC_HOOK_MEM_UNMAPPED` plus an on-the-spot `mem_map` lets emulation continue (lazy page fill); but page fill is emulator behavior, and the real program may never have made that access — first check whether the address was computed wrong
- **Stack too small**: recursion/deep calls crash outside the stack region — map a few more stack pages, and `reg_write` the stack pointer to the top of the page

## Architecture and platform pitfalls

- **ARM Thumb**: Thumb code needs `UC_MODE_THUMB` (or AArch32 mixed Thumb uses the `UC_MODE_ARM | UC_MODE_THUMB` combination); the wrong mode makes every decode garbage
- **Endianness**: armeb/mipsel use `UC_MODE_BIG_ENDIAN` / the architecture's matching mode; both data endianness and instruction endianness must be right
- **Register constants follow the architecture**: x86 uses `UC_X86_REG_*`, arm uses `UC_ARM_REG_*` — mixing constants errors or reads the wrong register
- **Android .so → unidbg**: a bare Unicorn/Qiling run lacks JNI semantics and will not run; a hardened/signed iOS so → Chomper (see the matching pitfall in SKILL.md)
- **Windows targets**: Qiling's `rootfs/x86_windows` is wine-based and heavy; startup is slow and some API semantics are incomplete — try a Linux-ized target first, or extract the function into Unicorn

## Result-trust boundary

- **"Normal" emulation is not correctness**: the environment may have been detected and returned a decoy — verify against a real environment / server response (especially JNI callback class)
- **Snapshots do not cross versions**: qsave is tightly bound to the Qiling version; after a framework upgrade an old snapshot may fail to restore — also write plaintext segments to disk at critical stages (mem_read); do not rely only on the snapshot
- **Performance**: a full `UC_HOOK_CODE` trace is an order of magnitude slower — limit the trace to an address range (hook_add begin/end) or add a condition inside the hook
- **Execution-flow correction**: after a hook changes PC to jump, the target block may fall back to the original instruction when it finishes — you need `hook_del` or a permanent rewrite of the memory bytes

## Usage notes

- Emulation is dynamic execution: default sandbox + network isolation ([[re-analyze/platform-tips]] highest principle)
- Archive products (plaintext segments/traces/snapshots) with sha256 ([[re-triage]]); conclusions go into [[re-analyze/analysis-contract]], and are archived after cross-check against a real execution

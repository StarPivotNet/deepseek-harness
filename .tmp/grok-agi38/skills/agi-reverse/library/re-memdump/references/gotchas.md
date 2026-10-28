# Memory-dump and extraction tool-specific pitfalls and boundaries

## /proc/<pid>/mem direct-read pitfall group

- **The offset is a virtual address, not a file offset**: a direct `open('/proc/<pid>/mem').read()` from 0 always errors (the offset is illegal) — you must address from maps + SIGSTOP + chunked pread (SKILL.md pitfall 3)
- **An out-of-range read returns EIO**: an address that is not inside the process mapping (or a write to a read-only segment) reports `Input/output error` — plan the read range from the maps allowlist (ranges that include `r` permission). On EIO, go back and check maps first
- **Permission bar**: when you are not root and `kernel.yama.ptrace_scope=1/2`, opening `/proc/<pid>/mem` fails immediately (`Permission denied`) — root, or temporarily `sysctl kernel.yama.ptrace_scope=0` (restore it afterward)
- **Race window**: before/after SIGSTOP the process may be switching threads or reclaiming pages — STOP first, then read, then CONT; on a multi-threaded target, STOP freezes the whole process. CONT promptly after the read so behavior analysis is not affected

## Core-file pitfall group

- **gcore is a single-process ELF core, not a whole-machine image**: Volatility plugins such as linux.pslist apply only to a whole-machine image (LiME / `dd if=/dev/mem` class) — running the [[re-mem-forensics]] flow on a gcore fails. Process-level enumeration uses gdb/eu-stack (already stated in SKILL.md step 3)
- **vDSO is not portable**: when rebuilding/reproducing a process image, the program jumps back to the original vDSO address or breaks on `call *%gs:0x10` — the vDSO address is `AT_SYSINFO` / `AT_SYSINFO_EHDR` in the stack auxv, and patching auxv still may not relocate it; when rebuilding, treat vDSO-related calls as necessarily broken (the SKILL.md pitfall "vDSO is not portable")
- **A failed read of vsyscall/vdso/vvar is expected**: `[vsyscall]` is execute-only, and some `[vdso]` pages are not readable — filter by maps and then extract. Do not debug it as a bug (SKILL.md pitfall 1)
- **A core can reach several GB**: `file` first and confirm it is an ELF core, then extract on demand; before importing the whole file into Ghidra, estimate the size
- **gcore forensics resolution is limited**: shared-library injection / function-pointer redirection is hard to see — deep forensics switches to an ECFS-class kernel-level dump (a core_pattern hook rebuilds `.symtab` / `.dynsym`) or a hand rebuild together with maps (the SKILL.md pitfall "gcore forensics resolution")

## Timing pitfall group (too early / too late)

- **Dumping too early = the packer's initial state**: a dump before plaintext/code has materialized gets compressed/encrypted data — a classic single-layer packer is right near the real OEP, but OEP is not a universal completion criterion; a multi-stage loader / on-demand decrypt / virtualization protection / reflective load / process injection / fake OEP sets the dump point by "write → execution transfer + memory-protection change + payload header/import recovery", and takes multi-time snapshots when needed (SKILL.md pitfall 2; key experience in [[re-analyze/platform-tips]])
- **Decrypted data is discarded as soon as it is seen**: plaintext is staged — unpack cleanup, self-wipe, burn-after-use keys, and buffer reuse all erase it immediately; save as soon as the product is confirmed, "save first, then continue" (the SKILL.md pitfall "seeing decrypted data"; to reproduce it, return to the decrypt-loop call site, [[re-binary-core]] methodology R19)
- **Dump the process at the right point in its lifetime**: an attach-style dump must pick the right moment (decrypt finished, a check-compare point hit, after the C2 handshake) — dumps of the same target at different times differ hugely. Record a timestamp with the forensics

## Platform pitfall group

- **Windows**: a procdump process-level minidump is the same level as gcore — Volatility does not apply; a whole-machine image uses DumpIt / another kernel dump; the analysis entry is [[re-windbg]] / [[re-x64dbg]] (the `minidump` command)
- **macOS**: there is no /proc and no Linux-style gcore — process-memory reads use a task_for_pid-class interface (lldb / a custom tool), and the dump uses `process save-core` from [[re-lldb]] (the product is a Mach-O core; `file` confirms the format)
- **Inside a container**: `/proc/<pid>/maps` is the container-namespace view (a pid inside the container ≠ the host pid) — before the dump, `ps` confirms which pid it belongs to (a host pid is looked up with `nsenter` or host ps)

## Version differences

- **gdb/gcore**: gcore ships with gdb, and the `-o` prefix parameter has been stable for a long time; gdb 12+ handles core notes more completely (including the x86_64 AVX register area); a core exported by an old gdb may resolve fewer symbols on a new toolchain — use a new version for the core, and cross-version parse differences follow what you measure
- **elfutils (eu-stack)**: 0.196 measured `--version` works; eu-stack symbolization inside a core depends on whether `.symtab` was kept. A symbol-stripped core prints bare addresses
- **Kernel core_pattern**: `core_pattern` decides whether a crash dump is a traditional core or a pipe to an external tool (systemd-coredump and similar) — before analyzing a crash dump, confirm the source format (`coredumpctl info` can check)

## Usage notes

- A dynamically run sample executes inside a sandbox (top principle in [[re-analyze/platform-tips]])
- Archive sha256 of the dump product and the timestamp ([[re-triage]]); write conclusions into [[re-analyze/analysis-contract]]
- Version-dependent behavior (gdb core format, /proc semantics) follows what the target version actually does

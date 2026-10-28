# Linux platform branch: VMA / mmap-mprotect tracing / process_vm_readv

The observation object is **the process's VMA (virtual memory area)** — Windows calls the counterpart a VAD, but the event and read paths are completely different.

## 1. VMA enumeration and signals

- Main line: `/proc/<pid>/maps` (or `smaps`, which has finer statistics) → filter executable VMAs → backing-file / provenance judgment → thread PC / stack attribution → dump
- Fields on each `maps` line: `address perms offset dev inode pathname`
  - Four-character `perms`: `r` read / `w` write / `x` execute / `s` shared / `p` private (COW)
  - an **empty `pathname` = anonymous mapping**; a mapping with no file is also shown as `[heap]`, `[stack]`, `[vdso]`, `[anon:<name>]`, `[anon_shmem:<name>]`
- **Efficient query**: from Linux **6.11**, `PROCMAP_QUERY` **ioctl** (`struct procmap_query`, defined in `linux/fs.h`) can filter a single VMA by condition. It suits programmatic scans and is more stable than parsing text (kernel doc: `Documentation/filesystems/proc.rst`)
- **High-value signals**:
  - **anonymous `r-x` / `rwx` VMA** (no file backing, yet executable)
  - **`/memfd:<name> (deleted)`** or a file-backed executable mapping marked "deleted" (the carrier has already disappeared from the filesystem)
  - **a normal ELF mapping whose contents do not match the ELF on disk** (code rewritten / replaced; the Windows counterpart is module stomping)
  - **a heap / anonymous VMA later becomes executable** (W→X transition)
  - **a thread PC/RIP lands in these regions**; **a return address on the stack points at these regions**
- Note: **"anonymous executable" is a signal, not a verdict** — JIT (JVM / V8 / Mono), Wine/Proton, and QEMU TCG all produce this kind of VMA. Look at provenance and execution history (end of this section)

## 2. Dynamic side (trigger): do not only hook libc

- Hooking only libc `mmap()` / `mprotect()` is bypassed by a **direct syscall**
- Lower event sources:
  - **syscall tracepoint / kprobe** (`bpftrace`, `perf`) — watch syscalls such as `mmap` / `mprotect` / `memfd_create` directly
  - **BPF LSM** — attach a BPF program to an LSM hook. The kernel BPF LSM doc (`Documentation/bpf/bpf_lsm.rst`, newer name `prog_lsm.rst`) **uses `file_mprotect` as the example**:
    `int file_mprotect(struct vm_area_struct *vma, unsigned long reqprot, unsigned long prot);`. The example program `SEC("lsm/file_mprotect")` returns `-EPERM` on a hit (it can audit, and it can also block)
  - The list of attachable hooks is in the kernel `include/linux/lsm_hooks.h` (newer trees: `security/security.c`). Attach with `BPF_RAW_TRACEPOINT_OPEN` or libbpf `bpf_program__attach_lsm`. Privilege is required (the doc mentions `CAP_MAC_ADMIN` and `CAP_SYS_ADMIN`)
  - The collection side only needs events of the **executable protection transition** kind as the trigger. The hit is the dump time (eBPF-side detail: see [[re-ebpf]])

## 3. Execution-context attribution

- Threads: enumerate `/proc/<pid>/task/`. Read `stat` / `status` for state and location clues. Backtrace a suspicious thread (gdb / `eu-stack`) for return addresses
- Criterion: the thread PC, or a return address on the stack, lands inside an **anonymous / deleted-backing executable VMA**

## 4. Dump

- **`process_vm_readv()`**: read another process's address space. Take a region directly by [base, length]. Permission is constrained by the **ptrace access check** (including Yama `ptrace_scope`; see the [[re-memdump]] pitfalls)
- Other paths: `ptrace` (`PTRACE_ATTACH` + `PTRACE_PEEKDATA` / `process_vm_readv`), `gcore` (a whole-process core; note it is a single-process image, not a whole-machine image), `/proc/<pid>/mem` (also constrained by ptrace permission)
- Linux's executable format is ELF: **wiped-header / headerless payloads exist here too** — save the whole region, then classify the contents (complete ELF / manually mapped ELF / raw shellcode / JIT code / decrypted blob)
- **Memory vs disk diff**: where `/proc/<pid>/maps` gives a backing path, compare the on-disk copy with memory page by page or by digest (finds replaced code). Use the [[re-variant]] approach to locate the difference

## 5. False positives and allowlist

- Allowlist / down-rank: JVM, V8/Node, Mono/.NET, Wine/Proton, QEMU TCG, interpreter-generated trampolines, security software's own probes
- Scoring is the same shape as the Windows branch: anonymous executable + thread PC/stack hit + recent W→X + content entropy / ELF features + no known runtime source

## Tools and verification

- Basics: `cat /proc/<pid>/maps` (confirm address / perms / pathname are visible); `smaps` for `Rss` / `Private_Dirty` and similar
- Events: `bpftrace -l 'tracepoint:syscalls:*mprotect*'` should match the tracepoints the target kernel actually provides. BPF LSM needs kernel `CONFIG_BPF_LSM` and BTF (verify `ls /sys/kernel/btf/vmlinux`)
- Collection: `python3 -c "import ctypes; ..."` or gdb `dump memory` to verify the `process_vm_readv` path is reachable

## Pitfalls on this platform

- **Thinking a libc hook is coverage**: a direct syscall bypasses it — use a tracepoint/kprobe or BPF LSM
- **Translating VMA as VAD directly**: Linux does not have the "module chain crossed with VAD" set (a module = a file-backed mapping). The substitute is maps pathname/inode compared with the file on disk
- **`process_vm_readv` returns EPERM**: check Yama ptrace_scope and the relationship to the target process first ([[re-memdump]] pitfalls). Do not misread it as the payload disappearing
- **Treating anonymous executable as malicious**: JIT / Wine / TCG produce a lot of it — baseline first, then score

## 6. Collecting a kernel-mode payload (LKM / rootkit)

A kernel-mode payload that a user-mode scan cannot see uses the same collection logic as user mode, but a different observation surface (analysis method: the Linux branch of [[re-kernel]]):

- **Cross-view is the prerequisite**: a clean `lsmod` / `/proc/modules` **is not a conclusion** (a rootkit can unlink a module from the list while the module keeps running). Cross-check:
  - module view: `/proc/modules`, `/sys/module/<name>/`
  - symbol view: `/proc/kallsyms` (affected by `kptr_restrict`)
  - section-address view: `/sys/module/<name>/sections/`
  - kernel executable memory ranges (offline image side: see [[re-mem-forensics]]; the online side needs kernel-mode means and is an authorized scenario)
  - when views contradict, **trust offline memory forensics first**, not output the analyzed system gives about itself
- **Finding an inline text patch**: compare kernel text with the on-disk `vmlinux` / module copy section by section (a function head was rewritten but the address did not change — the same shape as a user-mode inline hook)
- **Hook sites are not only the syscall table**: `file_operations`, `seq_operations`, proc handlers, network-protocol callbacks, ftrace, and kprobes have all been used — "the syscall table is clean" is not a conclusion
- **Collection timing**: a kernel-mode payload also has "clear after use" (module unloads itself, hooks restored) — dump on the hit
- Authorization boundary: kernel-mode collection usually requires loading your own module / using a mechanism such as kprobe. **Do it only on a device you own or are authorized to use**, and record the stop condition

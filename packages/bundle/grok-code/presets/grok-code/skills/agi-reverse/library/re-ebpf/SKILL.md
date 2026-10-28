---
name: re-ebpf
description: >
  eBPF program reversing and adversarial analysis: the BPF-64 instruction set, prog/map correlation, bpftool disassembly, and three uses — trace forensics, malicious samples, and EDR countermeasures.
  Triggers: eBPF, BPF, bpftool, bcc, libbpf, xlated, `BPF 指令`, `bpf hook`, `EDR 对抗`, tracepoint, kprobe.
capabilities: [ebpf-analysis]
---

# eBPF program reversing and adversarial analysis (BPF-64, progs/maps, xlated)

## When to use / when not to use

- Use: program analysis at the BPF-64 instruction-set level (8-byte fixed instructions, r0-r10 registers, lddw/alu32/helper calling convention)
- Use: three source shapes — BCC (compiled at runtime; often only the in-kernel prog remains), libbpf (ordinary BPF ELF, with .maps/.BTF complete), hand-written bytecode (bpf_insn array / precompiled blob, no metadata)
- Use: three purposes — trace forensics (recover what a bpftrace/bcc program does), malicious eBPF (kernel residency / load chain / evasion techniques), EDR countermeasures (identify and counter bpf hooks)
- Use: recovering prog/map correlation, identifying hook points (kprobe/tracepoint/cgroup/xdp/tc/fentry), and mapping helper call numbers to kernel-API semantics
- Do not use: a classic kernel module (.ko driver) — go to [[re-kernel]]
- Do not use: traditional cBPF such as seccomp/socket filters (classic BPF; the instruction set differs from BPF-64; this skill does not cover it)
- Do not use: the generic case of analyzing only the host loader binary ([[re-binary-core]]); on-chain BPF bytecode (Solana class) has a different semantic table — go to [[re-blockchain]]
- Note: helper IDs are stable numbers in the Linux BPF UAPI (existing `BPF_FUNC_*` values are not renumbered across kernel versions); version differences affect whether a helper exists, whether it is allowed for a given prog_type/context, and kernel structure layout; keep the analysis-environment kernel version as close as possible to the sample's target version (see pitfall 3)

## Tool setup

Verify every tool before use. Loading/running a BPF program in the kernel needs root (or CAP_BPF/CAP_SYS_ADMIN); dynamic analysis of malicious samples (kernel-resident / evasion class) defaults to an isolated VM + snapshot ([[re-sandbox]], [[re-analyze/platform-tips]] highest principle); read-only queries (`prog list`/`dump xlated`) are lower risk, but still check kernel-version consistency in a controlled environment.

### bpftool — core tool (prog/map query and xlated disassembly)

- Debian/Ubuntu: `apt install bpftool` (a standalone package since Debian bullseye; Ubuntu 19.10+ can also install `linux-tools-common` + `linux-tools-generic` — the former is only a wrapper; the real binary is in the kernel-matched package `linux-tools-$(uname -r)`); older Debian (buster and earlier) has no standalone package — build `tools/bpf/bpftool` from kernel sources or clone and build the libbpf/bpftool repo
- Fedora: `dnf install bpftool` (official repo); Arch: `pacman -S bpftool`
- Windows: no Linux-kernel eBPF runtime (Microsoft ebpf-for-windows is a separate implementation, not the Linux-kernel shape); install inside WSL2 (Linux kernel) per the distro; macOS: no kernel eBPF support — use a Linux VM
- Verify: `bpftool version`; add `sudo` to query commands (`bpftool prog list`, `bpftool prog dump xlated id N`, `bpftool feature probe`, `bpftool map show/dump id N`, `bpftool net show`, `bpftool btf dump file /sys/kernel/btf/vmlinux`)

### llvm-objdump — static disassembly of a BPF ELF

- Debian/Ubuntu: `apt install llvm`; Fedora: `dnf install llvm`; Arch: `pacman -S llvm`; macOS: `brew install llvm` (llvm-objdump is in /opt/homebrew/opt/llvm/bin/)
- Verify: `llvm-objdump --version`; disassemble: `llvm-objdump -d prog.o` (ELF e_machine=EM_BPF(247) is recognized automatically; no need to specify a target); GNU objdump (binutils 2.29+ with a bpf target) is an alternative
- Note: static disassembly is the compiler product, which differs from the in-kernel execution shape (xlated) (see pitfall 2)

### bpftrace — trace-forensics recovery (compare when recovering a bpftrace/bcc program under analysis)

- Debian/Ubuntu: `apt install bpftrace`; Fedora: `dnf install bpftrace`; Arch: `pacman -S bpftrace`
- Verify: `bpftrace --version`; `bpftrace -d -e 'probe { ... }'` prints the BPF instructions it generated, used to compare against an xlated dump and recover script behavior

### pyelftools — scripted ELF section location

- `pip install pyelftools` (cross-platform)
- Verify: `python3 -c "import elftools; print(elftools.__version__)"`; used to batch-extract `.text`/`.maps`/`.BTF`/`.rel*` sections from a BPF ELF

### Ghidra — eBPF processor (built in since 10.3)

- Official built-in eBPF processor since Ghidra 10.3 (the community eBPF-for-Ghidra extension was merged upstream; older Ghidra needs that extension); supports lddw/ALU32/JMP32/BPF_ATOMIC, bpf2bpf relative calls, map relocations, and helpers as syscalls with signatures
- Linux: official release (needs a JDK) or a distro package (some repos have `apt install ghidra`/`pacman -S ghidra`); macOS: `brew install --cask ghidra`; Windows: official zip
- Verify: import a BPF ELF; the language bar should show eBPF:LE:64:default
- Known limit: eBPF has no dedicated stack-pointer register; the module uses r10 as SP (stack depth is always 0, and some r10-relative accesses are treated as dead code) — cross-check decompiler output against the xlated dump

### LIEF — eBPF disassembly library (batch processing)

- `pip install lief` (recent versions include an LLVM MC-driven eBPF disassembler; after `lief.parse()`, disassemble by section/address)
- Verify: `python3 -c "import lief; print(lief.__version__)"`
- Suited to scripted batch disassembly; no GUI/decompiler

### Dedicated reversing-framework status (boundary note)

- The previously imagined "bpf-gazelle class" dedicated eBPF reversing framework: a search (2026-08) found no publicly usable implementation, and this skill does not depend on such a tool; the current method is a combination of generic tools (Ghidra processor + bpftool xlated + llvm-objdump/LIEF); add a dedicated framework later if one appears

## Procedure

Run in order. Archive each step. Runtime queries need root. Dynamic analysis defaults to a sandbox.

1. **Locate the carrier** (what shape the sample is decides the later method):
   - **libbpf-style BPF ELF**: `file prog.o` shows eBPF; `readelf -S prog.o` / `llvm-readelf -S` lists sections — `.text` and sections named by attach point (such as `kprobe/do_sys_openat2`, `tracepoint/syscalls/sys_enter_openat`, `xdp`, `tc`, `cgroup_skb/ingress`, `fentry/<fn>`), `.maps` (BTF-defined map definitions), `.BTF` (type info), `.BTF.ext` (line info + CO-RE relocations), `.rel*` (relocation sections); use pyelftools when you need batch extraction
   - **BCC-style**: compiled on the spot at runtime by an embedded clang; the compiler product usually is not left on disk — the static side is only the loader script (Python/other language), and the finished product is on the kernel side; forensics recovery is mainly `bpftool prog dump xlated`
   - **Hand-written bytecode**: a bpf_insn array or precompiled blob, no ELF metadata and no BTF — disassemble the whole thing (lddw is two instructions; decode offset fields by hand) or dump it from the kernel
   - **Runtime location**: `sudo bpftool prog list` lists every loaded prog (id/type/name/tag/map_ids/btf_id); match sample features (name/tag/load time)

2. **Disassemble (static and runtime views)**:
   - Static: `llvm-objdump -d prog.o` — the compiler product; symbols and comments are kept, good for a fast read of the logic
   - Runtime: `sudo bpftool prog dump xlated id <id> opcodes` (append `linum` to show source line info) — the real execution shape after the verifier
   - Compare the two side by side: the differences are verifier rewrite points (context-access rewrite, map-access inlining, constant folding, and similar; see pitfall 2)
   - xlated output format: `index: (opcode hex) instruction`, for example `0: (b7) r0 = 0`, `4: (18) r1 = map[id:2]`, `6: (85) call bpf_tail_call#12`, `7: (15) if r0 == 0x0 goto pc+18`; the `opcodes` option appends the raw bytes under each line
   - Instruction-set points: 8-byte fixed length (opcode/dst:src/16-bit off/32-bit imm); r0 is the return value, r1-r5 pass arguments, r6-r9 are callee-saved, r10 is a read-only frame pointer; ALU32 uses w0-w9 registers (the low 32 bits of r0-r9, zero-extended); `call` (0x85) is one encoding — imm is the helper call number, and a bpf2bpf subroutine call is distinguished by a relative offset plus an src_reg mark; lddw (0x18) takes two instructions (the second holds the high 32 bits), and src_reg distinguishes uses such as map pointer / map value address / subroutine address

3. **Recover prog/map correlation**:
   - Runtime: the map_ids field of `prog list` gives the maps the prog references; in xlated, `(18) r1 = map[id:N]` (needs kallsyms available; see pitfall 3) → `sudo bpftool map show id N` (type/key_size/value_size/max_entries/pinning) → `sudo bpftool map dump id N` (some types support this; a prog_array can enumerate the tail-call target chain)
   - Static: recover map definitions from the BTF structures in the `.maps` section (type/key/value/max_entries/pinning/flags); the `.rel*` sections record map reference sites; correlate runtime instances with static definitions by name/id
   - Shared relationships: several progs sharing one map (kernel-side collection, userspace read) is normal; when recovering, aggregate every referrer by map

4. **Identify hook points**:
   - ELF side: the section name is the attach target (`kprobe/xxx`, `tracepoint/syscalls/sys_enter_*`, `fentry/<function>` — the fentry family needs vmlinux BTF)
   - Runtime side: prog type sets the attach class (KPROBE/TRACEPOINT/RAW_TRACEPOINT/XDP/SCHED_CLS/CGROUP_*/LSM/TRACING and similar); confirm the specific hang point with `sudo bpftool net show` (tc/xdp and NICs), `sudo bpftool cgroup show` (cgroup family), `sudo bpftool link show` (fentry/fexit/kprobe links)
   - prog type also decides the helper allow-list and ctx semantics the verifier permits (for example KPROBE ctx is pt_regs, tracepoint ctx is the event struct) — the allow-list directly constrains the semantic-recovery space

5. **Semantic recovery**:
   - helpers: in xlated, `call <name>#<call number>`; resolve the call number by the fixed ID map in the Linux BPF UAPI (`___BPF_FUNC_MAPPER` in `include/uapi/linux/bpf.h` numbers each item explicitly; method in pitfall 3); compare names against the bpftool compile-time table or the target kernel; calling convention is r1-r5 arguments, r0 return value
   - data plane: map contents (collected data) and perf ring buffer / trace_pipe output (records written by helpers) close the loop on program behavior
   - malicious-sample focus: load chain (loader ELF/script + how the bytecode enters the kernel), persistence (pin to /sys/fs/bpf, companion daemon), evasion techniques (hook-target choice, fentry pre/post tampering); cross-check kernel semantics with [[re-kernel]]
   - Output: pseudocode-level notes (xlated instruction → function semantics) + hook points + map layout + behavior conclusion

## Cross-domain joins

- [[re-kernel]]: semantic map from helper call numbers to kernel APIs, and cross-check of kernel struct layouts accessed directly in xlated
- [[re-tracing]]: a complementary view of runtime syscall/function tracing — skb/kernel paths that strace cannot cover are observed and recovered by BPF
- [[re-evasion]]: EDR countermeasures — identify and analyze resident bpf hooks (fentry/kprobe/tracepoint/cgroup); join countermeasure techniques
- [[re-sandbox]]: loading/running a BPF sample is a mandatory precondition (isolated VM + snapshot)
- [[re-ghidra]]: decompilation workflow on Ghidra's built-in eBPF processor
- [[re-format-elf]]: the section-parsing base for a BPF ELF (.maps/.BTF/.rel* semantics)
- [[re-malware]]: the full analysis flow for a malicious eBPF sample (this skill owns the bytecode-recovery step)
- [[re-blockchain]]: on-chain BPF bytecode such as Solana (same instruction set, different helper table)
- [[re-variant]]: instruction-level comparison of multiple versions/patches of the same program
- Companions: [[re-binary-core]] (generic analysis of the host loader), [[re-behavior]] (behavior summary on the eBPF-resident side)

## Common pitfalls

- **The helper set / availability evolves with the kernel version; the IDs themselves are stable**: Symptom — the name in xlated `call <name>#<number>` does not match what the tool in hand shows, or bpftool shows `call unknown#<number>` (with kptr_restrict=2 it shows `bpf_unspec#0`); cause — helper IDs are stable numbers in the Linux BPF UAPI; existing `BPF_FUNC_*` values are not renumbered across kernel versions (`___BPF_FUNC_MAPPER` assigns each value explicitly, precisely so IDs stay portable under backport); version differences affect whether a helper exists, whether it is allowed for a given prog_type/context, and whether semantics were extended — an old bpftool showing `call unknown#N` only means its name table does not know a newer ID, and does not imply the ID drifted; names come from two places: helper names come from bpftool's compile-time table (which may be a different version from the running kernel), and `call pc+X#` subroutine names come from the running kernel's kallsyms (needs bpf_jit_kallsyms=1, kptr_restrict=0, symbols shaped like bpf_prog_<tag>_<name>); fix — resolve by the UAPI fixed ID map: check ID→name against `___BPF_FUNC_MAPPER` in `include/uapi/linux/bpf.h`; for callability, `sudo bpftool feature probe` lists the helpers that kernel actually supports (by name, split by prog type); kfuncs are not part of that stable ABI; kallsyms correlation (`/proc/sys/kernel/bpf_jit_kallsyms`=1, kptr_restrict=0) affects name display; the ID itself follows the UAPI
- **xlated does not match source (verifier rewrite)**: Symptom — xlated instruction count/order/constants differ obviously from llvm-objdump; cause — xlated is the post-verifier shape: context-access rewrite (for example __sk_buff changed to a direct sk_buff offset), map-access inlining (a helper call replaced by a direct address load), helpers inlined to kernel implementation functions (such as `__htab_map_lookup_elem`), constant folding, dead-code deletion; a bpf2bpf subroutine shows as a relative call `call pc+X#<subroutine symbol>`; a tail-call target is not in this prog (it hides in a prog_array map; xlated only shows `bpf_tail_call`); fix — treat xlated as execution truth; static disassembly is only a semantic reference; use the `linum` option to attach source line info onto xlated for alignment; expand the tail-call chain hop by hop along the prog_array map's fds
- **Missing BTF is a type blind spot**: Symptom — hand-written bytecode / an old-toolchain product has no `.BTF`, map layout and struct offsets cannot be parsed, and Ghidra is full of raw addresses; cause — BTF is the only authoritative source of type info (CO-RE relocations depend on it too); fix — infer layout from ldimm64 targets in xlated and offset constants in STX/ST instructions; when `.BTF` exists, export types with `bpftool btf dump file prog.o`, and on the vmlinux side compare structs with `bpftool btf dump file /sys/kernel/btf/vmlinux`
- **map and prog are separate / have different lifetimes**: Symptom — dumping only the prog and not the map breaks the behavior chain; after the prog unloads, an unpinned map is destroyed and the scene leaves no evidence; cause — a map exists independently of a prog (several progs can share it; it can be pinned under /sys/fs/bpf for persistence); fix — at the analysis scene, snapshot everything with `bpftool map show` + `prog list` first, then dump maps one by one; before forensics, archive the pin directory /sys/fs/bpf in full
- **No-symbol library-function matching**: Symptom — in a stripped loader / bytecode blob, self-implemented string/hash/encoding logic has no symbol to hit; cause — a BPF program has no dynamic linking; all logic is inlined in the prog; fix — identify by constant patterns (strings, magic values, table bases) and behavior fingerprints (the combination shape with the helper call sequence); compare against same-family loader source or a common pattern library
- **CO-RE relocation trap**: Symptom — struct field offsets read statically from the ELF do not match the target kernel's real layout, and semantic recovery is wrong; cause — a CO-RE program (relocation records in `.BTF.ext`) has field offsets computed at load time by libbpf from the target kernel BTF; offsets in the ELF are only placeholders; fix — recompute offsets from the target kernel version's vmlinux BTF, or trust xlated directly (the final offsets after relocation)

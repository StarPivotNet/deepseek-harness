---
name: re-memdump
description: >
  Memory dump and extraction: default dump first (gcore), direct-read as a special case.
  Triggers: `内存转储`, `dump内存`, `找密钥`, `DEX提取`
capabilities: [memory-dump]
---

# Memory dump and extraction

## When to use / when not to use

- Use: any task that needs to read process memory (find a key / decrypted data, extract a clean sample after unpacking, DEX extraction); core analysis after the process is already dead; the fallback when attach is forbidden
- Do not use: live interactive debugging (that is the job of [[re-gdb]] / [[re-lldb]] / [[re-x64dbg]])
- Do not use: strings/structures that are available statically (static first)

## Tool setup

See the "direct read vs dump" decision table and the Linux memory-dump extreme segments in [[re-analyze/platform-tips]] — **default dump first**. Direct read is only a special case.

### gdb / gcore (the dump workhorse)

- Linux: `apt install gdb` / `dnf install gdb` / `pacman -S gdb` (gcore comes with it)
- WSL: the Linux package
- Verify: `gcore --help` / `gdb --version`

### gdb core-analysis tools

- gdb (`gdb ./target core`), elfutils `eu-stack` (`apt install elfutils`), `file core`
- Verify: `eu-stack --version`

### volatility (memory-forensics analysis)

- All platforms: `pip install volatility3` (command `vol`) — Volatility 3 is the only maintained mainline now; Volatility 2 was archived read-only by upstream on 2025-05-16, and is only for historical images or result reproduction of old V2-only plugins/profiles. It needs an isolated Python 2 environment. Do not use it as a routine fallback for a modern image
- Verify: `vol -h`; `vol -f core windows.info` can identify the image

### proc / psmisc (process state)

- Linux: `apt install procps psmisc` / `dnf install procps-ng psmisc` / `pacman -S procps-ng psmisc` (usually already present)
- Verify: `ps aux` and `pkill` work

### Windows dumps (procdump / DumpIt, supplementary branch)

- procdump (official Sysinternals download, or `choco install sysinternals`): `procdump -accepteula -ma <pid> out.dmp` dumps full process memory (includes the managed heap) — x64dbg/windbg can load it for analysis
- DumpIt (Comae site): a whole-machine physical-memory dump (.raw), run as administrator — for whole-machine forensics in [[re-mem-forensics]]
- Verify: `procdump -accepteula -?` prints usage; confirm the dump product with `file` (dmp/raw header)

## Procedure

1. **Default dump: `gcore -o out <pid>` (timing set by plaintext/code materialization)**:
   ```sh
   gcore -o out <pid>
   # or inside the debugger
   gdb -q -p <pid> -ex 'gcore out' -ex detach -ex quit
   ```
   - The dump contains full memory + register/thread state (ELF notes) and can be imported directly into [[re-ghidra]] / [[re-ida]]
   - **Timing**: dump timing is decided by materialization of the target plaintext/code — a classic single-layer packer is usually right to dump near the real OEP, but OEP is not a universal completion criterion; a multi-stage loader, on-demand/page-by-page decrypt, virtualization protection, reflective load, process injection, and fake OEP should set the dump point by "write → execution transfer + memory-protection change + payload header/import recovery", and take multi-time snapshots when needed (see pitfall 2; the positive example that "first execution is not OEP" for multi-stage/fake OEP is in [[re-unpack-simple]] step 3)
   - One dump covers every later targeted extraction — do not dump repeatedly

2. **Before the dump, filter vsyscall/vdso from maps**:
   ```sh
   cat /proc/<pid>/maps > maps.txt
   grep -E 'vsyscall|vdso|vvar' maps.txt     # these segments must be dropped
   # keep only readable r--p / rw-p mapped regions as the extraction range
   ```
   Per the Linux memory-dump extreme segments in [[re-analyze/platform-tips]]: a failed read of `[vsyscall]` (0xffffffffff600000), `[vdso]` / `[vvar]` is normal, and dumping them into the core is only junk pages — skip them when extracting after the dump, or direct-read by a maps allowlist (step 5).

3. **Import into Ghidra/IDA for analysis (core review)**:
   ```sh
   gdb -q ./target out         # core review: bt / info registers / x/gx $rsp
   eu-stack -e out | head -30  # a quick stack backtrace
   ```
   Ghidra: `File > Import File` and pick the core (Ghidra supports ELF core import). Symbol/stack clues are usable.
   - A gcore product is a single-process ELF core, not a whole-machine physical-memory image — Volatility plugins such as `linux.pslist` apply only to a whole-machine image (collection such as LiME / `dd if=/dev/mem`). Running the [[re-mem-forensics]] flow on a gcore fails; process-level enumeration is gdb / `eu-stack` / ELF-core parsing plus targeted extraction

4. **Targeted extraction: keys/DEX/strings (magic scan)**:
   ```sh
   # DEX magic "dex\n035\0"
   grep -abo $'dex\n035' out | head
   # PEM private-key header
   grep -abo '-----BEGIN' out | head
   # general strings
   strings -n 8 out | grep -iE 'key|secret|flag|BEGIN'
   ```
   ```python
   # scan a given address range for a specific pattern
   data = open('out','rb').read()
   i = data.find(b'\x89PNG')          # PNG magic
   while i != -1:
       print("found at", hex(i)); i = data.find(b'\x89PNG', i+1)
   ```
   Key-extraction note: a key may be fragmented on the heap/stack — locate the crypto context first and then take it (look at the call site with [[re-ghidra]]).

5. **Special-case direct read: address from maps → SIGSTOP → pread**:
   ```sh
   kill -STOP <pid>    # stop the process first to prevent a race
   # after taking the target segment's address offset from maps.txt:
   dd if=/proc/<pid>/mem bs=1 skip=0x7f0000000000 count=4096 of=seg.bin 2>/dev/null
   kill -CONT <pid>
   ```
   ```python
   import os
   pid = 1234
   f = open(f"/proc/{pid}/mem", "rb")
   os.lseek(f.fileno(), 0x7f0000000000, os.SEEK_SET)   # address from maps
   data = f.read(4096)
   f.close()
   ```
   - Applies: the process must stay running / you only take a very small specific range (special cases ①/② in [[re-analyze/platform-tips]])
   - The `/proc/<pid>/mem` offset is a **virtual address**, not a file offset — a direct open+read starting at 0 always errors (see pitfall 3)

6. **Windows-side dump (branch filled in)**:
   ```sh
   procdump -accepteula -ma <pid> out.dmp   # full process memory (including the heap); windbg/x64dbg loads it
   # whole-machine physical memory: DumpIt run as administrator produces .raw → [[re-mem-forensics]]
   ```
   - A procdump product is a process-level minidump, the same level as gcore — it is not a whole-machine image, and Volatility does not apply ([[re-mem-forensics]] only consumes a whole-machine image)
   - Analysis entry: [[re-windbg]] (load a minidump) / [[re-x64dbg]] (the `minidump` command)

## Cross-domain

- [[re-binary-core]]: workflow step 6 (the memory stage; default dump first)
- [[re-sample-acquire]]: **when you have not yet decided which process / which memory to dump** (only a symptom, the sample never lands on disk), go there first — it scans anomalous execution regions and execution-context ownership, then hands the target back to this skill to dump
- [[re-malware]]: extract in-memory products of a malware sample (the sample after unpacking)
- [[re-mobile]]: extract a DEX/so from app memory
- [[re-anti-analysis]]: the standard action of extracting a clean image after unpacking
- [[re-crypto-keys]]: paired with the methodology of extracting a key from memory (locate the crypto context first, then take it; see step 4)
- [[re-format-elf]]: a core is ELF format. Section/notes structure parsing can be cross-checked
- Complements [[re-gdb]] / [[re-x64dbg]] / [[re-windbg]] (attach fails → dump; interaction needed → debugger; a Windows process dump → windbg)

## Common pitfalls

- **A failed read of vsyscall/vdso is normal**: `[vsyscall]` is execute-only, and some `[vdso]` pages are not readable. A gdb/pread access error is expected — filter by maps and then extract. Do not debug it as a bug
- **Dumping too early = the packer's initial state**: a dump before plaintext/code has materialized gets compressed/encrypted data — a classic single-layer packer is right near the real OEP, but OEP is not a universal completion criterion; a multi-stage loader / on-demand decrypt / virtualization protection / reflective load / process injection / fake OEP should set the dump point by "write → execution transfer + memory-protection change + payload header/import recovery", and take multi-time snapshots when needed (see the key experience in [[re-analyze/platform-tips]])
- **A naive open of /proc/pid/mem always errors**: a direct `open('/proc/pid/mem').read()` fails (illegal offset / permissions) — you must address from maps + SIGSTOP + chunked pread
- A core file can reach several GB — `file out` first and confirm it is an ELF core, then extract on demand. Do not import the whole file into a tool
- **When rebuilding a process from a dump, vDSO is not portable**: symptom — after the process image is rebuilt/reproduced, the program still jumps back to the original vDSO address, or an indirect `call *%gs:0x10` breaks; cause — the vDSO address is recorded in `AT_SYSINFO` / `AT_SYSINFO_EHDR` of the process-stack auxv, and glibc caches it, so patching auxv still may not relocate it; fix — when rebuilding the image, treat vDSO-related calls as necessarily broken (skip that page outright). Analyze from the other mappings
- **gcore forensics resolution is limited**: symptom — shared-library injection / function-pointer redirection is hard to see in the core, and stack info is incomplete; cause — a traditional core is a kernel per-segment snapshot, with no per-process profile and no symbol rebuild; fix — gcore is enough for ordinary reversing; deep forensics (locating an injection point/hook) switches to an ECFS-class kernel-level dump (a core_pattern hook rebuilds `.symtab` / `.dynsym`) or a hand rebuild together with `/proc/<pid>/maps`
- **Seeing decrypted data → save it immediately**: symptom — during dynamic debugging/a dump you just saw plaintext in memory (a decrypted string / key / second-stage code), and after switching tools or continuing to run that address was overwritten or cleared and cannot be recovered; cause — decrypted data is staged: unpack cleanup, self-wipe, burn-after-use keys, and buffer reuse all erase it immediately (note this is the opposite of "dumping too early"; here, later means it is gone); fix — as soon as a decrypted product is confirmed during dynamic work, `gcore` / targeted extraction immediately (see steps 1/4; default dump first), "save first, then continue"; to reproduce it, return to the decrypt-loop call site and observe again (see [[re-binary-core]] analysis methodology R19)
- **gcore/direct read is blocked by ptrace permissions**: symptom — `gcore` reports `ptrace: Operation not permitted`, and opening `/proc/<pid>/mem` fails immediately; cause — `kernel.yama.ptrace_scope=1/2` restricts cross-process-family attach (not root, and the target is not your own child); fix — run the dump as root, or temporarily `sysctl kernel.yama.ptrace_scope=0` (restore it afterward), or execute through a debugger ([[re-gdb]]) with an allowed identity

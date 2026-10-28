# Memory-dump and extraction command cheat sheet and operation sequences

The tool family is organized by "default dump first": gcore/gdb (the dump workhorse), maps and the /proc filesystem (addressing / direct read), grep/strings/python (targeted extraction), gdb/eu-stack (core review), procdump/DumpIt (the Windows branch). Commands and parameters follow the official docs (the gdb manual, the linux proc(5) manual, Sysinternals docs).

## Command-family cheat sheet

### Dump (gcore / gdb)

- `gcore -o <prefix> <pid>` dumps by pid (product `<prefix>.<pid>`); `gcore -a -o <prefix> <pid>` includes every mapped segment
- `gdb -q -p <pid> -ex 'gcore out' -ex detach -ex quit` dumps inside the debugger (dump after attach, once state is visible)
- `gcore --help` to verify; the product is a single-process ELF core (with thread/register notes)
- Timing: set it by plaintext/code materialization — a single-layer packer is usually right near the real OEP, but OEP is not a universal completion criterion (a multi-stage loader / on-demand decrypt / virtualization / reflective load / injection / fake OEP is judged separately; see the "dump too early" pitfall in SKILL.md)

### Addressing with maps (/proc)

- `cat /proc/<pid>/maps > maps.txt` records every mapping (address range / permissions / path)
- `grep -E 'vsyscall|vdso|vvar' maps.txt` drops unreadable extreme segments (see the Linux memory-dump extreme segments in [[re-analyze/platform-tips]])
- `awk '$1 ~ /r/ {print $1}' maps.txt` keeps only mappings that include read permission (the extraction-range allowlist)

### Targeted extraction (search inside the core)

- `grep -abo $'dex\n035' out` finds DEX magic positions (`-b` prints the byte offset)
- `grep -abo '-----BEGIN' out` finds a PEM private-key header; `grep -abo $'\x89PNG' out` finds a PNG
- `strings -n 8 out | grep -iE 'key|secret|flag|BEGIN'` a general string filter
- `dd if=out of=seg.bin bs=4096 skip=<offset/4096> count=<pages>` exports a range by block (page-aligned is faster)
- A one-shot python scan: loop `data.find(b'\x89PNG')` and take every hit (see the SKILL.md step 4 example)

### Direct read (the /proc/<pid>/mem special case)

- `kill -STOP <pid>` stops the process first to prevent a race; `dd if=/proc/<pid>/mem bs=1 skip=<virtual address> count=<length> of=seg.bin 2>/dev/null` (bs=1 is slow and fine for a small range; a large range uses python pread in chunks)
- python: `os.lseek(f.fileno(), <virtual address>, os.SEEK_SET)` + `f.read(n)` (see the SKILL.md step 5 example); when done, `kill -CONT <pid>`
- The offset is a virtual address, not a file offset; an address outside the maps allowlist (readable segments) always errors on read — address from maps, then read

### Core review

- `file out` confirms it is an ELF core (`ELF 64-bit LSB core file ...`)
- `gdb -q ./target out` → `bt` / `info registers` / `x/gx $rsp` / `info threads`
- `eu-stack -e out | head -30` a quick stack backtrace (elfutils)
- Ghidra: `File > Import File` imports the core, and symbol/stack clues are usable; ELF structure detail is cross-checked with [[re-format-elf]]

### Windows branch

- `procdump -accepteula -ma <pid> out.dmp` a full-process-memory minidump (includes the managed heap)
- DumpIt (Comae, administrator) whole-machine physical memory .raw → [[re-mem-forensics]]
- Analysis: [[re-windbg]] opens the .dmp; the [[re-x64dbg]] command `minidump <file>` loads it

## Common operation sequences (combined playbooks)

### 1. Standard dump flow (record maps → confirm timing → gcore → verify → targeted extraction)

```
cat /proc/<pid>/maps > maps.txt                    # addressing baseline
# packed sample: set the dump point by plaintext/code materialization (a single-layer packer is often near OEP; not a universal criterion)
gcore -o out <pid>
file out                                           # confirm an ELF core
grep -abo $'dex\n035' out | head                   # targeted extraction (key/DEX/strings)
strings -n 8 out | grep -iE 'key|secret|flag'
# one dump covers every later targeted extraction. Do not dump repeatedly
```

### 2. Direct-read special case (the process must stay running / a tiny range)

```
kill -STOP <pid>
# take the target segment's starting virtual address from maps.txt
python3 - <<'EOF'
import os
f = open(f"/proc/{pid}/mem", "rb")
os.lseek(f.fileno(), 0x7f0000000000, os.SEEK_SET)
data = f.read(4096); f.close()
EOF
kill -CONT <pid>
```

### 3. Capture decrypted data immediately ("save first, then continue" during dynamic work)

```
# when a decrypt loop / check-compare point is hit (inside the debugger)
gdb -q -p <pid> -ex 'gcore out' -ex detach -ex quit   # dump immediately
grep -abo '-----BEGIN' out                             # or extract the plaintext range directly
# confirm the product is usable before continuing to run — decrypted data is staged, and later it is gone (see the SKILL.md pitfall)
```

### 4. Core review (the process is already dead / after-the-fact analysis)

```
file out
gdb -q ./target out                                    # bt / info registers
eu-stack -e out | head -30                             # a quick stack backtrace
# import the core into Ghidra for decompilation and symbols; ELF structure is cross-checked with [[re-format-elf]]
```

## Lessons internalized

- Save maps before the dump: every address used by a direct read/extraction is based on maps.txt. Do not write offsets from memory
- vsyscall/vdso/vvar are junk pages, not a bug: a failed read is normal. After the dump, skip them during extraction, and direct-read by allowlist
- Keys/plaintext are fragmented: locate the crypto context first ([[re-ghidra]] looks at the call site) and then take the data. A pure scan may only get half a key
- `gcore` and `procdump` are both process-level images. Whole-machine forensics ([[re-mem-forensics]]) needs a whole-machine dump of the DumpIt/LiME class — pick the layer by the target
- A ptrace_scope permission block is an environment problem, not a command problem: before root / lowering the sysctl, confirm which process the target belongs to

## Usage notes

- A dynamically run sample executes inside a sandbox (top principle in [[re-analyze/platform-tips]]); archive the dump product's sha256 ([[re-triage]])
- A large core (several GB): `file` first, then targeted extraction as needed. Do not import the whole file into a tool
- Write conclusions and evidence (dump timestamp / address / plaintext fragment) into [[re-analyze/analysis-contract]]

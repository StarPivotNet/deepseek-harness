# Platform experience base

> Field experience shared across categories. Every skill's tool preparation and operating steps follow the OS branch.
> Principle: **give the lightest workable plan first** (Wine direct read > user-mode emulation > full-system virtualization > physical machine).

## Highest principle: default sandbox

All dynamic analysis / sample execution runs in a sandbox by default (mandatory prerequisite): VM snapshot / container (Docker, firejail) / dedicated sandbox (Cuckoo/CAPE); network isolation (INetSim, fake DNS, disconnected). Static analysis may skip the sandbox. All dynamic execution defaults to inside the sandbox, and the snapshot is restored when analysis ends. This principle outranks every other item in this file.

## Platform branches

### All platforms
- Dynamic analysis defaults to a sandbox (see above).
- **Execution points before the entry**: PE TLS callbacks, and ELF `.preinit_array` / `.init_array` / the init argument of `__libc_start_main`, all run before the entry point / main — a breakpoint only at the entry misses pre-entry logic. Set dynamic breakpoints at `ntdll!LdrpCallInitRoutine` (Windows) and `__libc_start_main` (Linux).
- **Tool parse ≠ loader view**: damaged or ambiguous header fields have no single correct parse. Malicious samples use parser differences to evade tools — a tool error ≠ a damaged file. Check critical header fields by hand first, and review the conclusion against real loader semantics.
- **Disassembly function boundaries are inexact**: linear disassembly of PE (data such as inline jump tables inside a code section) is about 99% accurate, and function-boundary recognition in mainstream tools also has 20%+ false calls (tail calls / non-standard prologues / inlining) — cross-check decompiler conclusions. Do not trust the tool's function list completely.
- **32-bit programs**: a gdb architecture switch changes ABI / register set / calling convention — before debugging a 32-bit target, confirm the debugger's architecture mode matches the target. On Windows a 32-bit target matches x32dbg. Running a 32-bit PE under Wine uses a wine32 prefix (WINEARCH=win32).

### Linux
- Analyzing a Windows PE: **read process memory directly under Wine** — run the PE with wine → `gdb attach` or read `/proc/<pid>/mem`. No whole-machine virtualization is required. Unpack / read memory by operating on the Wine process directly.
- Running a program for a non-native architecture: prefer QEMU user-mode emulation (`qemu-<arch>`). Use full-system emulation only when necessary.
- **Attach permission is not all-or-nothing**: ptrace_scope=1 restricts child processes / parent-child relationship / PR_SET_PTRACER — the same owner is not always enough to attach; a parent-child relationship or the target declaring PR_SET_PTRACER is also required. root can also be restricted. Inside a container, CAP_SYS_PTRACE affects attach.
- **Main differences of QEMU user-mode emulation**: the biggest QEMU user-mode problems are syscall ABI / kernel features / instruction extensions (not libc) — if a program will not run, check those three first. Do not only add libraries.

### Linux memory-dump extreme segments
- `[vsyscall]` (fixed address `0xffffffffff600000`, execute-only `--xp`), `[vdso]` / `[vvar]`: a failed read of `/proc/<pid>/mem`, or a gdb access error, is normal.
- Before a dump, filter these segments from `/proc/<pid>/maps` (dump only readable mappings `r--p` / `rw-p`). Otherwise the dump contains garbage pages and unpack / analysis is contaminated.
- Identifying features: the names `[vsyscall]` / `[vdso]` / `[vvar]` in `maps`, addresses in the high range `0xffffffffff6xxxxx`, anonymous `00:00` mappings with no file path.

### Windows
- Reading a target process's memory: install the Sysinternals suite (`procdump`) / `DumpIt` for a memory dump + Volatility analysis. Attach needs administrator rights.
- Common toolchain: x64dbg, Process Explorer (in place of System Informer), APIMonitor.
- **On attach failure, separate permissions from PPL / protected process**: administrator fixes ordinary limits. PPL depends on Signer Level (EDR commonly uses PPL-Windows TCB / Antimalware) and needs debug capability at the matching level.
- **Reading a Linux sample from Windows**: static analysis has no platform limit; dynamic analysis needs a matching runtime — static analysis can be done on the Windows side directly. To run the sample, prepare a matching Linux environment (VM / container).

### macOS
- Attach / debug: SIP and TCC restrict this. Debug tools need authorization (Developer Tools permission). Check before `lldb` attach.
- **Attach-failure layers**: task_for_pid entitlement / SIP / Hardened Runtime — besides Developer Tools authorization, the debugger itself needs the task_for_pid entitlement. When the target has Hardened Runtime enabled, debug APIs are restricted.

### Sandbox
- **Container debug missing SYS_PTRACE**: attach limits inside a container come from the SYS_PTRACE capability, /proc mounts, seccomp, and Yama — confirm the container configuration first (for example `--cap-add=SYS_PTRACE`) before deciding "environment limit" versus "program cannot be analyzed".
- **Sandbox isolation ≠ disguising the analysis environment**: time / hardware / input checks are environment fingerprints. A complete VM can still be detected — isolation guarantees safety, not "looks like a real environment". Handle environment-fingerprint countermeasures separately.

### WSL
- WSL cannot attach a Windows process directly — cross-boundary analysis uses Windows-side tools. Inside WSL, do only file / static analysis.

## Principle: confirm before analysis (dynamic-analysis prerequisite)

Before dynamic analysis, confirm the target ABI, execution environment, and permission model. A debug failure does not mean the program cannot be analyzed — attribute the failure first (architecture / environment / permissions), then decide whether to change plan or draw a conclusion.

## Principle: static first (large samples)

Static and dynamic are not substitutes. For a large sample, static location comes first and dynamic verification comes after — narrow the range statically, then add dynamic work as needed.

## Principle: prefer emulated execution (if it can run, do not reverse it)

When the target contains an official native library (signature algorithm / crypto routine / obfuscated VM), **emulating the official code is an order of magnitude faster than reversing the algorithm** — weeks of reversing versus a day of emulation. Fits when: the target library can be loaded (dependencies can be satisfied), the caller is JNI / an export, and only the "result" is needed, not the "principle". Decision signals: high algorithm complexity (many rounds / large tables / deep obfuscation), an existing library that can be loaded, community precedent for the same kind of emulation.
- Common carriers: unidbg (Android so + JNI emulation, Java), QEMU user mode (`qemu-<arch>` + sysroot), Qiling/Unicorn (single-function isolation)
- An emulated result that "looks normal" is not proof it is correct — **the real environment / server response is the only judge** (the emulated environment may be detected and return a decoy). Verify on a low-risk path first (allowlisted command / non-sensitive operation), then decide whether to touch a high-value target.

## Principle: JNI export names = protocol-contract signposts

When reversing the Java layer, a `Java_<package>_<class>_<method>` export is a **natural interface document** — the function name states the contract directly (encodeRequest / parseData / setAccountKey show the split at a glance). A stripped so still keeps JNI exports (the JVM needs them at runtime). Native-library reversing always starts by listing JNI exports with `nm -D`. The export-name pattern, kept as a search literal, is `Java_包名_类名_方法名`.

## Principle: serialize / deserialize pairs corroborate each other

Read a frame / packet layout from the serialize function, then verify it with deSerialize — **it is real only when both directions agree**. A protocol library usually contains both pack and unpack functions (serialize/parse, encode/decode). They check each other.

## Principle: search community reverse-engineering results before digging

Open-source projects for the same kind of target are **settled prior reverse-engineering results** — protocol structure, key tables, algorithm recovery, and emulator callback sets are in them. Search before digging yourself (GitHub mirrors / Gitee / codeload, and related ecosystem projects). The site name to search is `码云`. Even if the version or target differs, **structure, patterns, and callback lists can be ported**. Parsing from zero usually costs 10 times as long as porting.

## Toolchain traps (measured)

- **IDA interr (decompiler bug)**: a `create_stkvar`-class internal error hard-crashes and cannot be skipped — switch to Ghidra. Do not force it.
- **Ghidra script API version differences**: MemoryBlock permission-query method names change by version (getPermissions / isExecute / getExecute differ). If a script fails to compile, check the current version's javadoc first.
- **dex parse details**: the opcode is the **low byte of a u16** (the high byte is register bits); `fill-array-data` is **0x26** (31t), goto is **0x28** (0x24 is filled-new-array); string_data_item has a **uleb128 length prefix**; `insns_size` in code_item is at **+12** (+4 is outs_size)
- **GitHub downloads are unstable**: `codeload.github.com` is more stable than `github.com` (when git clone is reset, curl to codeload can still get through)

## "Direct read vs dump" decision (dump first by default)

One dump yields the full memory layout plus register / thread state (ELF notes). It can be imported into Ghidra/IDA and archived for reproduction. Every later targeted extraction (key search, unpack segment, DEX mining) is done from the dump product.

| Situation | Plan |
|---|---|
| Default (any task that needs to read memory) | **Dump** `gcore` → ELF core; forensics / archive uses a full dump + manifest |
| Need the full layout + registers / threads (import into a debugger, reproduce later) | **Dump** `gcore` (includes ELF notes) |
| Process already dead | Analyze the existing core directly (`kernel.core_pattern` / systemd-coredump / container runtime dump) |
| ptrace forbidden / sandbox container / attach failed | Dump as fallback (does not depend on the `/proc/<pid>/mem` permission path) |
| Exception 1: the process must keep running, real-time interactive debug | **Direct read** `/proc/<pid>/mem`: read maps to locate first → SIGSTOP to prevent races → chunked `pread` of only the target range |
| Exception 2: only a tiny specific range is needed and performance matters | **Direct read** that one range, same flow as above |

**Key experience**: dump timing is decided by when the target's plaintext / code materializes. A classic single-layer packer is usually dumped near the real OEP, but OEP is not a universal completion criterion (multi-stage loader / on-demand decrypt / virtualization protection / reflective load / process injection / fake OEP set the dump point by "write → execution transfer + memory-protection change + payload header / import recovery", and take multi-point snapshots when needed). Before a direct read, maps must be checked. Before a dump, filter `[vsyscall]` / `[vdso]`.

## Sources (Task 15 survey, 2026-08)

Search links grouped by query (measured WebSearch results):

- TLS callbacks / init_array / execution points before the entry:
  - DShield: How Malware Defends Itself Using TLS Callback Functions — https://secure.dshield.org/diary/How+Malware+Defends+Itself+Using+TLS+Callback+Functions/6655
  - Mandiant: Newly Observed Ursnif Variant Employs Malicious TLS Callback Technique — https://cloud.google.com/blog/topics/threat-intelligence/newly-observed-ursnif-variant-employs-malicious-tls-callback-technique-achieve-process-injection/
- ELF vs PE analysis pitfalls:
  - USENIX Security 2016 (Andriesse): function-boundary / linear-disassembly error — https://www.usenix.net/sites/default/files/conference/protected-files/security16_slides_andriesse.pdf
  - HAL paper: PE parse has no unique correct solution (parser-difference evasion) — https://hal.science/hal-04611598v1/file/publi-6603.pdf
  - CSDN library: 19 symbolic assumption errors when Linux ELF thinking is applied to PE (`__libc_start_main` hallucination / missing `.interp` misread) — https://wenku.csdn.net/column/38b5um95xq
  - inventivehq: Understanding PE, ELF, and Mach-O — https://inventivehq.com/blog/executable-file-formats-guide
  - binutils mailing list: COFF vs ELF undefined-symbol handling differences — https://www.sourceware.org/pipermail/binutils/2025-June/142006.html
  - CyberChallenge 2024 slides: forged ELF header fields make readelf error — https://cyberchallenge.it/assets/data/workshop/2024/files/CCIT2024%20-%20Workshop%20-%20Keynote%20-%20Van%20Eeden.pdf
- Process-memory forensics vsyscall/vdso:
  - StackOverflow: What are vdso and vsyscall (fixed address / ASLR / auxv) — https://stackoverflow.com/questions/19938324/what-are-vdso-and-vsyscall/19942352#19942352
  - DEF CON 23 (O'Neil): Advances in Linux Forensics (ECFS, low-resolution core and reconstruction) — https://infocon.org/cons/DEF%20CON/DEF%20CON%2023/DEF%20CON%2023%20presentations/DEF%20CON%2023%20-%20Ryan-O%27Neil-Advances-in-Linux-Forensics-ECFS.pdf
- Malicious persistence (registry / WMI / scheduled tasks):
  - win-persistence-checker (registry ASEP detection tool) — https://github.com/cwsecur1ty/win-persistence-checker
  - analyzing-malware-persistence-with-autoruns — https://github.com/mukul975/anthropic-cybersecurity-skills/blob/main/skills/analyzing-malware-persistence-with-autoruns/SKILL.md
  - RootGuard knowledge-base: persistence TA0003 technique library (hidden scheduled task, SD deletion) — https://github.com/andranglin/RootGuard/blob/master/knowledge-base/mitre-aligned-threat-dectection/persistence-ta0003-techniques.md
  - Blue-Team-Scripts: Malware Persistence Mechanisms — https://deepwiki.com/jwardsmith/Blue-Team-Scripts/6.2-malware-persistence-mechanisms
- Process-injection detection:
  - detecting-t1055-process-injection-with-sysmon (Sysmon events 8/10/7/25) — https://github.com/seikaikyo/dash-skills/blob/main/external/anthropic-cybersecurity-skills/skills/detecting-t1055-process-injection-with-sysmon/SKILL.md
  - detecting-process-injection-techniques — https://github.com/mukul975/Anthropic-Cybersecurity-Skills/blob/main/skills/detecting-process-injection-techniques/SKILL.md
  - Hexnode: What is Process Injection (LOLBin abuse such as mavinject) — https://www.hexnode.com/blogs/explained/what-is-process-injection/
- YARA rule best practices:
  - Trail of Bits: yara-rule-authoring (atom quality / condition order / module tradeoffs) — https://github.com/trailofbits/skills/blob/e8cc5baf9329ccb491bfa200e82eacbac83b1ead/plugins/yara-authoring/skills/yara-rule-authoring/SKILL.md
  - performing-threat-hunting-with-yara-rules — https://github.com/seikaikyo/dash-skills/blob/main/external/anthropic-cybersecurity-skills/skills/performing-threat-hunting-with-yara-rules/SKILL.md
  - VMware Security Blog: Hunting IcedID and unpacking automation (write rules against packer structure) — https://blogs.vmware.com/security/2021/07/hunting-icedid-and-unpacking-automation-with-qiling.html
  - Google GTI: writing YARA-X Livehunt rules — https://security.googlecloudcommunity.com/google-threat-intelligence-3/agentic-google-threat-intelligence-query-to-help-write-yara-x-rules-for-livehunts-7242

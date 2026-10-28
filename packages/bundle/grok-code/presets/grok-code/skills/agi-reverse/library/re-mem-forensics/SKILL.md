---
name: re-mem-forensics
description: >
  Volatility 3 memory forensics: process/kernel objects/network/credential clues.
  Triggers: `内存取证`, Volatility, `memdump分析`, `进程列表`, `mimikatz线索`
capabilities: [memory-forensics]
---

# Memory forensics (Volatility 3)

## When to use / when not to use

- Use: you have a .raw/.mem/.core memory dump for forensics (process list, network connections, injection detection, credential hashes); residual analysis of a malware sample in memory; an incident-response investigation
- Use: forensics requires a traceable timeline (process/network/registry event sequence, together with timeliner)
- Do not use: there is no dump yet — take one first per [[re-memdump]] (default dump first; see the "direct read vs dump" decision table in [[re-analyze/platform-tips]])
- Do not use: live interactive debugging (that is the job of [[re-gdb]] / [[re-x64dbg]]); filesystem/registry static analysis (that is [[re-binary-core]] / host-forensics tools)

## Tool setup

This skill only reads the dump file and does not run the sample; anything that needs dynamic confirmation goes to [[re-sandbox]] (default-sandbox top principle; see [[re-analyze/platform-tips]]).

### volatility3 — the memory-forensics workhorse (Python 3.8+)

- All platforms: `pip install volatility3` (the command is `vol`); the official requirement is **Python 3.8+** (as the README states). Measured in 2026, 2.28.0 installs on Python 3.14 and plugins load normally — confirm `python3 --version` first. If the version does not match, build the matching environment with pyenv/venv and then install
- Windows/WSL: the same pip method (a Windows dump can be analyzed inside WSL; see the WSL branch of [[re-analyze/platform-tips]])
- Verify: `vol -h`; `vol -f dump.raw windows.info` prints image info and does not report a symbol error
- Symbol files (ISF): **Windows and Linux/macOS get them by completely different mechanisms. Do not mix them up**
  - **Windows**: look up the ISF under `symbols/windows/` by the target kernel PDB's **GUID/age**; **when it is missing, the PDB is downloaded automatically from the Microsoft symbol server and converted to an ISF** — this is the only side that "can fetch online automatically" (it fails when the network is restricted)
  - **Linux / macOS**: an ISF is matched by an **exact kernel banner** (the banner is encoded inside the ISF, and **the file name does not matter**). How to get one: (1) a community prebuilt pack (an ISF collection organized by distro/architecture/kernel) (2) build it yourself — `dwarf2json` (**needs a kernel with debug symbols**) or `btf2json` (uses the BTF of `vmlinuz` + `System.map`, **does not need a full debug kernel**)
  - **Run `banners` first and get the kernel banner**, then find or build the matching ISF from the banner; `isfinfo` shows recognized symbol tables. When the banner misses, confirm with `-vvv`
  - Offline/restricted environment: `--offline` + a pre-placed symbol directory, or plugins report a MissingSymbol-class error
- Extra dependencies: credential plugins (hashdump/lsadump/cachedump) need pycryptodome, and yarascan needs yara-python — measured in 2026, 2.28.0 fails to load those plugins when the two dependencies are missing (they are simply absent from `vol --help`). After `pip install pycryptodome yara-python`, retry

### 7zip (optional, unpack a .7z compressed dump)

- Linux: `apt install p7zip-full` / `dnf install p7zip-plugins` / `pacman -S 7zip`
- macOS: `brew install p7zip`
- Windows: install from the 7-Zip site
- Verify: `7z --help`

### Toolkit extras (by platform)

- A Windows dump should also have Sysinternals ready (procdump/DumpIt are used to take the dump; see the Windows branch of [[re-analyze/platform-tips]])
- Suspicious objects from a deep extraction `vol -f dump.raw windows.dumpfiles` are analyzed with [[re-ghidra]] / [[re-ida]]

## Procedure

Run in order. Archive each step's products (path + sha256 + timestamp; a forensics requirement).

1. **Confirm dump source and architecture**:
   ```sh
   file dump.raw          # confirm it is a memory dump (MEMORY_IMAGE header / crash dump), not some other file
   vol -f dump.raw windows.info    # Windows image info; Linux/macOS have no info plugin — run the matching platform plugin to verify (for example linux.pslist / mac.pslist; normal output only when the symbol table is in place)
   ```
   - Pick the platform prefix by dump source: Windows uses `windows.*`, macOS uses `mac.*`, Linux uses `linux.*`; volatility3 identifies the profile automatically (simpler than vol2's hand-picked profile), but the first run must download the matching symbol file (see tool setup)
   - Input formats: a raw image (the primary format), LiME (the lime layer identifies it automatically), a Windows crash dump (the crash layer); a VMware .vmem (vol's built-in vmware layer identifies it automatically, so `-f` works directly); a hibernation file (hiberfil.sys) has no built-in layer — convert to raw first, or use a dedicated tool
   - A process-level dump (the gcore in [[re-memdump]] is a single-process ELF core, not a whole-machine image) cannot be parsed by Volatility — review it with gdb/eu-stack (see [[re-memdump]] step 3). This skill handles only a whole-machine image

2. **Process list**:
   ```sh
   vol -f dump.raw windows.pslist            # the ordinary process list (includes PID/PPID/timestamps)
   vol -f dump.raw windows.psscan            # pool scan; can find terminated/hidden processes
   vol -f dump.raw windows.pstree            # process tree; look for abnormal parent/child (for example IE spawned cmd)
   ```
   - Note suspicious PIDs: a parent that does not match (a browser spawned powershell), a common allowlisted process name/path that is abnormal (`svchost.exe` not in `C:\Windows\System32`)
   - Find terminated processes with psscan. Do not trust only pslist
   - Extra plugins: `windows.cmdline` shows the process command line (an obfuscated powershell -enc argument), `windows.svcscan` the service list (an abnormal service is often persistence), `windows.sessions` session and desktop ownership

3. **Network connections**:
   ```sh
   vol -f dump.raw windows.netscan           # network connections/listeners (TCP/UDP, including closed connections)
   vol -f dump.raw windows.netstat           # alternate: inferred from the flow table / related objects
   ```
   - Record: local/remote IP:port, owning process PID, connection state; an abnormal outbound connection (a high port that is not 53/80/443, a foreign IP) is a C2 clue and goes on the IOC list (hands off to [[re-ioc]])

4. **Injection / anomaly detection**:
   ```sh
   vol -f dump.raw windows.dlllist -p <pid>  # the process module list; look at abnormal paths (%TEMP%, the AD region)
   vol -f dump.raw windows.malfind           # scan hidden/injected executable memory (MEM_COMMIT + PAGE_EXECUTE_READWRITE and similar)
   vol -f dump.raw windows.hollowprocesses   # process-hollowing detection (replacement legitimacy)
   ```
   - After a malfind hit, `--dump` exports the suspicious range (`vol -f dump.raw windows.malfind --dump --pid <pid>`). Store sha256 of the extracted object and hand it to [[re-binary-core]] for a static deep dive
   - malfind has false positives (see pitfall 3) — cross-check with the dlllist path and execute-page permissions

5. **Credential clues and suspicious-object extraction**:
   ```sh
   vol -f dump.raw windows.registry.hashdump     # local-account NT/LM hashes (derived from the SAM + SYSTEM hives and the boot key)
   vol -f dump.raw windows.registry.lsadump      # LSA secrets (SECURITY hive)
   vol -f dump.raw windows.registry.cachedump    # domain cached credentials MS-CACHEv2 (the NL$KM key of the SECURITY hive)
   # the old forms windows.hashdump / windows.lsadump / windows.cachedump are deprecated aliases (marked in v2.27 for removal on 2026-09-25)
   ```
   - **Record the two credential sources separately. Do not write "LSASS memory" for all of them**: the three plugins above are all **registry-hive derived** (hashdump ← SAM + SYSTEM, lsadump/cachedump ← SECURITY) — provenance in the report should be written **registry-hive-derived**; extracting credentials from **LSASS process memory** is **another path** (a process dump + the matching tool). The two evidence sources differ
   - A hit is credential-leak evidence. Record the source and timestamp; offline cracking is handed to a password tool such as hashcat/john. This skill does not crack
   - Extract a suspicious object: `windows.dumpfiles` (a named file) or malfind/pslist `--dump` (`vol -f dump.raw windows.pslist --dump --pid <pid>` exports process memory); compute sha256 of each object and archive it
   - File-object pool scan: `vol -f dump.raw windows.filescan | grep -i <keyword>` finds deleted/suspicious file objects. After a hit, `windows.dumpfiles` extracts them (cross-check with `windows.svcscan` / `windows.amcache`)
   - A direct YARA scan: `vol -f dump.raw yarascan.YaraScan --yara-file <rule.yar>` scans kernel memory (an in-process VAD scan uses `windows.vadyarascan.VadYaraScan --yara-file <rule.yar> --pid <pid>`; both need yara-python) — apply the rules from [[re-ioc]] directly to the dump
   - A forensics timeline (when needed): `vol -r csv -f dump.raw timeliner` generates an event timeline (timeliner is a top-level plugin, with no windows. prefix; `-r/--renderer` is a vol-level option and comes before the plugin name; `-r csv` is the CSV renderer), for the report and [[re-ioc]] to cite

## Cross-domain

- [[re-forensics]]: this gateway's workflow step 2 — this skill is the memory-forensics stage
- [[re-memdump]]: where the dump product comes from (default dump first; see [[re-analyze/platform-tips]]); this skill only analyzes and does not collect
- [[re-malware]]: the deep-analysis path references this skill — after behavior analysis, look for memory residue (injection / in-memory payload / credentials)
- [[re-ti]]: extracted hashes/domains/IPs go to an intel lookup; credentials and injected objects go on the [[re-ioc]] IOC list
- [[re-ioc]]: credential hashes, network connections, and suspicious objects are summarized into IOCs and the report's evidence section
- [[re-binary-core]]: a static deep dive of suspicious objects extracted by malfind/dumpfiles
- Cites the "direct read vs dump" decision table in [[re-analyze/platform-tips]] (default dump first) and the Linux memory-dump extreme segments (vsyscall/vdso filtering)

## Common pitfalls

- **A mismatched symbol table → the whole parse is wrong**: symptom — `vol` reports `Missing Symbol` / the parsed process list is obviously absurd (system processes missing, addresses all 0); cause — volatility3 picks the profile automatically, but **the symbol table (ISF) must match the target exactly**: Windows is by PDB GUID/age (when missing it can be fetched automatically from the Microsoft symbol server), **Linux/macOS must match the kernel banner and there is no automatic fetch** — they depend on a community prebuilt pack or a build you do yourself with `dwarf2json` (needs a debug kernel) / `btf2json` (vmlinuz BTF + System.map); fix — `banners` first and get the kernel banner; on the Windows side, when the network is available, run `windows.info` directly to trigger the PDB download, and in a restricted environment use `--offline` + a pre-placed symbol directory; **on the Linux/macOS side you must find or build the matching ISF from the banner first**. When the banner misses, change version or build. Do not keep retrying the same file
- **An incomplete dump (vsyscall-segment pollution) → analysis bias**: symptom — malfind hits a mass of "injections" at 0xffffffffff6xxxxx, or extracted objects are all aligned garbage; cause — the dump did not filter `[vsyscall]` / `[vdso]` / `[vvar]` by maps (see the Linux memory-dump extreme segments in [[re-analyze/platform-tips]]), and junk pages were mixed in; fix — filter the extreme segments at dump time; during analysis, skip the 0xffffffffff6xxxxx address range. Do not treat junk pages as evidence
- **malfind false positives → false positives**: symptom — `windows.malfind` hits a mass of private executable pages, but dlllist has no abnormal module and the extracted object will not run; cause — a normal RWX page of a loader / garbage collector / JIT is also judged "anomalous". malfind only looks at memory attributes, not execution semantics; fix — cross-check three ways, the dlllist path, hollow detection, and an actual decompilation of the extracted object ([[re-binary-core]]), before concluding
- **Trusting only pslist misses terminated processes**: symptom — pslist is clean but network/file behavior points at a PID that has disappeared; cause — the process was already terminated, and the ordinary list does not include it; fix — also run `windows.psscan` (a pool scan finds residual objects). Forensics wants as complete a picture as possible.
- **A forensics report with no timeline**: symptom — the report has only a conclusion and no event order ("when it was injected, when it connected out"); cause — no timeline evidence was generated; fix — generate a CSV timeline with `vol -r csv -f dump.raw timeliner` (a top-level plugin, no windows. prefix; `-r/--renderer` is a vol-level option and comes before the plugin name). Archive process/network/credential events by time as the evidence section of the [[re-ioc]] report
- **An in-memory function-patch bypass → every ordinary plugin is clean**: symptom — malfind/dlllist are entirely clean, but the sample's ETW/AMSI is clearly suppressed (missing logs / a scan that does not respond); cause — the bypass does not inject new code. It rewrites the function head of an already-loaded module (for example the first 4 bytes of `EtwEventWrite` patched to `ret 14`, the first 3 bytes of `AmsiScanBuffer` changed to `return 0`, the start of `send` jumping to anonymous private memory). It creates no new executable page and does not change page permissions, so malfind does not notice; fix — run the built-in `windows.etwpatch` (detects ETW patch techniques, bundled from vol3 2.28), or dump the in-memory module and compare function-head bytes with the original DLL on disk
- **Sleep obfuscation → the payload "disappears" from the dump**: symptom — the implant cannot be found in the dump (no injected page, no file on disk), but behavior analysis confirms a C2 implant is running; cause — Ekko/Foliage-class sleep obfuscation flips VAD permissions to `PAGE_NOACCESS` / `PAGE_READWRITE` during sleep and encrypts the contents, and restores execution only at the instant of wake; fix — use vadinfo to find ranges whose permissions flipped / are NOACCESS, restore the encrypted pages in sleep with the rotating key, or pair with [[re-emulation]] and emulate execution at the wake point to capture plaintext
- **A BitLocker FVEK can be recovered from RAM (the mainline has no such plugin)**: symptom — you have an encrypted disk image plus a memory dump but no password, and data extraction stalls; cause — the full-volume encryption key (FVEK) remains in RAM while the system is running (it was not securely wiped), but mainline Volatility 3 has no built-in plugin; fix — run `windows.bitlocker.BitlockerFVEKScan` from the community `volatility3-bitlocker` plugin (`--tags FVEc Cngb`) to extract the FVEK, then mount and decrypt with `dislocker -k`; when a v3 plugin errors on an old kernel structure, fall back to Volatility 2 + breppo/Volatility-BitLocker
- **The plugin list is missing credential/YARA entries**: symptom — `vol --help` has no `windows.registry.hashdump` / `lsadump` / `cachedump` or yarascan; cause — the pycryptodome / yara-python dependencies are missing, and a plugin that fails to load is skipped silently (measured behavior of 2.28.0 in 2026); fix — after `pip install pycryptodome yara-python`, rerun `vol --help` and confirm the entries appear, then run the matching plugin
- **Running an old plugin name → the command does not exist or is about to stop working**: symptom — `windows.hashdump` written from old notes still runs but warns, or one day reports that the plugin cannot be found; cause — volatility3 plugin paths keep being reorganized (registry-class plugins have moved under `windows.registry.*`, and the old names are kept as deprecated aliases with a removal date, for example `windows.hashdump` marked for removal on 2026-09-25); fix — **use the current path** (see step 3), and record the version used in the report; distinguish "the **source directory** changed" from "the **command-line invocation name** changed" — the two do not necessarily move together (for example the malfind source is under `windows/malware/`, but **the invocation name is still `windows.malfind`**)

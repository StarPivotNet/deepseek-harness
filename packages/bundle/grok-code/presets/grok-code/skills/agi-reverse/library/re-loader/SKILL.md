---
name: re-loader
description: >
  Loader/dropper analysis: multi-stage download, in-memory load, module stitching.
  Triggers: `加载器`, loader, dropper, `投放器`, `内存加载`, `模块拼接`
capabilities: [malware-behavior]
---

# Loader / dropper analysis (download chain / in-memory load / module stitching)

## When to use / when not to use

- Use: the sample is a "downloader/dropper" — small, fetches later payloads dynamically, and at runtime loads/stitches the final module in memory
- Use: layer-by-layer recovery of a multi-stage payload chain (downloader → decompress → in-memory load → final RAT/ransomware/miner)
- Use: analysis of reflective loading / process hollowing / module-stitching delivery techniques
- Do not use: the sample itself is the complete payload (all function is visible statically; go to [[re-triage]] / [[re-binary-core]])
- Do not use: you only want static string extraction (survey with [[re-triage]] first; when downloader features are not obvious, static goes first)
- Note: dynamic analysis is a mandatory prerequisite ([[re-sandbox]], top principle in [[re-analyze/platform-tips]]) — a downloader must run before the download chain can be observed; analyze under network isolation

## Tool setup

Verify every tool before use. This skill is mostly dynamic analysis — the runtime and monitoring tools are reused from the skills below (install steps are in each skill). This skill adds two extraction tools.

### Dynamic environment (reused; a mandatory prerequisite before running)

- [[re-sandbox]]: VM snapshot + network isolation (INetSim is the key feed for the download chain — it simulates HTTP, accepts download requests, and can replay recorded responses; pitfall 1)
- [[re-tracing]]: strace / ltrace / ProcMon / APIMonitor — call-level tracking of download, decompress, and process operations
- [[re-behavior]]: procmon / sysdig / bpftrace — process tree, injection detection (process hollowing / APC / reflective load)
- [[re-memdump]]: gcore is the default dump — extract the in-memory payload
- Verify: the sandbox snapshot is ready + `strace -V` + `gcore --help` works

### python3 + pefile — in-memory module parse / stitch check (optional but common)

- python3 install is in the [[re-proto-rev]] tool setup
- `pip install pefile`
- Verify: `python3 -c "import pefile; print(pefile.__version__)"`

### pe-sieve / hollows_hunter — Windows in-memory process scan (optional)

- Source: GitHub hasherezade/pe-sieve releases and hasherezade/hollows_hunter releases. Unzip and run (Windows)
- Use: scan process memory and extract PE modules from reflective loading / process hollowing (the automation helper for step 3)
- Verify: `pe-sieve.exe /?` prints usage

### Payload unpack (reused)

- [[re-anti-analysis]] ([[re-packer-id]] / [[re-unpack-simple]] / [[re-unpack-advanced]]): after a payload lands it is often packed. The unpacked product returns to the sandbox and is rerun to verify

## Procedure

Run in order. Record evidence at each step (path + sha256, see [[re-triage]]). The "source" of each payload layer (URL/path/memory offset) and its sha256 are the core of the report ([[re-ioc]]).

1. **Identify the initial sample (downloader vs complete payload)**:
   ```sh
   file loader.bin && sha256sum loader.bin
   ls -la loader.bin                                   # a downloader is usually small (a few KB to a few hundred KB)
   strings -n 6 loader.bin | grep -iE 'http|url|download|temp|\.exe|\.dll' | head -30
   ```
   - Downloader features: small size, strings contain URLs/paths, and the import table is heavy on network and decompress APIs (WinINet/WinHTTP/URLDownloadToFile, CryptAPI, RtlDecompressBuffer); a complete payload is the opposite (all function is in itself)
   - Look the hash up on VT/community first ([[re-ti]]) to confirm family and existing conclusions. Do not start from zero
   - Judged a downloader → step 2; already a complete payload → static [[re-binary-core]] or behavior [[re-malware]]

2. **Track the download / decompress chain**:
   ```sh
   # inside a Linux sandbox
   strace -ff -o out -e trace=network,file,process ./loader.bin
   grep -E 'connect|sendto|openat|execve' out.* | head -50
   # inside a Windows sandbox: ProcMon filtered to the three categories network / file write / process create
   ```
   - Network: INetSim records the URLs and parameters the sample requests (download target, User-Agent, chunk parameters); with the network cut you never get later layers → replay the recorded response as feed (pitfall 1)
   - Decompress: watch RtlDecompressBuffer / 7z / Expand-class calls and the temp-file write path (%TEMP% is common); `sha256sum` and archive each layer's product
   - The chain does not trigger → anti-sandbox delay / interaction checks (pitfall 3). Return to [[re-sandbox]] environment disguise

3. **In-memory load analysis (reflective load / process hollowing)**:
   - Reflective load: VirtualAlloc(RWX) + manual PE parse + manual relocation (no LoadLibrary/NtMapViewOfSection call; all manual); features: a large allocation + write + execute, and no process creation
   - Process hollowing: NtUnmapViewOfSection (wipe the target process image) → NtWriteVirtualMemory (write the malicious image) → SetThreadContext + ResumeThread (switch execution from the suspended process)
   - Observe: [[re-behavior]] process tree / injection (sysdig `proc.name=loader` or ProcMon process operations + memory writes); [[re-memdump]] `gcore -o out <pid>` inside the window (timing in pitfall 2)
   - Windows automation: pe-sieve / hollows_hunter scans the process and extracts the in-memory PE (optional)

4. **Module stitching (multi-file assembly / multi-segment writes)**:
   ```sh
   # check after stitching: a module reassembled from memory slices / download fragments
   python3 - <<'EOF'
   import pefile
   pe = pefile.PE('mem_module.bin')      # parse the reassembled product
   print(pe.FILE_HEADER.Machine, len(pe.sections), pe.OPTIONAL_HEADER.AddressOfEntryPoint)
   EOF
   ```
   - Multi-file assembly: record the order of chunk parameters in the download log (range / chunked URL) → concatenate in order; when config and payload are stored separately, stitch the config first and then the code
   - Landing an in-memory module: slice and reassemble from the dump's memory layout and section alignment; if pefile verification fails → fix alignment/offsets (RWX section mapping, relocation-table repair)
   - Stitch/repair done → return to the step 1 survey (file/hash/entropy) and continue to the next layer

5. **Extract and analyze the final payload**:
   - file/hash/entropy ([[re-triage]]) confirms the final payload type: still a loader → iterate back to step 2; a RAT/ransomware/miner/spyware → go to [[re-malware]] (the full behavior/C2/report flow)
   - Packed → unpack with [[re-anti-analysis]]. The unpacked product returns to the sandbox and is rerun to verify ([[re-sandbox]]) before continuing
   - Put each layer's sha256 + source (URL/path/memory offset) into the report ([[re-ioc]] structure) and form the complete delivery chain

## Cross-domain

- [[re-sandbox]] / [[re-behavior]]: dynamic environment (mandatory prerequisite, top principle in [[re-analyze/platform-tips]]) and injection / process-tree detection — this skill is referenced by the [[re-malware]] gateway, and the sandbox is workflow step 1
- [[re-tracing]]: download/decompress-chain tracking (strace / ProcMon), step 2
- [[re-memdump]]: in-memory payload extraction (prefer the default dump; key experience in [[re-analyze/platform-tips]]: set the dump time by plaintext/code materialization. OEP is not a universal criterion), step 3
- [[re-anti-analysis]]: packed-payload handling and anti-sandbox bypass ([[re-packer-id]] / [[re-unpack-*]]), step 5
- [[re-protocol]]: download-protocol / C2 interaction analysis (netcap / proto-rev / crypto-*)
- [[re-ioc]]: each layer's hash / URL / file path becomes an IOC and part of the report
- [[re-malware]]: final-payload behavior analysis; ransomware cases go to [[re-ransomware]]
- Related branches in [[re-analyze/platform-tips]]: default sandbox, static first, direct read vs dump (set dump time by materialization), Linux/Windows platform branches (strace vs ProcMon)

## Common pitfalls

- **Multi-stage network download (cutting the network means you never get what comes next)**: symptom — the downloader is run with the network strictly cut, only layer-1 behavior is seen, later payloads are never obtained, and chain analysis stops; cause — the payloads are all remote, and a failed download breaks the chain at layer 1; fix — two phases: first identify the download URL in a controlled environment (INetSim/fake DNS), then replay the recorded bytes as a simulated response and feed them, layer by layer; archive each layer's response bytes and sha256 (step 2)
- **When to dump an in-memory payload**: symptom — a `gcore` dump is too early (the payload is not decrypted / not mapped executable) or too late (it already finished and was cleaned up), and the extracted module is incomplete / all zeros; cause — an in-memory payload exists complete only during the landing window; fix — locate the landing point from the trace log (network receive → write to memory → create a thread) and dump before the reflective entry / thread creation (key experience in [[re-analyze/platform-tips]]: set the dump point by plaintext/code materialization. OEP is not a universal criterion); pause the process on a breakpoint and then dump; dump several times and compare
- **Anti-sandbox delayed download**: symptom — after the sample detects sandbox features it sleeps for tens of seconds to hours, or waits for mouse/keyboard interaction before downloading, and a short observation window only shows "nothing happening"; cause — anti-sandbox delay and interaction checks (ATT&CK T1497.003 time evasion / T1497.002 user-activity detection; see the time/interaction-detection pitfall in [[re-sandbox]]); fix — [[re-sandbox]] environment disguise (real clock, simulated interaction, enough resources) + [[re-behavior]] with a longer observation window; if needed, patch the check point (the [[re-anti-analysis]] domain)
- **An encrypted payload must be decrypted first**: symptom — the downloaded "payload" has entropy >7.0 and is all random bytes, and static analysis has nowhere to start; cause — it is encrypted in transit / on landing (XOR/custom), and the loader decrypts it in memory only at runtime; fix — [[re-crypto-id]] / [[re-crypto-keys]] recover the algorithm and key from the loader statically, or [[re-memdump]] the decrypted form in memory directly (skip the on-disk form), instead of forcing analysis of the ciphertext
- **A self-extracting loader with a disguised suffix**: symptom — readelf errors and cannot parse; cause — the PHDR was deliberately filled with garbage (to interfere with parsing); fix — ignore the damaged PHDR and look only at valid LOAD segments; the standard pattern to recognize: entry → decompress function → mmap(RW) → decompress → mprotect(RX) → jump
- **Bit-operation-heavy code decompiles poorly**: symptom — Hex-Rays output is unreadable; cause — dense ARM64 bit operations; fix — switch to the disassembly view and analyze by hand (for bitstream reads / shifts / conditional branches, the decompiler is worse than reading the assembly directly)
- **A hand-written decompressor bug (carry semantics)**: symptom — a Python rewrite of the decompressor outputs the wrong bytes; cause — the refill-path return value / carry semantics were misread; fix — check carry semantics carefully against the assembly, and compare with known plaintext plus assertions
- **The entry offset is uncertain**: symptom — the meaning of the payload entry field is unclear; cause — the data-table field is undocumented; fix — follow the loader's actual jump target (`br mmap_base + offset`) and confirm the entry
- **The suffix cannot be trusted**: symptom — picking a toolchain from the suffix goes wrong; cause — a self-extracting sample disguises the extension; fix — `file` is always the first step; pick a parser implementation that tolerates errors (it can handle a damaged header)
- (Source: reverse-skill field-journal, MIT)

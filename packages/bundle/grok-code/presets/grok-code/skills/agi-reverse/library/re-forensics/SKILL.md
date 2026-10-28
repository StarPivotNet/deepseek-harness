---
name: re-forensics
type: gateway
description: >
  Memory-forensics / threat-intelligence gateway. Orchestration: dump source → memory forensics → lead extraction → intelligence correlation.
  Child skills: [[re-mem-forensics]] [[re-disk-forensics]] [[re-ti]], [[re-attribution]], [[re-hunting]], [[re-mobile-forensics]].
  Triggers: `内存取证`, `memdump分析`, `威胁情报`, `样本背景`, VirusTotal, MISP, forensics, threat intelligence.
capabilities: [memory-forensics, threat-intel, mobile-forensics]
---

# Memory forensics and threat intelligence

## Full workflow

1. Dump source: prefer an existing dump — first confirm whether a dump is already on hand. **Split by forensics layer**: a whole-machine image (LiME/AVML/crash dump, and similar, which Volatility can parse) → memory-forensics branch; a process-level `gcore` product is a single-process ELF core (no kernel structures; Volatility whole-machine plugins cannot parse it) → process-level replay only (gdb/`eu-stack`; see [[re-memdump]] (capability: `memory-dump`) step 3), and do not enter [[re-mem-forensics]] (capability: `memory-forensics`). Take the dump per [[re-memdump]] (capability: `memory-dump`) (dump timing follows plaintext/code materialization — a single-layer packer is usually appropriate near the real OEP; OEP is not a universal criterion; before the dump, filter `[vsyscall]`/`[vdso]` from `/proc/<pid>/maps`; see the [[re-analyze/platform-tips]] "direct read vs dump" decision table and the Linux memory-dump extreme-segment note)
2. Memory forensics: [[re-mem-forensics]] (capability: `memory-forensics`) — confirm dump source and architecture → process list (pslist) → network connections (netscan) → injection/anomalies (dlllist/malfind) → credential leads (hashdump/lsadump) and extraction of suspicious objects
3. Lead extraction: organize leads from the memory-forensics products — suspicious processes / injection addresses / network callbacks / credential hashes / extracted objects (modules, shellcode, plaintext keys); record an evidence path and timestamp for each item (forensics must be traceable; see [[re-analyze/platform-tips]])
4. Intelligence correlation: [[re-ti]] (capability: `threat-intel`) — look up hashes/domains/IPs from the leads on VirusTotal / Any.run / hybrid-analysis, correlate family and actor, and put the results into the IOC list and report in [[re-ioc]] (capability: `threat-intel`)

Archive each step's products (dump, plugin output, extracted objects) with sha256 + path, for the report and for [[re-ioc]] (capability: `threat-intel`).

## Which atomic skill (selection tree)

Branch on input features / goal:

- **Already have a dump, or the process is dead (.raw/.mem/.core)** → [[re-mem-forensics]] (capability: `memory-forensics`; process/network/injection/credential leads)
- **No dump; need to collect one on site** → [[re-memdump]] first (capability: `memory-dump`; prefer an existing dump, otherwise take one) → back to [[re-mem-forensics]] (capability: `memory-forensics`)
- **Need sample background ("what is this hash/domain/IP", "which family")** → [[re-ti]] (capability: `threat-intel`; VT/Any.run/hybrid-analysis/MISP)
- **Disk / filesystem forensics (deleted recovery, timeline, locating suspicious files)** → [[re-disk-forensics]] (capability: `disk-forensics`; disk-side forensics, parallel to memory-side [[re-mem-forensics]] (capability: `memory-forensics`))
- **Memory analysis found a suspicious object or callback that needs a deeper look** → suspicious module/shellcode to [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`; [[re-ghidra]] (capabilities: `decompilation`, `debugging`) / [[re-ida]] (capabilities: `decompilation`, `debugging`) static); callback-behavior verification to [[re-malware]] (capabilities: `malware-behavior`, `document-malware`, `evasion-analysis`, `key-extraction`, `threat-intel`; sandbox)
- **File static analysis only, no memory involved** → not this gateway; go to [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`) / [[re-malware]] (capabilities: `malware-behavior`, `document-malware`, `evasion-analysis`, `key-extraction`, `threat-intel`)
- **Container image (image tar exported by docker save/skopeo)** → the "Container image forensics" section below

## Container image forensics

- **Image structure**: tar archive + layers (each layer = a filesystem-snapshot delta; exported by `docker save` / `skopeo copy`)
- **Layer extraction**: unpack the layer archives → per-layer filesystem analysis (reuse the methods in [[re-disk-forensics]] / [[re-fw-rootfs]]: file enumeration, deleted-file recovery)
- **What to look at**: config and keys (environment variables, mount points, entrypoint/CMD scripts), residue in historical layers (deleted files are still recoverable from older layers), malicious-image determination (startup command, network behavior, suspicious binaries)
- **Output**: image content inventory + suspicious-item list (joins indicator extraction in [[re-ioc]])

## Cross-domain joins

- This gateway is referenced by the [[re-malware]] deep-analysis path — after behavior analysis, when you need to check memory residue (injection, in-memory payloads, credentials), hand off to [[re-forensics]]; intelligence-correlation results go back to [[re-malware]] to support the family call
- Disk-side [[re-disk-forensics]] sits beside memory-side [[re-mem-forensics]] — disk evidence (deleted files/timeline) and memory evidence (process/network/credentials) corroborate each other
- Dump products come from [[re-memdump]] (prefer an existing dump; see [[re-analyze/platform-tips]])
- Intelligence joins [[re-ioc]] — [[re-ti]] query results and [[re-mem-forensics]] leads roll up into an IOC list and report
- Deep dive on suspicious objects (extracted modules/shellcode) → [[re-binary-core]] ([[re-ghidra]] / [[re-ida]] decompilation)
- This gateway is called by the [[re-analyze]] triage path "memory forensics / intelligence lookup"

## Common pitfalls

- Skipping the dump-source check and running analysis immediately → tools and dump architecture do not match, and everything is wrong — confirm the source with [[re-memdump]] first, and take a complete dump per the [[re-analyze/platform-tips]] prefer-existing-dump rule
- Dump polluted by vsyscall/vdso garbage pages → skewed analysis results — extreme segments must be filtered before the dump ([[re-analyze/platform-tips]] Linux memory-dump extreme segments)
- Forensics results with no evidence chain → the report cannot be reproduced — archive each step's products (path + sha256 + timestamp)
- Drawing a conclusion from memory leads without reporting and verifying them → false call — deep-dive suspicious objects statically first ([[re-binary-core]]), and confirm background through [[re-ti]] more than once

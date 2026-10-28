---
name: re-anti-cheat
description: >
  Anti-cheat countermeasure analysis: EAC/BattlEye drivers, memory integrity checks, detection-mechanism recovery.
  Triggers: `反作弊`, EAC, BattlEye, `内存校验`, anti-cheat
capabilities: [kernel-analysis]
---

# Anti-cheat countermeasure analysis (EAC / BattlEye / memory integrity)

## When to use / when not to use

- Use: analyze how anti-cheat components (EAC / BattlEye / Vanguard and similar) drivers and services work, and how the detection mechanisms work
- Use: after a game process is rejected/kicked by anti-cheat, understand "what was detected" (defense and study perspective)
- Use: static reversing of an anti-cheat driver (DriverEntry, IRP, memory-integrity logic) and kernel-debug observation
- Do not use: building or distributing a cheat / implementing a bypass in a real game environment (**explicitly forbidden; see the authorization boundary**)
- Do not use: only the game's own logic (memory edits, CE) → [[re-game]]
- Do not use: ordinary driver analysis ([[re-kernel]]); user-mode anti-debug ([[re-evasion]])
- **Authorization boundary (required reading)**: this skill is limited to authorized research — your own device, your own game account, a lab environment, or security research with written permission. Forbidden: building/distributing cheat software, using a bypass in an online game to gain an unfair advantage, or using detection-mechanism analysis to cause harm. Every dynamic experiment runs inside an isolated sandbox ([[re-analyze/platform-tips]] supreme rule); conclusions are produced from a defense and research perspective (understand the detection surface → improve detection), and do not produce an operable bypass tool.

## Tool preparation

Anti-cheat analysis = driver reversing + kernel debugging, entirely inside an isolated sandbox ([[re-analyze/platform-tips]] supreme rule). Verify every tool before use.

### Driver-analysis base ([[re-kernel]])

- Driver static work: DriverEntry / IRP dispatch / callback recovery methods are in [[re-kernel]] "Procedure"
- Decompile: [[re-ghidra]] (default; after importing a .sys, Data Type Manager loads kernel types)
- Verify: after importing an EAC/BE driver .sys, DriverEntry decompiles

### Kernel debugging ([[re-windbg]])

- Dual-machine/VM serial (COM Named Pipe) or KDNET setup is in [[re-windbg]] "Tool preparation"
- **Kernel debugging is the primary way to observe the kernel-side execution path of an anti-cheat driver** — it is not the only dynamic method for the whole anti-cheat system (user-mode components have other observation surfaces; see pitfall 1)
- Verify: in a kernel session `lm` shows the target anti-cheat driver module, and `.reload /f <driver name>` loads symbols

### Fast user-mode location ([[re-x64dbg]] / [[re-windbg]])

- [[re-x64dbg]]: quickly inspect helper components outside the protected process (loader, service side)
- The target may carry PPL protection, but **that is not guaranteed** — check the real protection level before deciding (`GetProcessInformation(..., ProcessProtectionLevelInfo, ...)` / Process Explorer / WinDbg); only a level other than `PROTECTION_LEVEL_NONE` is PPL (see pitfall 1)
- Verify: `x64dbg` can open an ordinary target exe

### System tools (service/driver enumeration)

- Built into Windows: `sc query` / `driverquery` / `fltmc` (filesystem minifilter list)
- Sysinternals (Microsoft site): Process Explorer (`process explorer` to see the protected-process mark), Sysmon
- Verify: `driverquery` prints the driver list; `sc query EasyAntiCheat` (the EAC service name changes by version)

## Procedure

Run in order. Record an evidence path + sha256 for each step's artifacts (component inventory, IRP table, integrity-logic notes) (see [[re-triage]]) so the report can cite them. **Every step stays inside the authorized scope and the sandbox** (authorization boundary: "When to use").

1. **Identify anti-cheat components (driver / service)**:
   ```sh
   driverquery /v | findstr /i "anti cheat easy battle"     # driver-layer components
   sc query | findstr /i "anti cheat easy battle vanguard"  # service-layer components
   fltmc                                                    # filesystem minifilters (integrity checks often live here)
   ```
   - Typical components: EAC (EasyAntiCheat.sys + a user-mode loader), BE (BEDaisy.sys + a user-mode service), Vanguard (vgk.sys driver + a resident service); each vendor also has an update service / anti-tamper watchdog
   - Record: a component inventory (driver name / service name / install path) + the driver file sha256 (version anchor; see pitfall 3) + self-protection state (**check the actual protection level**; do not assume PPL)

2. **Driver integrity analysis (memory scan / integrity)**:
   - Static recovery ([[re-kernel]] method): DriverEntry → IRP dispatch table (`IRP_MJ_DEVICE_CONTROL` and others) → the user-mode IOCTL interface; focus on:
     - Integrity check: timed/triggered hashes of the game process code and data sections (read the target process memory with something in the `MmCopyVirtualMemory`/`KeStackAttachProcess` class, then hash it)
     - Memory scan: scan the game process memory by signature (looking for modified code / injected modules)
     - Callback registration: `PsSetCreateProcessNotifyRoutine` (watch process creation), `PsSetLoadImageNotifyRoutine` (watch module loads) — the trigger entries for integrity logic
   - User-mode components: loader and service (decompile with [[re-binary-core]]) — heartbeat, report channel, update check
   - Output: a detection-mechanism inventory (trigger → what is checked → disposition action)

3. **Detection-evasion thinking (research inside the authorized scope)**:
   - Study "how the detection mechanism works" (defense perspective), organized as a detection-surface inventory (integrity check / memory signature / behavior timing / driver-layer monitoring)
   - Analysis output for each detection surface: detection condition, trigger frequency, report channel (who receives the alert, in what format)
   - **Do not implement**: evasion in a real game environment, bypass-tool development, cheat distribution — that is outside the authorization boundary (pitfall 2)
   - Suggested uses of the analysis: detection improvement (for the vendor / defense side), rule writing ([[re-ioc]] approach: driver signatures, behavior patterns)

4. **Kernel countermeasure (join with [[re-kernel]])**:
   - Kernel debug session ([[re-windbg]]): breakpoints on callback functions / check functions to observe trigger timing and arguments
   - Anti-cheat driver countermeasures against a debugger: detect the debug port / clear debug registers (`!dr`) / bluescreen bait — while analyzing, record the countermeasures (they are part of the "detection surface" from the defense perspective); every response stays in the sandbox + a snapshot ([[re-analyze/platform-tips]] supreme rule)
   - Bluescreen risk: do every breakpoint/trigger experiment inside the debug VM, and take a snapshot before operating ([[re-kernel]] pitfall 4)
   - Output: debug-session record + a countermeasure inventory

5. **Analysis report (compliance boundary)**:
   - Report structure: authorization-scope statement → component inventory (version/hash) → detection mechanisms (trigger/content/action) → countermeasures → defense recommendations
   - Compliance points: the report states the authorized environment and purpose; it does not contain operable bypass steps; it does not publish driver keys/signature material; sensitive conclusions go through responsible disclosure (vendor security team / bug bounty)
   - Output: archived report (sha256)

## Cross-domain joins

- [[re-kernel]]: the driver-reversing methodology base (DriverEntry / IRP / callbacks) + kernel-debug cooperation — this skill always depends on it
- [[re-windbg]]: kernel debug session, `!analyze -v`, breakpoints and scene recovery (the primary way to observe a kernel driver's execution path)
- [[re-x64dbg]]: fast location of user-mode helper components (loader/service)
- [[re-game]]: game-side memory edits / CE approach — the "object being detected", for comparison
- [[re-evasion]]: user-mode anti-debug / anti-analysis countermeasure framework (compare with driver-layer countermeasures)
- [[re-ioc]]: detection signatures → YARA rules / behavior-pattern output (defense perspective)
- [[re-sandbox]] / [[re-analyze/platform-tips]]: isolated sandbox + snapshot supreme rule (bluescreen and sample risk)

## Common pitfalls

- **Treating every attach failure as PPL**: symptom — a user-mode x64dbg/WinDbg attach to the target is refused ("cannot attach") or the process exits/bluescreens immediately after attach, and you record "the target is PPL"; cause — **PPL is Windows' own process-protection mechanism, with an explicit protection level and signer semantics** (`PROCESS_PROTECTION_LEVEL_INFORMATION` distinguishes `PROTECTION_LEVEL_NONE`=unprotected, `PROTECTION_LEVEL_PPL_APP`=a third-party app enabled process protection, and so on), and **there is no general rule "an anti-cheat driver is loaded ⇒ the game automatically becomes PPL"** — anti-cheat can do access filtering, object callbacks, integrity checks, and anti-debug only on the kernel side while the target process remains an ordinary process; **a refused attach is only a symptom and cannot be inverted into PPL**; fix — first check the **real** protection level (`GetProcessInformation(..., ProcessProtectionLevelInfo, ...)`, Process Explorer's Protection column, WinDbg reading `EPROCESS.Protection`); only a level other than `PROTECTION_LEVEL_NONE` is called PPL; when an ordinary process refuses attach, investigate separately: the anti-cheat handle-access filter / object callbacks (`ObRegisterCallbacks` stripping debug rights), user-mode anti-debug, a self-termination policy, debugger detection (debug port, debug registers, `NtQueryInformationProcess` debug status)
- **"Kernel debugging is the only dynamic method"**: symptom — because user-mode attach does not work, the whole analysis is limited to kernel debugging and other observation surfaces are skipped; cause — equating "the driver kernel side" with "the whole anti-cheat system"; fix — **when analyzing a kernel driver's internal execution path, kernel debugging in an isolated environment is primary** (dual-machine/VM, [[re-windbg]], the target inside the VM and the debugger on the host, breakpoints on kernel callbacks/check functions rather than inside the game process, everything inside the sandbox + a snapshot, roll back on a bluescreen); but the user-mode service/launcher, IPC, file and registry activity, ETW/system events, network interaction, and process and module lifecycle **each have a matching dynamic observation method**, and they do not stop working because attach failed
- **Legal boundary (authorized research environments only)**: symptom — the analysis is used to build a cheat / cheat online / sell a bypass tool, triggering legal and game-vendor countermeasures (bans, lawsuits); cause — anti-cheat analysis naturally sits next to cheat technique, and using a bypass in a real game environment is infringement/breach; fix — strictly limit the authorized scope (your own device, your own account, a lab with written permission); the report is defense-facing only (how the detection mechanism works, how to improve detection); do not publish operable tools and do not publish sensitive driver material; the boundary is "understand the detection surface", not "a successful bypass" as the deliverable
- **Anti-cheat updates often (conclusions expire)**: symptom — function addresses/offsets/detection points analyzed last week all fail, and the report conclusion is "stale"; cause — EAC/BE ship a version every few days, and driver packing/obfuscation and structure change often; fix — analysis must be anchored to a version: record the driver sha256, file version, and analysis time (step 1); the report states version and date; methods (IRP recovery, callback enumeration, IOCTL decode) reuse across versions, but concrete addresses/offsets do not
- **Bypass techniques escalate (the analysis direction is wrong)**: symptom — a "weakness" you analyzed is patched quickly or triggers a new detection, and you fall into point-by-point confrontation; cause — anti-cheat is a continuous adversarial engineering effort, and a single-point bypass will be escalated; fix — position the analysis as "understand the detection surface" (system view) rather than "manufacture a vulnerability" (single-point view); organize output by detection surface (integrity/memory/behavior/driver layer) and give defense recommendations; an escalation case is itself defense-research material (record the old vs new detection mechanism)
- **The CSAuth3 heartbeat protocol is self-contained and can be reproduced offline (GameGuard)**: symptom — black-box guessing of an anti-cheat heartbeat packet (header KDF + payload transform + double CRC) is error-prone, and static reversing has nowhere to start; cause — CSAuth3 is a heartbeat challenge-response loop between the GameMon client and the peer (the peer sends a challenge packet, the client replies with a heartbeat packet), and **all cryptographic material is hardcoded constants** (Blowfish K=0x91284712, the public π table); only counter and prev_size change with the session — the first packet has seed=0 (counter=0, K=0x91284712, an 8-byte all-zero payload, and an empty payload is not scrambled); fix — recover layer by layer as "header KDF decrypt → CRC1 → Blowfish inverse transform → CRC2"; **scramble/descramble are the same function** (Blowfish encrypt/decrypt symmetry: the sender runs the plaintext TLV through `bf_dec` once to get the on-wire ciphertext, and the receiver runs `bf_dec` again to recover it); when constructing a packet you must **scramble first, then compute CRC2** (CRC2 checks the payload after descramble); the key schedule is fixed offline → a pure offline heartbeat is possible
- **The error-code table is a black-box accelerator for heartbeat replay**: symptom — a constructed heartbeat packet is rejected by the peer and you do not know which check layer failed; cause — CSAuth3 returns a different error code for each check failure (0xBAE first-packet flag is normal, 0xCE9 CRC1 mismatch, 0xCE8 CRC2 strict mismatch, 0xBB8 CRC2 mapped-mode base, 0xCE5 seq>5, 0xCEA magic≠0x1E, 0xCEF/0xCEC size out of range, 0xD4A body not 8-aligned, 0xD52 message count mismatch, 0xD913 message-type-1 hash failure, and others); fix — invert the failed layer from the error code (an error ≥0xBB8 sets the error flag → later Check falsely passes and Get stops sending); hooking the client callback handler that processes the challenge packet tells you directly what should be sent, and forwarding is enough
- **CR3 encryption (EAC-class kernel anti-cheat)**: symptom — the value read from `_KPROCESS.DirectoryTableBase` is the wrong CR3, and walking process memory is garbage / access faults; cause — anti-cheat takes over kernel exceptions and writes a wrong value into DirectoryTableBase; operations that need that field (attach / read process) raise an exception, and the real value is repaired only inside the taken-over exception callback; fix — a common way to obtain the real CR3: **the page-frame ListEntry.Flink points at the encrypted process K/EPROCESS structure pointer**; walk `MmPfnDataBase` and compare each page frame's decrypted Flink value with the target process structure; a hit is the real CR3; watch version differences: the encryption algorithm on Win11 24H2 and some later Win10/11 builds (visible in `MiSetPageTablePfnBuddy`) differs from other versions and must be adapted per version; confirm the target OS version before analysis (see the [[re-kernel]] pitfall that structures change by version)

---
name: re-evasion
description: >
  Detection-evasion / EDR-countermeasure analysis: AMSI/ETW bypass, fileless, lolbin chains.
  Triggers: `规避`, evasion, AMSI, ETW, `无文件`, lolbin, `EDR绕过`
capabilities: [evasion-analysis]
---

# Detection evasion and EDR countermeasure analysis

## When to use / when not to use

- Use: after a malicious sample/tool is detected (AV, EDR), analyze its evasion techniques — AMSI bypass, ETW disable, fileless execution, lolbin chains
- Use: answer "why it was detected" and "where the bypass point is" (align with the detection side, step 5)
- Use: execution-chain analysis of a fileless/in-memory payload (a sample whose payload does not land on disk)
- Do not use: pure static code analysis (that is [[re-binary-core]]); dynamic analysis that does not care about the bypass mechanism and only observes behavior (that is [[re-behavior]])
- Do not use: writing detection rules themselves (that is YARA and the detection-engineering side of [[re-ioc]])
- Note: this skill is mainly Windows (AMSI/ETW/lolbin are all Windows concepts); similar countermeasures on Linux/macOS (ptrace detection, Dyld injection, kext bypass) use the same "identify evasion → locate the bypass point" frame

## Tool setup

Evasion analysis requires dynamic execution + memory forensics: entirely inside a sandbox ([[re-sandbox]] is a mandatory precondition, [[re-analyze/platform-tips]] highest principle). Verify every tool before use.

### amsi.dll memory comparison — main AMSI-patch locator (no standalone package)

- Principle: compare on-disk `C:\Windows\System32\amsi.dll` byte-for-byte with in-memory amsi.dll; a function-head difference is the patch point
- Take a memory copy: Sysinternals procdump (Microsoft site / `winget install Microsoft.Sysinternals.Procdump`) `procdump -accepteula -ma <pid> mem.dmp`; or a full dump with [[re-memdump]] (gcore/WSL)
- Verify: for a scene where the sample is not running, fall back to AMSITrigger; the comparison script is in step 2

### AMSITrigger — locate strings that trigger an AMSI scan (by Outflank)

- Download: search GitHub for `AMSITrigger` (the original outflanknl repo is unavailable; community mirrors are common, such as RythmStick/AMSITrigger); a .NET tool, unzip and use
- Verify: `AMSITrigger.exe -i test.ps1` prints per-line trigger status (Detected / Not Detected)
- Use: analyze "which strings in the script trigger detection" → the corresponding obfuscation/evasion target

### ETW monitoring — logman / SilkETW / WPR / ETWConsumer-class tools

- logman (built into Windows): verify `logman query providers | findstr /i sysmon`; `logman query -ets` shows active sessions
- SilkETW (Mandiant open source, C#): download GitHub releases; verify: `SilkETW.exe -t user -pn Microsoft-Windows-Sysmon -ot file -p out.etl` can produce a .etl
- WPR (Windows Performance Recorder, built in): `wpr -start` then `wpr -stop out.etl`
- Third-party ETW consumer tools such as ETWConsumer (search GitHub, as needed); a local alternative for viewing providers: `tracerpt` parses .etl
- Use: confirm whether ETW was disabled — an interrupted/missing event stream is disable evidence (see step 3)

### Sysmon / procmon — process chain and execution behavior (lolbin chain tracing)

- Sysmon (Sysinternals, official Microsoft): config includes ProcessCreate (event 1, records parent/child process and command line); verify: `Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Sysmon/Operational';Id=1} | select -First 1`
- procmon (Sysinternals): files/registry/process/network in full, filterable by process tree; verify: `procmon.exe /AcceptEula /Quiet` can start
- Neither has a distro package; download from the Microsoft site / Sysinternals

## Procedure

Run in order. Archive each step's products (memory dump/ETL/log/command-line walk record) with sha256 + path (the [[re-ioc]] evidence-chain requirement).

1. **Identify the evasion technique (classify first, then go deep)**:
   - Input: sample/tool + detection-trigger information (AV alert, EDR log, sandbox alert)
   - Classification list (archive by signature): AMSI bypass (patch / reflective load), ETW disable (patch provider / mask), fileless (in-memory execution / registry Run key + remote script / WMI), lolbin chain (rundll32 / mshta / regsvr32 / WMI / PowerShell), string-encoding obfuscation (anti-signature)
   - Evidence collection: run inside a sandbox ([[re-sandbox]]) → Sysmon/procmon records the process-creation chain and command line; at the same time [[re-memdump]] keeps a memory snapshot (prefer an existing dump, [[re-analyze/platform-tips]] "direct read vs dump"); turn on PowerShell ScriptBlock logging (event 4104) and module logging
   - First run an unpatched baseline sample to confirm "the detection trigger point" (see pitfall 5 and align with step 5)

2. **AMSI bypass analysis (locate the memory patch)**:
    ```sh
    procdump -accepteula -ma <pid> mem.dmp        # 运行后取进程内存（或 gcore，见 [[re-memdump]]）
    # 对照: 磁盘 amsi.dll 与内存中 amsi.dll 的函数头字节
    # 常见 patch: AmsiScanBuffer 入口改为直接返回 0x80070057（"AMSI 已初始化"假成功）
    #            或 EtwEventWrite 系列前几字节 patch 成 ret
    ```
   - Location method: the entry offset of AmsiScanBuffer in on-disk amsi.dll (Ghidra/IDA or `dumpbin /exports`) → compare bytes at the same offset in the memory dump; a difference is the patch point
   - Other forms: hook before reflective-loading amsi.dll (Detour to user code), CLR-side bypass (the managed layer turns off the AMSI provider)
   - Use AMSITrigger to verify "which strings trigger" → the sample's obfuscation target and bypass effectiveness corroborate each other
   - Before locating the patch, confirm the environment baseline: when the sample is not running, on-disk and in-memory amsi.dll match (exclude interference from the EDR's own hook; see pitfall 4)

3. **ETW disable analysis**:
    ```sh
    logman query -ets                                   # 活动会话；与样本运行前后对比
    # SilkETW 捕获: 运行样本前后各抓一段，对比事件数量/内容
    # 定位: 内存中 ntdll 的 EtwEventWrite / EtwEventWriteEx 前几字节 vs 磁盘（同步骤 2 对照法）
    ```
   - Disable evidence: after the sample runs, the ETW event stream breaks (some provider has zero events / overall loss); the patch point is usually `EtwEventWrite*` in ntdll
   - Confirm scope: global disable (patch EtwEventWrite itself) vs a specific provider disable (patch that provider's enable mask/Level) — decides the blast radius and the detection-side recovery recommendation
   - Often combined with AMSI (one patch, several targets); the comparison report links the two (see pitfall 1)

4. **Trace the lolbin chain (rundll32/mshta and similar)**:
    ```sh
    # Sysmon 事件 1（ProcessCreate）按进程树关联，重点看父进程 + 命令行
    Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Sysmon/Operational';Id=1} |
      Select TimeCreated, @{n='Parent';e={$_.Properties[1].Value}}, @{n='Image';e={$_.Properties[3].Value}}, @{n='Cmd';e={$_.Properties[4].Value}}
    ```
   - Typical chains: `cmd → rundll32.exe javascript:"..."`, `regsvr32.exe /s /n /u /i:http://... scrobj.dll`, `mshta.exe javascript:...`, `powershell -enc ...` → in-memory payload
   - Key: looking only at the sample's own process misses the real behavior (the sample borrows a whitelisted process to execute — see the brokered-execution pitfall in [[re-sandbox]]); observe the whole process tree, and record parent → child level by level
   - Fileless call: the process image path is unusual (%TEMP%), a script engine (wscript/cscript/mshta) loads remote or pure-memory content, and there is no matching on-disk file — payload evidence depends on the memory dump and the command line (see pitfall 3)

5. **Align with the detection side (why it was detected → the evasion point)**:
   - Compare what the detection alert hit (trigger string / behavior signature / import-table feature) with the evidence from steps 2-4, and form: detection point (AV signature / behavior rule) → evasion point (patch/obfuscation/lolbin) → the gap that can still be detected (see pitfall 4 version differences)
   - Output: an evasion-technique list + matching IOCs — hashes of amsi.dll/ntdll after the memory patch, command-line patterns of lolbin combinations, memory signatures of the fileless payload (into [[re-ioc]] YARA)
   - The conclusion must annotate the verification environment (OS version / EDR version / AV); an evasion-effectiveness claim carries a version limit

## Cross-domain joins

- [[re-anti-analysis]]: this skill is that gateway's detection-evasion branch — packing/obfuscation is "static anti-analysis", AMSI/ETW/fileless is "detection countermeasure", and they sit side by side in the orchestration
- [[re-sandbox]]: dynamic execution is a mandatory precondition — evasion analysis stays in an isolated environment the whole time (network isolation + snapshot; see the [[re-analyze/platform-tips]] highest principle)
- [[re-memdump]]: memory-patch location and fileless-payload forensics (prefer an existing dump)
- [[re-behavior]]: process-chain / execution-behavior observation (behavior-side corroboration of the lolbin chain)
- [[re-tracing]]: API-call tracing — the call sequence of the patched target functions (AmsiScanBuffer/EtwEventWrite) corroborates whether the bypass took effect
- [[re-ioc]]: evasion signatures (memory hashes / command-line patterns / lolbin combinations) go into IOCs and YARA rules
- [[re-malware]]: evasion-layer analysis of a malicious sample (after re-malware behavior analysis, hand off here to dig into evasion)
- [[re-ebpf]]: identify and counter resident bpf hooks (fentry/kprobe/tracepoint/cgroup)
- Cites the [[re-analyze/platform-tips]] highest principle (default sandbox) and the Windows branch

## Common pitfalls

- **Evasion techniques intertwine with anti-sandbox**: Symptom — inside the sandbox the sample looks "normal" (no evasion action at all), and only bypasses in a real environment; cause — the evasion code also contains anti-sandbox detection (probe the environment first, then decide whether to enable the bypass); fix — separate "evasion analysis" from "environment disguise" (the [[re-anti-analysis]] domain): locate anti-sandbox detection points first (the interaction/time/hardware-fingerprint pitfalls in [[re-sandbox]]), or first stretch the window per the delayed observation in [[re-behavior]], then analyze the evasion logic
- **An AMSI patch triggers an integrity check**: Symptom — after the patch, sample behavior is abnormal / it crashes / detection actually escalates; cause — EDR/Defender checks amsi.dll/ntdll memory integrity (compares a hash with disk; see the [[re-anti-analysis]] AD13 self-check approach), or the sample itself self-checks; fix — first confirm the check exists (how often the memory hash is recompared); patch a place the check cannot see (a hook rather than the function body, keep the overall hash consistent); when analyzing, record the patch timing and the check trigger point
- **Fileless samples are hard to forensics**: Symptom — there is no sample file on disk, the report has no "physical evidence", and the conclusion will not stand; cause — the payload lived entirely in memory / a remote script / a registry Run key, and ordinary file forensics cannot catch it; fix — before the run, take a full [[re-memdump]] dump + procmon/Sysmon records of the command line and network; turn on PowerShell ScriptBlock logging (event 4104); the conclusion rests on memory evidence + command line + network flow; [[re-ioc]] collects memory-hash-class signatures
- **EDR version differences**: Symptom — the same patch technique succeeds in environment A and fails or alerts in environment B; cause — patch offsets (such as the AmsiScanBuffer entry bytes) change with Windows patches and EDR hook versions; fix — confirm the offset on the live scene (the memory-comparison method in step 2 does not depend on a fixed offset; do not trust hardcoded offsets from the internet); annotate the verification-environment version on the conclusion, and put a version limit on any evasion-effectiveness claim
- **Missing detection logs → wrong direction**: Symptom — there is no Sysmon/EDR log, "why it was detected" cannot be confirmed, and analysis has nothing to align to; cause — the environment was not configured to collect logs (default Windows does not record ProcessCreate details); fix — add a Sysmon config (ProcessCreate + NetworkConnect + ImageLoad) + PowerShell 4104, and rerun to reproduce; capture the full detection-alert information (AV UI / EDR events) before analyzing

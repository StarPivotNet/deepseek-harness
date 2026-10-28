---
name: re-license
description: License-verification logic analysis: locating registration checks. Triggers: `注册码`, `授权验证`, license, `序列号校验`, `破解定位`
capabilities: [license-analysis]
---

# License-verification logic analysis (locating registration checks)

## When to use / when not to use

- **Boundary (inherited from [[re-cracking]])**: limited to your own software / authorized testing / a CTF or research environment; unauthorized software unlock and commercial-software bypass are forbidden; before a dynamic step such as watching a return value at a breakpoint, the user must state target ownership (ownership / test authorization / research environment)
- Use: the program has a registration / activation flow (enter a serial, a registration code, a license file), and you need to locate "where it checks, and how it checks"
- Use: a cracking prerequisite — give [[re-patching]] / [[re-keygen]] the check-point addresses and the check algorithm
- Use: decide whether authorization is online activation or an offline check; identify machine-code binding and validity / subscription licenses
- Do not use: the check branch is already located and you only change bytes to bypass it (go straight to [[re-patching]])
- Do not use: you have confirmed there is no authorization mechanism (no registration UI / registry / license-file read — tell the user honestly; see pitfall 5)
- Do not use: you only want protocol-layer analysis (traffic analysis of online activation goes to [[re-protocol]])
- Note: a packed sample is unpacked first ([[re-anti-analysis]]); an obfuscated check function goes to [[re-deobfuscate]] first (see pitfall 1); dynamic steps run in a sandbox ([[re-sandbox]], top principle in [[re-analyze/platform-tips]])

## Tool setup

### Debugger (by OS)

- Debugging a PE under Linux / Wine: [[re-gdb]] — `apt install gdb` / `dnf install gdb` / `pacman -S gdb`, verify `gdb --version`; **Wine direct-read**: after `wine sample.exe` runs, `gdb -p <pid>` attaches (the Linux branch of [[re-analyze/platform-tips]])
- Windows: [[re-x64dbg]] — official release zip; attach needs administrator rights (the Windows branch of [[re-analyze/platform-tips]]); verify: loading the sample can single-step
- macOS: [[re-lldb]] — `brew install lldb`, verify `lldb --version`; before attach, check Developer Tools authorization (the macOS branch of [[re-analyze/platform-tips]])
- WSL: cannot attach a Windows process — cross-boundary analysis uses Windows-side tools, and inside WSL only static work is done (the WSL branch of [[re-analyze/platform-tips]])

### Decompiler ([[re-ghidra]] and others; the cross-reference workbench)

- Ghidra: `apt install ghidra` / `dnf install ghidra` / `pacman -S ghidra` / `brew install --cask ghidra`, verify `analyzeHeadless -help` (install detail is in [[re-ghidra]])
- Alternatives: [[re-ida]] (headless `idat`; commands are in that skill), [[re-radare2]] (the install matrix is in that skill; after install, verify with `rizin -v`)
- Role: xrefs of strings / APIs are the key to "who is calling a registration-related function"

### strings — a fast scan of printable strings (all platforms)

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils` (usually already present)
- macOS: bundled /usr/bin/strings
- Windows/WSL: the Linux build inside WSL; on native Windows, Sysinternals `strings.exe`
- Verify: `strings --version`

### Dynamic extras (optional): strace / ltrace / ProcMon

- Linux: `apt install strace ltrace`, verify `strace --version`; observe registry (under Wine) / file / API calls (detail in [[re-tracing]])
- Windows: Sysinternals Process Monitor (download the standalone exe from the site; no package manager) — a full trace of registry / file / process / network (hands off to [[re-behavior]]); registry operations are the main path of a license read

## Procedure

Run in order and record each step (check-point address + evidence path, see [[re-triage]]). Product: **the full check-point list + the check algorithm**, handed to [[re-patching]] / [[re-keygen]].

1. **Locate the check function from string / API cross-references**:
   ```sh
   strings -n 5 sample.exe | grep -iE 'register|serial|license|invalid|activation|trial|key' | head -50
   strings -el sample.exe | grep -iE 'register|serial|license' | head -20    # UTF-16LE (common on Windows)
   ```
   - In the decompiler, xref a hit string (Ghidra right-click Find References / IDA `x` / rizin `axt @ str.*`) — see which function references it: **the referencing function near a dialog/input box is the candidate check function** (a MessageBox-class "Invalid registration code", a registration dialog, a registry read `RegOpenKeyExW` / `RegQueryValueExW`, a machine-code read `GetVolumeInformationW`)
   - API side: search the import table for `MessageBox` / `Reg*` / `GetVolumeInformation` / `GetSystemTimeAsFileTime` and decompile the referencing function; for a Linux target, ltrace observes `strcmp` / file-read calls ([[re-tracing]])
   - Write down each candidate function's address and file name (there may be several check functions; see pitfall 3)

2. **Call graph and check branches (success / failure jumps)**:
   - Decompile the check function and confirm the structure: read the input (serial string / registry value) → compute / compare → **jump by the result** (`jz` / `jnz` to success or failure handling). Failure-path features: a MessageBox error, the registration flag set false, a call to `ExitProcess`
   - Find the registration flag: a global (0/1) is set to 1 on the success path, and feature code checks it; xrefing that flag finds **every** feature check point that consumes it (not only the startup check; see pitfall 3)
   - Dynamic confirmation (inside a sandbox, top principle in [[re-analyze/platform-tips]]): break at the check function's return in the debugger and look at the return value and jump direction — [[re-gdb]]: after `break <addr>`, `si` follows the jump; [[re-x64dbg]]: after `bp <addr>`, look at the flags
   - Product: for each check point, the address / caller / success-failure branch addresses / registration flag

3. **Algorithm recovery (compare / decrypt / signature verify)**:
   - **Compare type**: `strcmp` / byte-by-byte compare → the serial is compared with a fixed value or a dynamically derived value. Recover the derivation (it may be the XOR / table lookup / simple transform from [[re-crypto-id]])
   - **Decrypt type**: the serial is decrypted first (XOR / base64 / hand-rolled) and then compared → recover the decrypt as generation steps (a symmetric XOR inverts directly; a table lookup produces an inverse map)
   - **Signature-verify type**: `RSA_verify` / `ECC` verify → the algorithm is irreversible and forward generation is impossible → report it to the gateway and go to [[re-patching]] (see pitfall 4)
   - Recover the encrypt/decrypt stage with the [[re-crypto-id]] / [[re-crypto-decrypt]] idea; turn the decompiled pseudocode into a standalone script and verify it once (for a known-valid serial, program behavior and the script result agree)

4. **Distinguish online activation from an offline check**:
   - Features: the import table contains network APIs (WinINet `InternetOpen*` / `WinHttp*` / `socket`), the activation flow is "enter a serial → go online → return an activation code", and strings contain a server URL / "activation failed"
   - Online activation: the local side only checks the response format (a fake check), and the real verification is on the server → go to [[re-protocol]] ([[re-netcap]] captures inside the sandbox + [[re-crypto-id]] [[re-crypto-keys]] [[re-crypto-decrypt]] handle encryption); the local side only handles response checking and offline-fallback logic
   - Offline check: the algorithm is entirely local, and step 3 recovery proceeds normally
   - How to distinguish: run with the network cut (sandbox network cut) and see whether activation fails/times out ([[re-sandbox]] network isolation)

5. **Identify machine-code binding**:
   - Search imports/calls: `GetVolumeInformationW` (volume serial), `GetComputerNameW`, `GetUserProfileDirectoryW`, the Windows registry `MachineGuid`, a Linux `/etc/machine-id` read
   - Confirm the serial generation / check input contains a machine code: in the decompilation, see whether the check function reads the machine code first and then uses it in the computation
   - After binding is confirmed: **the keygen generation logic must include the input** (username / machine code parameterized; see [[re-keygen]] pitfall 2); the report notes "this license is bound to a machine code"

6. **Identify the license model (this decides the disposition route)**:
   - **Node lock** (machine binding): serial = f(machine code) → if reversible, the [[re-keygen]] route
   - **Validity / subscription**: the check is an expiry time → the time-based check branch (step 7); xref expiry-prompt strings ("expired"/"trial") to locate it
   - **Feature-switch type** (freemium): check points are scattered at each feature entry, and there are several registration flags → the full list must be complete (pitfall 3)
   - **Floating license** (a license server): there is no complete local check → go to [[re-protocol]] and analyze the license protocol
   - The basis of the model judgment: the contents of the license file / registry key (an expiry-date field = subscription; a machine-code hash = node lock)

7. **Time-based check (validity period)**:
   - Time-read APIs: Windows `GetSystemTimeAsFileTime` / `GetLocalTime`, Linux `time()` / `gettimeofday` — xref to the compare logic (`> expiry time`)
   - Anti-tamper: the program may record "last run time" and detect a clock rollback (current time < last recorded → error) — locate that check point before changing the system time
   - Product: where the expiry time is stored (registry / file), the compare-function address — the patch or bypass target

8. **Evidence check (close-out)**:
   - File the full check-point list (address / branch / flag / evidence grade) in [[re-analyze/analysis-contract]]; mark conclusions by evidence grade (dynamic confirmation vs static inference; see [[decision-tree]])
   - Delivery: the check-point list + the algorithm document → the [[re-cracking]] gateway verifies them together

## Cross-domain

- [[re-cracking]]: this gateway is re-cracking workflow step 2 (license location). The product (check-point list + algorithm) feeds steps 4 / 5
- [[re-patching]]: downstream — after you have the check-point address, change the branch / skip the check
- [[re-keygen]]: downstream — after you have the check algorithm, invert the generation logic
- [[re-anti-analysis]]: a packed sample is unpacked first (analyze after OEP); an obfuscated check function goes to [[re-deobfuscate]] first
- [[re-protocol]]: online activation → capture and analyze the activation protocol (netcap → crypto-id → crypto-keys → crypto-decrypt → proto-rev)
- [[re-binary-core]]: the decompiler workbench ([[re-ghidra]] / [[re-ida]] / [[re-radare2]])
- Dynamic: [[re-gdb]] / [[re-x64dbg]] / [[re-lldb]] (breakpoints watch the branch return value), [[re-tracing]] (strace / ltrace watch registry / file / API calls), [[re-memdump]] (the in-memory registration flag / check result)
- [[re-behavior]]: Windows-side ProcMon registry / file behavior trace handoff
- [[re-sandbox]]: the sandbox for dynamic location and verification (top principle in [[re-analyze/platform-tips]])
- [[re-ioc]]: registration-related strings / check fingerprints can be YARA features

## Common pitfalls

- **The check function is obfuscated / encrypted**: symptom — the located check function decompiles to all junk instructions / flattening / ciphertext strings, and the compare logic cannot be seen; cause — license checking is a heavily protected object and often stacks obfuscation; fix — [[re-deobfuscate]] first (clear junk instructions → restore flattening → decrypt strings) and then analyze. Do not chew ciphertext
- **Treating online activation as an offline crack**: symptom — every local decision branch is changed and the program still refuses to run / features stay locked; cause — the real verification is on the server (the local side only checks the response); fix — step 4 distinguishes online / offline first (a disconnect test). Online goes to [[re-protocol]] to capture and analyze the activation protocol. The local side only handles response checking
- **The check may happen more than once (startup + feature points)**: symptom — the startup check is bypassed successfully, and using a core feature pops registration again; cause — there is more than one check point (startup, feature points, a timer, a version-upgrade check); fix — step 2 walks every xref of the check function / every consumer of the registration flag and builds the full check-point list (this is the root of [[re-cracking]] gateway pitfall 2)
- **Forcing recovery of an irreversible algorithm**: symptom — the check contains SHA / MD5 / RSA verify, and the serial-generation logic cannot be pushed forward; cause — a one-way function; fix — honestly report that it is irreversible and go to [[re-patching]] (skip the verify / change the branch). Do not fake "recovery succeeded"
- **A fake check misleads**: symptom — the decision branch was changed and the program still exits / there is no effect; cause — the changed point is not the real license decision (a fake branch / honeypot check; the real decision is elsewhere); fix — a dynamic breakpoint confirms each branch's real effect on the registration flag and program behavior before the patch stage
- **A time-based check was missed**: symptom — every serial check is changed and it still says expired; cause — there is a separate expiry-time check (subscription / trial) independent of the serial check; fix — step 7 looks up time-API xrefs and where the expiry is stored, and puts them on the full list
- More decision branches and boundaries (license-model decision tree / evidence grading / time-tamper counterexamples): [[decision-tree]] and [[gotchas]]

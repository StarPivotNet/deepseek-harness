---
name: re-imports
description: >
  Import/export tables and library fingerprints: IAT/EAT, DLL/so fingerprints, the FLIRT idea.
  Triggers: `导入表`, IAT, `库指纹`, `链接了哪些库`
capabilities: [pe-parser, elf-parser]
---

# Import/export tables and library fingerprints

## When to use / when not to use

- Use: decide which libraries/APIs a program links; match compiler and library version from import features; locate suspicious imports (injection / network / crypto APIs); analyze export interfaces of plugins and DLLs
- Do not use: you only need logic inside a function (go straight to a decompiler skill)
- Do not use: a packer hides imports statically (dynamically resolved APIs are not in the IAT — pair with [[re-tracing]] / [[re-memdump]] and take them from memory)

## Tool setup

See [[re-analyze/platform-tips]] — import-table analysis is a static step and needs no sandbox; anything that runs (verifying a dynamically resolved API) goes into a sandbox under the top principle.

### objdump / readelf (binutils)

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils` (`gobjdump`); for Mach-O use `otool -L` + `nm -u`
- WSL: the Linux build
- Verify: `objdump -V`

### pefile (Python)

- All platforms: `pip install pefile`
- Verify: `python3 -c "import pefile; print(pefile.__version__)"`

### rizin / rz-bin

- Install matrix is in [[re-radare2]]. After install, verify with `rizin -v`
- Windows: official release, unzip and run; radare2 users can `choco install radare2` for compatibility (commands below)
- Verify: `rz-bin -V`

### Ghidra FLIRT plugin (ghidra_flirt)

- All platforms: `git clone https://github.com/nneonneo/ghidra_flirt && cd ghidra_flirt && make` (Ghidra must already be installed; see [[re-ghidra]])
- Verify: the ghidra_flirt extension appears inside Ghidra

## Procedure

1. **List imported functions**:
   - PE:
     ```sh
     objdump -p sample.exe | grep 'DLL Name' -A3 | head -30
     ```
     ```python
     import pefile
     pe = pefile.PE('sample.exe')
     for e in pe.DIRECTORY_ENTRY_IMPORT:
         print(e.dll, [i.name for i in e.imports if i.name][:15])
     ```
   - ELF:
     ```sh
     objdump -T sample | grep UND            # undefined symbols = imports
     readelf -s sample | grep -i ' UND '
     ```
   - Mach-O:
     ```sh
     otool -L sample      # dependent dylib list
     nm -u sample         # undefined symbols = imports
     ```

2. **Match library/compiler from import features (the FLIRT idea)**:
   - FLIRT signatures: IDA `File > Load file > FLIRT signature file...` (bundled sig directory) annotates library functions automatically; Ghidra uses the ghidra_flirt plugin (tool setup)
   - libc version fingerprint: `readelf -s sample | grep -c ''` together with `strings sample | grep -E 'GLIBC_[0-9.]+'` (GLIBC symbol versions); on the runtime-library side, `strings libc.so.6 | grep -m1 version`
   - Language fingerprints: Go (`runtime.main` / a `go1.2x` string), Rust (`_ZN` / `__rust_*`), C++ (`_Z` mangled), Delphi (`@System@`), .NET (mscoree + metadata)
   - Rich Header (PE) cross-checks the compiler version; see [[re-format-pe]]

3. **Locate suspicious imports**:
   - Process-injection class: `OpenProcess` + `VirtualAllocEx` + `WriteProcessMemory` + `CreateRemoteThread` (kernel32); `NtCreateThreadEx` (ntdll)
   - Network-callback class: `WSAStartup` / `socket` / `connect` / `HttpSendRequestA` / `WinHttpOpen`
   - Crypto / theft class: `CryptEncrypt` / `CryptDecrypt` / `BCryptEncrypt` / `CryptExportKey` (export a key)
   - Anti-debug class: `IsDebuggerPresent` / `NtQueryInformationProcess` / `OutputDebugStringA` (exception-triggered detection)
   - ELF side: `ptrace` / `socket` / `execve` / `dlopen` / `fork`; Mach-O side: `task_for_pid` / `_dyld_*`
   - On a hit, annotate the analysis notes. Next, go to a decompiler skill and locate the call site

4. **Export-table analysis (plugin / service samples)**:
   - PE:
     ```sh
     objdump -p sample.dll | grep -A30 'Export Table'
     ```
     ```python
     import pefile
     pe = pefile.PE('sample.dll')
     for exp in pe.DIRECTORY_ENTRY_EXPORT.symbols:
         print(hex(exp.address), exp.name)
     ```
   - ELF `.so`: `readelf -s sample.so | grep -v UND | grep FUNC` (exported global functions)
   - Mach-O dylib: `nm -gU sample.dylib`
   - Export names on a plugin sample reveal function (for example internal commands of an AV / injector / toolset)

5. **Check against system libraries** (decide whether a system API is mixed with suspicious arguments):
   ```sh
   strings sample.exe | grep -iE '\.dll|\.so|\.dylib'   # extra library-path clues
   ```

## Cross-domain

- [[re-binary-core]]: fixed call at workflow step 4
- [[re-malware]]: filter malicious import features (injection / theft / callback)
- [[re-cracking]]: find check / registration API call sites
- Hands off to [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]]; when a packer hides imports, go to [[re-anti-analysis]] + [[re-memdump]]

## Common pitfalls

- **The import table was redirected or encrypted by a packer**: the IAT read statically is the packer's placeholder / already encrypted — the real imports are taken from memory after it runs ([[re-memdump]])
- **Dynamically resolved APIs are not in the IAT**: `GetProcAddress` / `dlopen`+`dlsym` resolve only at runtime, so the static import table will not show them — observe with [[re-tracing]]
- **A string comparison is a more reliable library version**: symbols can be stripped or obfuscated, but version strings for Go/OpenSSL (`go1.21`, `OpenSSL 3.0.x`) sit in the strings
- A function imported by ordinal has only a number and no name — compare with Microsoft's ordinal table or the runtime library's export table
- **The runtime GOT/IAT may already have been rewritten by a constructor**: symptom — the static import table is clean, but after running it calls an unexpected function; cause — a malicious constructor (`.init_array` / TLS callback) overwrites a GOT/IAT entry (for example `strcmp@GOT`) and installs a hook before the entry, which the static view cannot see; fix — compare the import conclusion with the runtime memory view ([[re-memdump]] / [[re-tracing]]). If the sample has init callbacks, list them before concluding
- **Cluster a family with imphash, not an import-name list**: symptom — variants of the same family differ a lot in import names, and name-based clustering fails; cause — an import-name list is sensitive to linker version / packing; fix — fingerprint with pefile's `imphash` (a hash of normalized import functions); note that a sample whose IAT was taken over by a packer has a distorted imphash, so unpack first and then compute it

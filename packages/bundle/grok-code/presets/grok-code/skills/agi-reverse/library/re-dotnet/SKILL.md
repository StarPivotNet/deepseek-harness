---
name: re-dotnet
description: ".NET CIL reversing: dnSpy/ILSpy decompilation, de4dot deobfuscation, ConfuserEx. Triggers: .NET, dnSpy, ILSpy, de4dot, CIL, ConfuserEx"
capabilities: [bytecode-parser]
---

# .NET CIL reversing (dnSpy / ILSpy / de4dot)

## When to use / when not to use

- Use: after confirming a .NET assembly (PE CLI header / `file` output "Mono/.Net assembly"), recover CIL to readable C#; handle .NET obfuscation such as ConfuserEx/SmartAssembly; locate license-code / network / decrypt logic
- Use: static recovery of a malicious .NET sample (the [[re-malware]] → [[re-managed]] path)
- Do not use: an unmanaged PE (a native program goes straight to [[re-binary-core]]; the native part of a mixed-mode program is handed off the same way)
- Do not use: Java ([[re-java]]), scripts ([[re-script-deob]])
- Note: dynamic steps default to a sandbox ([[re-analyze/platform-tips]] highest principle); confirm with `file`/triage before touching it

## Tool setup

See [[re-analyze/platform-tips]] — decompilation/deobfuscation are static steps and skip the sandbox; dynamic verification follows the highest principle and enters a sandbox.

### dotnet SDK (prerequisite for running .NET tools)

- Debian/Ubuntu: `apt install dotnet-sdk-8.0` (official Microsoft repo)
- Fedora: `dnf install dotnet-sdk-8.0`; Arch: `pacman -S dotnet-sdk`
- macOS: `brew install --cask dotnet-sdk`
- Windows: `choco install dotnet-sdk` or the official installer
- Verify: `dotnet --version`

### ILSpy (cross-platform, GUI + CLI)

- CLI (dotnet tool): `dotnet tool install -g ilspycmd`
- GUI: GitHub `icsharpcode/ILSpy` release zip (linux-x64 / win-x64 / osx-x64 all exist)
- Verify: `ilspycmd --help`; the GUI can open an assembly

### dnSpy (Windows-only, GitHub release)

- GitHub `dnSpyEx/dnSpy` release zip → unzip and run `dnSpy.exe`
- Windows only (WinForms + .NET Framework); on Linux/WSL use ILSpy (or run dnSpy under Wine)
- Verify: the GUI starts and can `File > Open` an assembly
- Advantage: decompile + edit + debug in one

### de4dot (GitHub release, deobfuscation)

- GitHub `de4dot/de4dot` release `de4dot.exe`; Linux/macOS need mono:
  - `apt install mono-devel` / `dnf install mono-devel`; Arch: `sudo pacman -S mono`; macOS `brew install mono`
  - switch to AUR `mono-git` only when you explicitly need an upstream Git snapshot (AUR, not an official repo)
  - run: `mono de4dot.exe --help`; on Windows, `de4dot.exe --help` directly
- Verify: `--help` prints normally

### Single-file bundle unpack (sfextract / built into ILSpy, optional but common)

- Zero extra tools: ILSpy 7.1+ GUI opens a single-file bundle directly with `File > Open`; 7.2+ right-click `Extract package entry` exports embedded assemblies
- CLI: `dotnet tool install -g sfextract` (Droppers/SingleFileExtractor, MIT; note that the package names `dotnet-bundle-extractor`/`dotnet-bundle-extract` do not exist on NuGet)
- Usage: `sfextract sample.exe -o extracted/` (without `-o` it only lists files inside the bundle)
- Verify: `sfextract --help`

## Procedure

Run in order. Record evidence for each step (path + sha256; see [[re-triage]]).

1. **Identify a .NET assembly**:
    ```sh
    file sample.exe            # 含 "Mono/.Net assembly" 即 .NET
    strings sample.exe | grep -i mscoree   # mscoree.dll 导入是经典标识
    ```
   Confirm the CLI header (PE data directory item 15 = COM Descriptor):
    ```python
    import pefile
    pe = pefile.PE('sample.exe')
    dd = pe.OPTIONAL_HEADER.DATA_DIRECTORY[14]  # COM Descriptor (CLI header)
    print(hex(dd.VirtualAddress), hex(dd.Size))  # 非 0 → 托管程序集
    ```
   Watch for mixed-mode assemblies (both native and managed are visible) and self-contained single-file (see pitfall 4).
   CLI header quick reference (measured on a .NET 10 product): cb=0x48(72), MajorRuntimeVersion=2, MinorRuntimeVersion=5, MetaData RVA, EntryPointToken (4-byte union, ECMA-335 II.25.3.3: when COMIMAGE_FLAGS_NATIVE_ENTRYPOINT is not set it is a metadata token (MethodDef/File); only when set is it a native-code RVA; 0 = no entry, i.e. a DLL), CorFlags (1=ILONLY, 2=32BITREQUIRED, 0x8=strong-name signed (COMIMAGE_FLAGS_STRONGNAMESIGNED), 0x20000=32BITPREFERRED).
   Metadata root (at the MetaData RVA): signature `BSJB`(0x424A5342) + version 1.1 + reserved + version-string length + version string ("v4.0.30319" is a typical default of Roslyn/MetadataRootBuilder, **not a format invariant** — ECMA-335 allows a vendor-defined string; trust the actual bytes) + flags(2) + stream count(2) + stream headers (offset + size + name, 4-byte aligned).
   The stream name is the content shape: `#~` (compressed tables, Roslyn default) / `#-` (uncompressed tables), `#Strings` (metadata string pool), `#US` (user strings: C# literals in code), `#GUID`, `#Blob` (signature/constant blobs) — if a string-encrypted sample's plaintext is not in `#US`, it was built at runtime; the table contents of `#~` are the type/method tree in dnSpy/ILSpy.

2. **Browse the dnSpy/ILSpy decompilation**:
   - ilspycmd single file: `ilspycmd sample.exe` (decompiled code on stdout)
   - ilspycmd project: `ilspycmd sample.exe -p -o decompiled/`
   - ILSpy GUI / dnSpy: `File > Open` → expand the assembly in the left tree → double-click a class/method for the C# view
   - Extra dnSpy capability: right-click a method `Edit Method` (after the edit, `File > Save Module` recompiles), breakpoint debugging

3. **Locate key logic by strings/APIs**:
    ```sh
    strings sample.exe | grep -iE 'http|https|api|key|secret|register'
    strings -e l sample.exe | grep -iE 'http|key|secret'   # UTF-16LE：#US 池里 C# 字面量是 UTF-16
    grep -rn 'HttpClient\|WebRequest\|Regex\|Convert' decompiled/   # ilspycmd 产物
    ```
   - Search inside the GUI: ILSpy/dnSpy `Edit > Find` (Ctrl+Shift+F), enter the target string
   - Find references: dnSpy right-click a method/field → `Analyze` → `Used By` (xref to call sites)
   - Target shapes: license-code check (`if (key == ...)` in `Main`), network URL, decrypt key

4. **de4dot deobfuscation (ConfuserEx / SmartAssembly and similar)**:
    ```sh
    mono de4dot.exe sample.exe            # 自动检测混淆器 → 输出 sample-cleaned.exe
    mono de4dot.exe -p ce sample.exe      # 显式指定 ConfuserEx (ce) / SmartAssembly (sa)
    ```
   - Dry-run detection first with `-d`: `mono de4dot.exe -d sample.exe` (the log shows `Detected: ConfuserEx`)
   - After deobfuscation, reopen `sample-cleaned.exe` in dnSpy/ILSpy: strings should be plaintext and control flow restored
   - Residual obfuscation (strings still ciphertext) → the manual plan in pitfall 2

5. **Dynamic side (optional; execute inside a sandbox [[re-sandbox]])**:
   - Frida (native layer): `pip install frida-tools`; `frida sample.exe -l hook.js`, and use `Interceptor` to hook underlying native calls (such as socket read/write / `SSL_read` behind `HttpClient`, or the native library that holds the decrypt function) and dump plaintext/URLs at runtime — stock frida-tools cannot hook a .NET managed method directly by method name; the managed layer needs a CLR bridge (such as MonarchSolutions/frida-clr) or the dotnet-dump / dnSpy debugging below
   - dotnet-dump (in-process runtime data):
      ```sh
      dotnet tool install -g dotnet-dump
      dotnet-dump collect -p <pid>                  # 收集 dump
      dotnet-dump analyze <dump>                    # clrstack / dumpheap -type System.String
      ```
   - Windows: dnSpy `Debug > Start` breakpoint debugging (break the method directly and inspect variables)

## Cross-domain joins

- [[re-managed]]: gateway workflow step 2 (decompile) and step 4 (deobfuscate) always call this skill
- [[re-malware]]: the .NET malicious-sample path (re-malware → re-managed → static recovery with this skill)
- [[re-binary-core]]: the base — triage ([[re-triage]]), and the native part of mixed mode
- Dynamic side: [[re-frida]], [[re-sandbox]]; deep obfuscation goes to [[re-deobfuscate]]; unpack a single-file first, then return to this skill

## Common pitfalls

- **ConfuserEx string encryption + control flow**: Symptom — decompilation only shows `smethod_0("密文")` calls, and if/while become switch dispatch; cause — ConfuserEx enables string encryption and control-flow obfuscation together by default; fix — `de4dot -p ce` recovers automatically; if residue remains, read plaintext dynamically at the decrypt-method return (inside a sandbox), or recover the decrypt loop and batch-decrypt with a script
- **de4dot fails on old versions / new obfuscators**: Symptom — the log says `Unknown obfuscator`, or the product is still obfuscated; cause — de4dot maintenance has stalled, and new obfuscator signatures were not collected; fix — switch to a community fork (de4dot-cex / de4dot-modified), or do it manually: locate the string-decrypt function → analyze the algorithm → reproduce it in python3 + verify dynamically
- **dnSpy is Windows-only**: Symptom — double-clicking dnSpy.exe on Linux/WSL errors and will not run; cause — a WinForms + .NET Framework GUI tool; fix — on Linux/macOS use ILSpy (GUI or `ilspycmd`); if you insist on dnSpy, run it under Wine
- **.NET self-contained publish (single-file)**: Symptom — `file` shows an ordinary PE, and opening it in a tool shows no managed structure / empty decompilation; cause — self-contained single-file bundles host + runtime + IL into one native executable; fix — unpack first: `sfextract sample.exe -o extracted/` (or open/export directly in ILSpy), then decompile the extracted assemblies
- **Mixed-mode assembly**: Symptom — decompilation shows only a few managed classes, and the main logic cannot be found; cause — C++/CLI or a wrapper mixes native code with managed code; fix — managed side follows this skill; native side goes to [[re-binary-core]] ([[re-ghidra]] / [[re-imports]])
- **A thin-shell launcher assembly is misread as a failed export (dnSpy headless batch)**: Symptom — one assembly's decompilation product has very little source (a few lines to a few dozen), the main logic cannot be found, and it is mistaken for an export failure; cause — that assembly is only a thin-shell launcher; the main logic is in a companion assembly/library (pure managed, distinct from the native side in the previous item); fix — batch-decompile at directory level and judge from the whole view: on Windows, dnSpy console (`dotnet dnSpy.Console.dll`) outputs a solution + one .csproj per assembly + a source tree; the Linux counterpart is `ilspycmd -p`; when batching, explicitly pass the dependency search path (pointing at the target's directory), or companion-library references will not resolve fully; confirm success on two channels: "product count nonzero + exit code 0"
- **ReadyToRun (R2R) assembly**: Symptom — `file` reports `Unknown processor 0xfd1d` (PE machine 0xfd1d is the R2R mark); decompilation looks normal, but when dynamic behavior disagrees with the IL, suspect a precompiled body; cause — an R2R publish precompiles native method bodies outside the metadata (fast startup); the IL and CLI header are still present (measured: a .NET 10 R2R product has DD[14] and metadata complete), and what actually executes is the native body; fix — detect: `file`'s 0xfd1d plus `RTR\0` inside the binary (READYTORUN header magic, measured in the .text region); analysis: IL-side logic is consistent, so decompile as usual; performance/environment differences are in the native method bodies (hand off to [[re-binary-core]])
- **NativeAOT has no managed structure**: Symptom — `file` does not show Mono/.Net assembly, there is no CLI header, but the source claim is a .NET program; cause — NativeAOT compiles C# straight to a native executable (no CLR, no metadata, no CIL); fix — analyze it as native ([[re-format-pe]]/[[re-format-elf]] + [[re-ghidra]]/[[re-imports]]); signatures: a statically/dynamically linked native binary + no mscoree import; business strings can still be extracted with `strings -e l` (.NET strings are UTF-16)
- **.NET strings are UTF-16LE; default strings misses them**: Symptom — `strings sample.exe | grep 'http'` finds nothing, but the decompilation has a plaintext URL; cause — C# literals are stored as UTF-16LE in the `#US` pool; fix — search again with `strings -e l` (or `-el`); on the dynamic side, a [[re-frida]] hook on the string-construction site can also take plaintext
- (Source: LazyReverse (a0yami), MIT)

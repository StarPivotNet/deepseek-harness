---
name: re-format-pe
description: >
  PE format parsing: DOS/NT headers, section table, imports and exports, TLS callbacks, Rich Header, certificate table.
  Triggers: `PE格式`, `解析exe`, `section表`, Delphi, VB6, vmt, MSVBVM60, RTTI, `老程序`
capabilities: [pe-parser]
---

# PE format parsing

## When to use / when not to use

- Use: the target is a Windows PE file (.exe/.dll/.sys), and you need to understand the structure, find packer signatures, locate the entry/TLS callbacks, and map RVA to file offset
- Do not use: ELF (go to [[re-format-elf]]), Mach-O (go to [[re-format-macho]]); you only need function logic (go straight to a decompiler skill)
- Do not use: you only need a quick conclusion (triage goes to [[re-triage]])

## Tool setup

See the platform branch in [[re-analyze/platform-tips]] — a Windows target can be analyzed statically without a sandbox; dynamic execution always uses a sandbox.

### objdump (binutils)

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils` (`gobjdump`)
- Windows/WSL: the Linux build inside WSL
- Verify: `objdump -V`
- Note: for PE use `objdump -p` / `objdump -x` (readelf does not parse PE; it is an indirect tool — used only to compare ELF-side knowledge)

### pefile (Python, recommended main tool)

- All platforms: `pip install pefile` (Linux/macOS/Windows/WSL all work)
- Verify: `python3 -c "import pefile; print(pefile.__version__)"`

### CFF Explorer (Windows GUI)

- Windows: `choco install cff-explorer` (or download Explorer Suite from the NTCore site)
- Verify: start CFF Explorer, open the sample, and the Dos Header/Sections panels display normally

## Procedure

1. **Locate the PE header with e_lfanew**:
    ```sh
    objdump -p sample.exe | head -40   # 看 Magic: 0x10b (PE32) / 0x20b (PE32+) 与入口点
    ```
    ```python
    import pefile
    pe = pefile.PE('sample.exe')
    print("e_lfanew offset:", hex(pe.DOS_HEADER.e_lfanew))
    print("PE32" if pe.OPTIONAL_HEADER.Magic == 0x10b else "PE32+")
    print("EntryPoint RVA:", hex(pe.OPTIONAL_HEADER.AddressOfEntryPoint))
    ```

2. **Section table and RVA/file-offset mapping**:
    ```sh
    objdump -h sample.exe        # 节名/VMA/文件偏移/大小
    ```
    ```python
    import pefile
    pe = pefile.PE('sample.exe')
    for s in pe.sections:
        print(s.Name, "VA:", hex(s.VirtualAddress), "raw:", hex(s.PointerToRawData),
              hex(s.SizeOfRawData), "chars:", hex(s.Characteristics))
    print("RVA->offset:", hex(pe.get_offset_from_rva(0x1000)))   # RVA 转文件偏移
    ```
   Remember: a section's VirtualAddress in memory is an RVA; add ImageBase to get a VA; the file offset is given by PointerToRawData.

3. **Import table (an abnormal IAT size = a packer signature)**:
    ```sh
    objdump -p sample.exe | grep -A3 -i 'DLL Name'
    ```
    ```python
    import pefile
    pe = pefile.PE('sample.exe')
    for entry in pe.DIRECTORY_ENTRY_IMPORT:
        names = [i.name for i in entry.imports if i.name]
        print(entry.dll, "imports:", len(names), names[:5])
    ```
   - A normal program imports many functions; only 1-2 DLLs and very few functions (for example only a few from kernel32) → a strong hint of packing / dynamic resolution

4. **TLS callback check (runs earlier than the entry point)**:
    ```python
    import pefile
    pe = pefile.PE('sample.exe')
    if hasattr(pe, 'DIRECTORY_ENTRY_TLS') and pe.DIRECTORY_ENTRY_TLS:
        # AddressOfCallBacks 按 VA 存放：VA - ImageBase = RVA（只减一次）
        cb_rva = pe.DIRECTORY_ENTRY_TLS.struct.AddressOfCallBacks - pe.OPTIONAL_HEADER.ImageBase
        ptr_size = 8 if pe.OPTIONAL_HEADER.Magic == 0x20b else 4  # PE32+(0x20b)/PE32(0x10b) 才是位宽判据；Machine==0x8664 只说明 x64，ARM64(0xAA64) 同样是 PE32+
        while True:                                                # 回调数组以 0 结尾
            ptr = int.from_bytes(pe.get_data(cb_rva, ptr_size), 'little')
            if ptr == 0:
                break
            print('TLS callback VA:', hex(ptr))
            cb_rva += ptr_size
    ```
   Simple method: look in `objdump -p sample.exe` output for whether the TLS directory table exists; if it does, print the callback address list with pefile and disassemble each one. Callbacks run before the entry point (AddressOfEntryPoint) — malicious samples often put decrypt/anti-debug code here.

5. **Rich Header identifies the compiler**:
    ```python
    import pefile
    pe = pefile.PE('sample.exe')
    rh = pe.parse_rich_header()
    if rh:
        vals = rh['values']          # 扁平整数数组 [compid, count, compid, count, ...]（pefile 已按 key 解密）
        for cid, count in zip(vals[0::2], vals[1::2]):
            # compid 高 16 位是工具 Product ID、低 16 位是 build（如 0x10b=VS2015 系）
            print(f"compid={cid:#x} tool={cid>>16:#x} build={cid & 0xffff} count={count}")
    ```
   The Rich Header sits after the DOS stub and before e_lfanew, and identifies the compiler toolchain version; being removed/forged is itself a packing or hand-edit signature.

6. **Certificate table**: the VirtualAddress of SECURITY_DIRECTORY (directory entry 4) is a **file offset**, not an RVA — parsing it as an RVA reads the wrong place:
    ```python
    import pefile
    pe = pefile.PE('sample.exe')
    sec = pe.OPTIONAL_HEADER.DATA_DIRECTORY[4]
    print("cert table file offset:", hex(sec.VirtualAddress), "size:", hex(sec.Size))
    ```

## Legacy runtime identification (Delphi / VB6)

Two leftover runtimes in old PE samples — Delphi (VCL) and VB6 — have sharp structural signatures. You do not have to wait for decompilation; the format-parse stage (section table/resources/imports) can already decide.

### Delphi (VCL) signatures and location

- **Class-system strings**: VCL class names are stored in plaintext as short strings (1-byte length prefix); a systematic appearance of `TPersistent`/`TApplication`/`TComponent` class names is a strong signal; scan strings to locate class names first, then find referrers backward
- **vmt (virtual method table) location**: a class vmt is a pointer array in the code section; vmtSelfPtr at the start points at itself; metadata hangs in the negative-offset region of the vmt. **Classic layout (Delphi 7 and earlier) Win32**: TypeInfo (RTTI pointer) vmt-0x3C, published method table vmt-0x34, class-name string pointer vmt-0x2C, instance size vmt-0x28 (corroboration: vmtSelfPtr -0x4C, vmtParent -0x24); **Win64 uses the official values**, do not double them yourself: vmtTypeInfo -0xA8, vmtMethodTable -0x98, vmtClassName -0x88, vmtInstanceSize -0x80. From Delphi 2009, TObject added virtual methods and the negative offsets shifted forward as a whole; the modern layout is no longer interchangeable with the classic values (XE2 only introduced Win64 and did not change the negative offsets). Do not memorize offsets dead; cross-check both ways with "vmtSelfPtr points at itself + class-name pointer → class-name contents"
- **RTTI recovers class structure**: starting from the TypeInfo pointer at a negative vmt offset, an RTTI record contains the type name and the published property/method name table, and can systematically recover the class system and object layout as the skeleton for later decompilation
- **Borland resource-segment signatures**: inside .rsrc, RT_RCDATA has named resources `PACKAGEINFO` (package/unit list) and `DVCLAL` (version-check mark); cross-confirm with "no Rich Header" (the Borland toolchain does not generate one)
   ```python
   import pefile
   pe = pefile.PE('sample.exe')
   if hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
       for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries:
           name = entry.name.string if entry.name else None
           print(name, hex(entry.struct.Type))
   ```

### VB6 signatures and entry location

- **Runtime import**: the import table contains `MSVBVM60.DLL` (the VB6 runtime; VB5 is MSVBVM50.DLL); named imports are mostly `__vba*`/`rtc*` prefixes (`__vbaStrCmp`/`__vbaStrCopy`/`rtcMsgBox` and similar) — after the runtime is locked, the whole MSVBVM60 API call surface is the analysis anchor
- **Specific resources**: inside .rsrc, RT_RCDATA named resource `CUSTOM` (project name/startup info); the version-info segment often carries a VB runtime mark
- **Entry-location approach**: the entry first enters `MSVBVM60!ThunRTMain` for runtime init, and the project main logic is in the call chain after that; anchor on reference sites of `__vba*` string-handling APIs and walk back to business code; that is cheaper than following the entry dead

### Legacy-packer notes

- PECompact-class light-packer signatures: the section table was merged (often only 1-2 sections left), the IAT is minimized (APIs resolved dynamically at runtime), and the EP is a decode loop / jump stub
- A packer rewrites the section table and the RVA→file-offset mapping; parsing vmt/RTTI directly at the original offsets is distorted — confirm the packer type with [[re-packer-id]] first, and for a light packer follow the simple unpack flow ([[re-unpack-simple]]) before locating the runtime

### Identify-first principle

- Draw the runtime conclusion at the format-parse stage (section table/resources/imports), to choose the later path:
  - Delphi → the RTTI class-structure recovery route (vmt/TypeInfo location)
  - VB6 → the MSVBVM60 API call-surface route (`__vba*`/`rtc*` semantic recovery)
  - Neither → treat it as an ordinary C/C++ PE
- If identification fails, go back and check for a packer (old samples have a high light-packer rate); do not force a parse under a no-packer assumption

### Common pitfalls

- **Reading a Delphi string as C style**: Symptom — the string region looks like "garbage", and decompiled strings are truncated and misaligned; cause — a Delphi string is an AnsiString: the 4 bytes before the data pointer are the length, and the 4 bytes before that are the reference count (a ShortString has a 1-byte length prefix); neither is a NUL-terminated C string; fix — take the string by the length prefix (length first, no terminator); string scan uses a "length+contents" pattern rather than NUL truncation
- **A VB6 OLE automation call site is treated as an ordinary API**: Symptom — decompilation shows a long vtable/IDispatch dispatch sequence wrapped in `__vba*`, and object arguments are misread as ordinary register arguments; cause — a VB6 component call is dispatched through OLE automation (IDispatch); the call site is resolved by DISPID at runtime, and statically you only see "take the interface pointer → call the dispatch function"; fix — recover the call surface as "object + property/method name + DISPID" semantics; do not analyze the dispatch sequence as independent functions one by one
- **A legacy packer distorts RTTI offsets**: Symptom — taking the class name/RTTI pointer at a negative vmt offset yields garbage or a pointer outside the section; cause — a PECompact-class compression packer merged sections and rewrote the mapping, so the original offsets are invalid in the compressed state; fix — check the packer with [[re-packer-id]] first, and redo vmt/RTTI location after a light unpack
- **VB6 compile mode not distinguished (p-code vs native)**: Symptom — p-code mode also has a "code section", and reading it as ordinary disassembly yields variable-length garbage instructions; cause — VB6 has two products: native compiles straight to x86 (mixed with `__vba*` calls), and p-code encodes the logic as a bytecode stream interpreted by the runtime, so the code section is actually interpreter + bytecode data; fix — judge the compile mode first (disassembly readability of the code section, density of `__vba*` calls); p-code follows bytecode interpretation, native follows ordinary decompilation; do not force one flow on both

## Cross-domain joins

- [[re-binary-core]]: workflow step 3, format parsing of a PE target
- [[re-malware]]: PE malicious-sample analysis (TLS callbacks/the certificate table are common hiding places)
- [[re-cracking]]: locate check code for a PE patch/keygen-class task
- Joins [[re-imports]] (after the structure is parsed, look at imports); when a packer signature is found, hand off to [[re-anti-analysis]]

## Common pitfalls

- **A TLS callback is a common hiding place for malware**: an entry-point breakpoint misses it — check the TLS directory first and list every callback address
- **Abnormal section names** (UPX0/.aspack/.nsp0 and similar): compressed-section signatures of a packer; do not decompile them as ordinary code sections
- **A tiny import table → packed**: only a few kernel32 functions imported, or an empty import table, means the IAT was taken over by the packer, and static analysis cannot get the real imports
- **Certificate-table offset calculation**: the SECURITY_DIRECTORY pointer is a file offset; parsing it as an RVA reads the wrong place
- **The TLS directory itself can be overwritten/hijacked**: Symptom — the sample looks unpacked, but unexpected execution appears in an injected child process (svchost and similar), and a debugger broken at the OEP looks "normal" the whole time; cause — a malicious sample (such as an Ursnif variant) rewrites the injected process's TLS directory so execution lands in a forged callback rather than AddressOfEntryPoint, and a generic unpacker and a debugger that only breaks the entry point are both bypassed; fix — set a dynamic breakpoint at `ntdll!LdrpCallInitRoutine` (the callback pointer is passed as an argument) and observe every callback; statically verify whether the section holding the TLS directory/callback array is writable — writable means a hijack surface
- **Do not apply ELF thinking to PE**: Symptom — while analyzing a PE you look for `.interp`/PT_INTERP, expect a `__libc_start_main` startup path, and understand loading by RTLD_NOW semantics; cause — the two formats' dynamic-link mechanisms are fundamentally different (PE has no .interp, and startup does not go through __libc_start_main); fix — the PE startup chain is only: system loader → TLS callbacks → entry point (AddressOfEntryPoint); imports are the IAT; there is no GOT/PLT concept
- **Data embedded in a PE code section → linear disassembly misreads it**: Symptom — decompilation shows large stretches of pseudocode, or a jump table is treated as a function; cause — a PE compiler often inlines data such as jump tables into the code section (ELF puts them in `.rodata`); linear disassembly has about 1% error, and function-boundary misjudgment is 20%+ (tail calls/non-standard prologues/inlining); fix — cross-check decompilation results, and correct them with the tool's data annotation (mark data regions by hand in IDA/ghidra); do not fully trust the automatic function list

- **Do not remember data-directory offsets from memory**: the data-directory array of a PE32+ optional header starts at `oh + 112` (+96 is SizeOfHeapCommit) — measured PE32+ standard layout (24 standard + 80 Windows-specific (including an 8-byte ImageBase) + LoaderFlags/NumberOfRvaAndSizes 8 = 112); writing 96 reads garbage from HeapCommit
- **The 4 address fields of the TLS directory are VAs, not RVAs** (StartAddressOfRawData/EndAddressOfRawData/AddressOfIndex/AddressOfCallBacks) — unlike most data-directory entries, ImageBase must be subtracted before converting to an RVA
- **RVA→file-offset judgment uses raw_size, not vsize**: only raw_size bytes exist in the file; vsize may be larger (BSS class); judging with vsize reads past the end
- **Unreferenced import detection**: an IAT slot has a stub (`jmp [IAT]`) but a CFG/.text scan sees no reference; that is only an unused or indirect-reference candidate — keep checking data references (the `push offset [IAT]` class), indirect calls, and disassembly coverage (unrecognized/unanalyzed code regions). "No xref" does not imply that import was resolved dynamically: an API that is purely dynamically resolved usually never enters the import table. When a dynamic-resolution conclusion is truly required, there must be independent evidence: a `LoadLibrary*`/`GetModuleHandle*` + `GetProcAddress` call site, a `Ldr*` native API, a PEB/export-table walk, an API hash table
- **x64 TEB layout (verified against Wine winnt.h)**: `gs:[0x30]`=Self; `gs:[0x58]`=ThreadLocalStoragePointer (the TLS array pointer for `__declspec(thread)`, access sequence `mov rax,gs:[58]; mov ecx,[_tls_index]; mov rax,[rax+rcx*8]`); `TlsSlots[64]` is at **0x1480** (dynamic TLS); `TlsExpansionSlots` is at 0x1780 — 0x58 is not TlsSlots
- **Memory-format byte order is written by name**: the read-back byte order of `VK_FORMAT_B8G8R8A8_UNORM` / the same-named DXGI format is [B,G,R,A] (px[0] is B, not R) — verify byte order before a pixel/texture assertion; the same trap holds in reverse for R8G8B8A8

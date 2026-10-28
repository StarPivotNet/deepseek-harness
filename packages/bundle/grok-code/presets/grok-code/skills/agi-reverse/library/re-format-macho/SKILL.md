---
name: re-format-macho
description: >
  Mach-O format parsing: mach_header, LC_*, segments, dyld information.
  Triggers: Mach-O, `解析mac程序`, dyld
capabilities: [macho-parser]
---

# Mach-O format parsing

## When to use / when not to use

- Use: the target is a macOS/iOS Mach-O binary (executable/.dylib/.bundle/Framework), and you need to understand the structure, load commands, entry, code signature, and dynamic-library dependency chain
- Use: check dylib injection (an abnormal LC_LOAD_DYLIB entry), signature/notarization state, and slices of a universal binary
- Do not use: PE (go to [[re-format-pe]]), ELF (go to [[re-format-elf]])
- Do not use: you only need function logic (go straight to a decompiler skill); an iOS jailbreak-environment problem belongs to the [[re-mobile]] domain

## Tool setup

See the macOS branch of [[re-analyze/platform-tips]] — attach/debugging is limited by SIP and TCC; static parsing is unaffected.

### otool (ships with Apple)

- macOS: Xcode Command Line Tools: `xcode-select --install`
- Verify: `otool --version`
- Linux alternative: `llvm-otool` (`apt install llvm` / `brew install llvm` / `pacman -S llvm`); coverage includes otool's common subcommands

### llvm-objdump (cross-platform)

- macOS: `brew install llvm`; Linux: `apt install llvm` / `dnf install llvm` / `pacman -S llvm`
- Verify: `llvm-objdump --version`
- Use: `llvm-objdump --macho --private-headers sample` (can parse Mach-O directly on Linux; output matches macOS)

### jtool2 (deep Mach-O structure, macOS)

- macOS: clone from GitHub (intezer/jtool2) and `make`, or download a release binary
- Verify: `jtool2 -h sample` prints load commands

### codesign / lipo (ship with macOS)

- Verify: `codesign --version`; `lipo -info sample`
- Linux alternative: `llvm-lipo -info sample` (ships with llvm)

### dyld_shared_cache_util (macOS)

- Ships with the system (`/usr/bin/dyld_shared_cache_util`); use: when parsing a system dylib inside the dyld shared cache, extract that one library

## Procedure

1. **Triage (confirm type and architecture first)**:
    ```sh
    file sample                  # 可执行文件 / dylib / 通用二进制 / 字节序
    lipo -info sample            # 通用二进制列出各架构片；单架构提示 "non-fat file"
    xxd -l 16 sample             # 魔数: cffaedfe=64位小端, feedfacf=64位大端, cebafaed=32位小端, cafebabe=fat
    ```
   Magic (bytes seen in the file): `cffa edfe` (MH_MAGIC_64), `cefa edfe` (MH_MAGIC 32-bit), `cafe babe` (FAT, followed by a 4-byte architecture count). For a universal binary, first `lipo -thin <arch> -output piece sample` to extract one slice, then parse.

2. **mach_header and load commands (the core)**:
    ```sh
    otool -h sample                 # magic/cputype/filetype/ncmds/flag 一行全出
    otool -l sample | head -80      # 全部 load commands
    ```
   A 64-bit mach_header is a fixed 32 bytes (28 bytes on 32-bit): magic(4) + cputype(4) + cpusubtype(4) + filetype(4) + ncmds(4) + sizeofcmds(4) + flags(4) + reserved(4, 64-bit only). Load commands are Mach-O's combined "section table + import table + entry + signature" — walk them in `cmdsize` order from start to end; `ncmds` is the count, `sizeofcmds` is the total byte count, and the two cross-check each other. filetype: 2=MH_EXECUTE 6=MH_DYLIB 8=MH_BUNDLE. Common LC values and the field table are in [[layout]].

3. **Segments and sections (__TEXT/__DATA/__LINKEDIT)**:
    ```sh
    otool -l sample | grep -A8 'segname __TEXT'
    otool -l sample | grep -A8 'segname __DATA'
    llvm-objdump --macho --section-headers sample
    ```
   Record each segment's vmaddr/vmsize/fileoff; `__TEXT,__text` is code, `__DATA,__data` is writable data, and the GOT is in `__DATA_CONST,__got` (a read-only constant segment; old binaries put it in `__DATA,__got`); `__LINKEDIT` is a **normal segment with vmaddr/vmsize**, usually mapped read-only (visible in vmmap), holding link metadata such as the symbol table/string table/relocations/signature — the concrete storage is affected by dyld and the shared cache.

4. **Entry (LC_MAIN / LC_UNIXTHREAD)**:
    ```sh
    otool -l sample | grep -A6 LC_MAIN
    ```
   `entryoff` is the entry's offset relative to the file header; entry VA = the __TEXT segment vmaddr + entryoff (on 64-bit the __TEXT base is usually 0x100000000). Old binaries use LC_UNIXTHREAD (the register state contains the entry). An executable with neither LC_MAIN nor LC_UNIXTHREAD is malformed; investigate it as a priority.

5. **dyld information (LC_DYLD_INFO_ONLY / export trie)**:
    ```sh
    otool -l sample | grep -A9 LC_DYLD_INFO_ONLY
    llvm-objdump --macho --exports-trie sample   # 导出符号（trie 解码）
    ```
   Five offset+size pairs, 48 bytes total, all inside LC_DYLD_INFO_ONLY: rebase (base-fixup sites), bind (external-symbol binding, non-lazy), weak_bind (weak-symbol binding; weak-symbol coalescing semantics are independent and must not be merged into bind), lazy_bind (lazy binding), export (export trie); new binaries use LC_DYLD_CHAINED_FIXUPS (chained fixups, the default since iOS 13). A dylib's exported symbols are in the trie; `nm -gU` has the same effect.

6. **Dynamic-library dependency chain (injection detection)**:
    ```sh
    otool -L sample                 # LC_LOAD_DYLIB 列表（依赖库 + install name）
    otool -l sample | grep -A4 LC_LOAD_DYLIB
    ```
   Each LC_LOAD_DYLIB: name (an absolute path, or relative via @rpath/@executable_path) + timestamp/current_version. **Malicious dylib persistence = a newly added LC_LOAD_DYLIB entry** — a mismatch with the list at signing time is an important alert (see the pitfall). Under a two-level namespace, symbol lookup is the pair (library, symbol), and import resolution is strict.

7. **Symbol table (nlist_64)**:
    ```sh
    llvm-nm -m sample                # 含段归属与 N_EXT 标记；undefined = 导入
    llvm-nm -gU sample               # 仅外部定义符号（导出）
    otool -l sample | grep -A3 LC_SYMTAB   # symoff/nsyms/stroff/strsize 定位表
    ```
   Each nlist_64 is 16 bytes: n_strx (string-table offset) + n_type (N_EXT/N_SECT and similar) + n_sect + n_desc + n_value. After strip, `.symtab` disappears and only the LC_DYLD_INFO export trie and dynamic bind information remain — the recovery approach is the same as ELF ([[re-imports]] signature matching + string cross-references).

8. **Code-signature check**:
    ```sh
    codesign -dv sample 2>&1          # 签名类型（adhoc / Apple Development / not signed）
    codesign --verify --deep sample   # 完整性验证
    jtool2 --sig sample | head -20    # LC_CODE_SIGNATURE 细节（CodeDirectory/哈希）
    ```
   - `adhoc`: self-signed; it can be modified and re-signed (`codesign -f -s - sample`)
   - Apple signature: changing any byte invalidates it; when Library Validation is on, injecting a dylib fails
   - No LC_CODE_SIGNATURE = unsigned (cannot run directly on iOS)

9. **Manual parse and verification**: when load-command output is abnormal / header fields were forged, parse mach_header and each LC directly by offset with `xxd` + Python `struct` (a minimal runnable example and byte samples are in [[examples]]); do not discard a parse failure as a "corrupt file".

## Cross-domain joins

- [[re-binary-core]]: workflow step 3, Mach-O target format parsing
- [[re-mobile]]: precondition for iOS app/jailbreak-environment analysis (arm64 Mach-O main binary and dylibs)
- [[re-ios]] / [[re-macos]]: ecosystem join (app layer, signature notarization, TCC/SIP limits)
- [[re-cracking]]: macOS cracking-class tasks (the re-sign flow after a patch is step 8 of this skill)
- [[re-imports]]: hijack-surface analysis of dylib dependencies and exported symbols
- Dynamic debugging pairs with [[re-lldb]] (SIP/TCC limits are in [[re-analyze/platform-tips]])

## Common pitfalls

- **Signature verification blocks debugging/injection**: a modified binary fails codesign verification and will not run — first `codesign -f -s -` to re-sign (self-signed/adhoc scenes only); when Library Validation is on, `DYLD_INSERT_LIBRARIES` does not take effect
- **iOS needs a jailbreak environment**: a real device needs a developer certificate or a jailbreak to debug, and a simulator process is limited by the sandbox — static parsing can go first; hand the dynamic part to [[re-mobile]]
- **LC_LOAD_DYLIB injection detection**: a malicious dylib persists by adding an LC_LOAD_DYLIB — an `otool -L` list that disagrees with the list at signing time is an important alert
- **A universal binary contains several architecture slices**: first `lipo -info` to confirm the architecture, then `lipo -thin` to extract; do not parse the whole fat file; each slice's offset in the fat header is an absolute file offset; cut out one slice by (offset, size)
- **GOT location migrates with version**: a new product's GOT is in `__DATA_CONST,__got` (read-only, relocated once after load); an old product's is in `__DATA,__got` (writable) — when looking for the GOT, `otool -l` the segment name first; do not assume
- **There is no standalone dylib file inside the dyld shared cache**: system libraries (libSystem.dylib and similar) actually live in the `/System/Library/dyld/` cache, and the filesystem has only a stub — to analyze a system library, extract it with `dyld_shared_cache_util -extract`
- **Load-command walk is misaligned**: Symptom — `otool -l` output turns into garbage / errors partway through; cause — ncmds and sizeofcmds were forged, or some LC's cmdsize is abnormal; fix — every LC is at least 8 bytes (the `load_command` header itself is `cmd`+`cmdsize`); on 64-bit cmdsize must be a multiple of 8, on 32-bit a multiple of 4; then check that command's minimum structure size and trailing sections/strings against the specific cmd, and the running total must not exceed sizeofcmds
- **__LINKEDIT is a mapped segment, but its contents may have been processed by dyld**: it has its own vmaddr/vmsize and usually exists as a read-only mapping (`vmmap` can see it); however, a shared-cache library's link metadata resides in the shared cache, and looking up the symbol table from process memory by file offset often does not match — prefer locating the symbol table with `nm`/`dyldinfo`/MachOView by parsing LC_SYMTAB, rather than copying the file offset

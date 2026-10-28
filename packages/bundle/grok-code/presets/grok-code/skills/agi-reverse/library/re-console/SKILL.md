---
name: re-console
description: >
  Modern-console and retro-platform reversing: Switch NSO/NPDM containers and encrypted partitions, PS4/PS5 ORBIS structure, SDK library fingerprints; retro ROM headers / cartridge formats / saves and cheat codes.
  Triggers: `主机逆向`, Switch, NSO, NPDM, PS4, PS5, ORBIS, Xbox, `复古`, ROM, NES, GBA, `模拟器`, Cheat.
capabilities: [console-analysis]
---

# Modern-console and retro-platform reversing (Switch NSO/NPDM, PS4/PS5 ORBIS, retro ROM/saves)

## When to use / when not to use

- Use: Switch program-container parsing — NSO0 (code-segment structure), NPDM (program metadata / the permission surface), ExeFS/NCA partition-boundary identification; when you hold a legal keyset, decrypt NCA/NAX0 partitions and extract the code segment
- Use: a PS4/PS5 ORBIS main program (eboot.bin) — encrypted-boundary identification, ELF structure parsing of a legally decrypted sample (PT_SCE_* program headers), SDK version and import-library fingerprints
- Use: Xbox-family container (XBE/XEX2) parsing and entry location
- Use: retro-platform ROMs — ROM-header parsing, cartridge format, save files, and cheat-code analysis for NES (iNES/NES 2.0), GB/GBC, GBA, and PSX
- Use: SDK library fingerprints (Switch NX SDK, ORBIS SDK, Xbox XDK, devkit toolchains) to help version identification and function matching
- Do not use: a PC game (Unity/Unreal, Cheat Engine memory edits) goes to [[re-game]]
- Do not use: a mobile game ([[re-mobile]])
- Do not use: the generic decompile/debug base after a container yields a code segment (hand it to [[re-binary-core]]; Ghidra/IDA are used as usual)
- Do not use: modding a console / flashing custom firmware, console cracking, retail-media decryption and content-protection evasion, obtaining and distributing pirated/unauthorized ROMs — this skill only provides file formats and analysis methods; samples must come from a legal channel (a backup of a device you own, a dev kit / official SDK contents, material you are authorized to use); a cartridge dump is limited to analysis of a cartridge you own; jurisdictions differ on personal backups, and the user confirms that themselves
- Do not use: simply using a finished save editor / cheat tool (this skill is an analysis path and does not provide a finished tool)

## Tool preparation

Verify every tool before use. Static analysis can skip the sandbox; dynamic execution (running a ROM in an emulator, running a decrypted sample) defaults to the sandbox + network isolation ([[re-analyze/platform-tips]] supreme rule).

### Decompiler (pick either Ghidra or IDA)

- Ghidra (free, the official release package, needs a JDK; some distro repos have `apt install ghidra` / `pacman -S ghidra`):
  - Linux: the official release package; macOS: `brew install --cask ghidra`; Windows: the official zip
  - Verify: `analyzeHeadless -help` (headless mode) or import the target file in the GUI
  - Architecture coverage: Switch is aarch64, PS4/PS5 is x86-64, PSX is MIPS R3000 (methodology in [[re-mips]]), GBA is ARM7TDMI (Thumb handling in [[re-arm]]), NES is the 6502 family; GB/GBC uses Sharp SM83: encodings are close to 8080/Z80 but it is not a Z80-compatible variant (no IX/IY, no DD/FD/ED prefixes, no IN/OUT, and it has its own STOP/LDH and HL auto-increment/decrement); Ghidra core has no SM83; install an SM83 SLEIGH + Game Boy loader such as GhidraBoy; a Z80 module may be used only as a manual cross-check and must not be the ROM's processor language (see pitfall 6)
- IDA: the commercial edition's architecture modules are complete; the Freeware edition's architecture support follows the official page
- When importing a ROM, set the base by platform: GBA 0x08000000 (the cartridge map region), PSX from the EXE header field at 0x18 (typically 0x80010000, RAM base 0x80000000); NES/GB are a fixed address space + bank switching and need loader support for mapper/bank (see pitfall 6)

### hactool — Switch container parsing (NSO0/NPDM/NCA)

- Source and install: GitHub `SciresM/hactool` releases — 1.4.0 (the last release, published in 2018, supports NSO0/NPDM parsing and decompression, and NPDM can export JSON) provides a Windows package (`hactool-1.4.0-win.zip`); Linux/macOS build from source (copy `config.mk.template` to `config.mk` then `make`, depends on zlib/openssl)
- Verify: `hactool --help` shows the full options
- Note: hactoolnet (the CLI that shipped with the LibHac project), common in old tutorials/articles, has had its repo taken down — verified 2026-08, GitHub 404 (`Thealexbarney/LibHac` no longer exists); material that cites hactoolnet must have its link checked first, and functional gaps are filled with hactool + a hand-written parser script (pyelftools)
- Keys: `-k keys.txt` names the keyset (each line `key_name = HEX`); by default it reads `$HOME/.switch/prod.keys` (with `-d` it reads dev.keys). Decrypting NCA/NAX0 needs the matching keyset; without keys you can only do structure-layer analysis

### readelf / pyelftools — ORBIS and generic ELF parsing

- Linux: ships with binutils (`apt install binutils` and similar); macOS: `brew install binutils` or LLVM-family readelf; Windows: inside WSL
- pyelftools: `pip install pyelftools` (a script walks program headers / the section table)
- Verify: `readelf --version`, `python3 -c "import elftools; print('ok')"`
- A PS4/PS5 ORBIS ELF is a legal ELF64 with SCE-extended program headers — readelf can parse it directly (`-l` for PT_SCE_* segments, `-S` for the section table); do not bind to a dedicated ORBIS viewer (scene-community tools are unevenly maintained; verify before use)

### Emulator debuggers (retro-platform dynamic analysis)

- mGBA (GB/GBC/GBA, a built-in debugger + a GDB stub):
  - Debian/Ubuntu: `apt install mgba-qt` (the Qt frontend, universe) or `mgba-sdl`; Fedora: the official repo has only the libretro core `dnf install libretro-mgba` (no debugger); mGBA with a debugger uses Flatpak or a third-party COPR (for example `dnf copr enable archjun/mgba` then `dnf install mgba`; evaluate a third-party source yourself); Arch: `pacman -S mgba`; macOS: `brew install mgba`; Windows: the installer from the official site mgba.io
  - Verify: `mgba --version`
  - Debug: after the GUI loads a .gba/.elf, Tools → Start GDB Server (or the command line `-g`/`--gdb`), listening on localhost:2345 by default; on the GDB side `target remote localhost:2345`, and set breakpoints with a symbol-bearing .elf (mGBA's symbols come from the .elf, not the .gba); the command-line `-d` debugger is an SDL/GTK feature; the Qt build uses the GDB stub
- FCEUX (NES, a built-in debugger / hex editor / RAM search):
  - Debian/Ubuntu: `apt install fceux`; Fedora/Arch: `dnf install fceux` / `pacman -S fceux`; Windows: the official site fceux.com
  - Verify: `fceux --version`
- no$psx (a PSX debugger, a free Windows build): download from the official page problemkaputt.de/psx.htm (no distro package, Windows only), with a built-in disassembler / breakpoints / memory and VRAM viewer; Linux/macOS have no matching version; PSX dynamic debugging uses the QEMU family (the qemu-system approach of [[re-fw-emulate]] + gdb) or pure static
- Other platforms as needed: an SNES debugger can use Mesen (the official Windows download) and similar, following the official channel

### Cartridge readers (buying guidance, generalized)

- Approach: pick the matching interface by platform — NES 72-pin, SNES 62-pin, GB/GBC 32-pin, GBA 32-pin; covering many platforms is usually a host board + adapter-board combination
- Buying points: prefer open-source firmware (the firmware is auditable and you can compile it yourself); confirm it supports the target system and cartridge variants (a special mapper, an accelerator chip, CGB dual voltage); support a double-dump check (read the same cartridge twice and compare, and cross-check a known hash database); power and level matching (the GB family is 3V, NES is 5V, and plugging the wrong one can damage the cartridge); a read-only dump is the analysis baseline, and write/flash capability is used according to the authorization boundary
- Verify: cross-check the dump you read against runnability in a same-platform emulator / a known hash

### binwalk — scan embedded files

- Install channels and version distinction (v3 mainline / v2 legacy) are in the binwalk/unblob install matrix of [[re-fw-extract]]; verify: `binwalk --version`

## Procedure

Run in order and archive each step (hash, offset table, parsed-artifact sha256, [[re-triage]] archive); dynamic execution defaults to the sandbox.

1. **Identify the container** (fix the format first, then the toolchain):
   ```sh
   file target.bin
   xxd -l 64 target.bin
   binwalk target.bin    # scan embedded/concatenated files
   ```
   - Switch: `NSO0` (an NSO program), `META` (an NPDM file header), `NCA3` (an NCA container), `NAX0` (an SD encrypted partition), `PFS0` (an NSP plaintext package container); inside ExeFS, `main` (NSO) and `main.npdm` coexist
   - PS4/PS5: a plaintext ELF starts with `\x7fELF` (an ORBIS ELF carries PT_SCE_* program headers); a retail dump's eboot.bin is an encrypted container (no ELF magic, high entropy), and the encrypted boundary is here — this skill analyzes only a decrypted/unencrypted sample that was obtained legally
   - Xbox: `XBEH` (original Xbox XBE), `XEX2` (Xbox 360, a 24-byte big-endian header, 0x8 points at embedded PE data, an optional-header table); Xbox One/Series is a Microsoft-family variant container (the XVD/ERA system); probe from the actual sample before parsing
   - Retro: NES `4E 45 53 1A` ("NES\x1A"); GBA has no magic (0x0 is an ARM branch instruction, and from 0x4 there are 156 bytes of Nintendo logo); GB has no magic (from 0x104, a 48-byte logo criterion + the cartridge type at 0x147); a PSX disc is ISO9660 (a `CD001` volume descriptor), and the EXE pointed at by the main program SYSTEM.CNF starts with `PS-X EXE`; a raw .bin image has 2352-byte sectors (not 2048), and when locating the volume descriptor convert the sector offset as 2352
   - Saves: a GBA `.sav` has no unified magic (identify it by capacity / content structure); a PSX memory-card dump's `MC` signature is at 0x0 and 0x1F80
   - When the decision is unclear, do a routine [[re-triage]] survey first

2. **Parse the container** (distinguish partitions / encrypted boundaries):
   - Switch NSO (hactool recognizes NSO0 automatically):
     ```
     hactool -i main.nso                          # segment info / compression flags / ModuleId
     hactool --uncompressed=main_u.nso main.nso   # decompress compressed segments (when the flags compression bit is set)
     ```
     NSO0 header points: magic `NSO0` at 0x0; three segment headers at 0x10/0x20/0x30 (0xC bytes each: FileOffset/MemoryOffset/Size, corresponding in order to .text/.rodata/.data); BSS size at 0x3C; from 0x40, a 0x20-byte ModuleId (= the ELF build-id digest); compressed sizes of the three segments at 0x60/0x64/0x68; segment data starts at 0x100 (a compressed segment uses LZ4; when firmware 22.0.0+ flags bit7 is set it is the ZBIC/zstd variant, nxdumptool NsoFlags_UseZbicCompression=BIT(7))
   - Switch NPDM:
     ```
     hactool -t npdm --json=main.json main.npdm   # export the permission JSON
     ```
     NPDM points: a `META` header at 0x0 (0x80 bytes); main-thread priority at 0xE, main-thread core at 0xF, main-thread stack size at 0x1C (0x1000-aligned); ACI0 offset/size at 0x70/0x74, ACID offset/size at 0x78/0x7C; the ACID region has magic `ACID` at 0x200 (preceded by an RSA-2048 signature and public key), and the ACI0 region has magic `ACI0` at 0x0; ACI0 contains the ProgramId, filesystem/service access control, and kernel capabilities — permission-surface analysis looks here
   - Switch NCA (the encrypted boundary): the NCA header contains a partition table (section table), and the body is encrypted per partition (AES-XTS); with a legal keyset, `hactool -t nca -k keys.txt --exefsdir=exefs/ --romfsdir=romfs/ file.nca` extracts ExeFS (containing NSO/NPDM) and RomFS; NAX0 also needs the `--sdseed` and `--sdpath` arguments. Without a keyset, do only structure-layer parsing, not a decryption bypass
   - ORBIS ELF: `readelf -l eboot` shows the program headers — PT_SCE_DYNLIBDATA (0x61000000), PT_SCE_PROCESS_PARAM (0x61000001), PT_SCE_MODULE_PARAM (0x61000002), PT_SCE_RELRO (0x61000010); `readelf -S` shows the section table (.comment/.sceNote and others); the export table is inside PT_SCE_DYNLIBDATA
   - XEX2: walk the optional-header array (each item is type+data, and the data size is decided by the low 8 bits of type, ID&0xFF) — the execution-info optional header contains the entry point, and the import-library optional header contains library names and ordinals; the code-segment location is inferred from the PE data offset at 0x8; XEX header fields are big-endian, and the embedded PE part is parsed by PE rules ([[re-format-pe]])
   - Archive each step's artifacts: the extracted segment files + magic/offset/size records

3. **Extract the code segment into a generic decompiler**:
   - NSO: from the segment-header MemoryOffset, build .text/.rodata/.data as memory blocks in Ghidra (unify the base first, then auto-analyze), and fill the BSS region with 0; import as aarch64
   - ORBIS: import a decrypted ELF directly into Ghidra (x86-64); ET_EXEC uses the fixed base inside the header, ET_DYN uses the load convention; first use `nm`/`readelf -s` to find unstripped symbols; the entry point is often near the module-parameter segment / the entry section
   - PSX: extract the EXE text segment (starting at file offset 0x800, length from the header field at 0x1C), import it at the load address in the header field at 0x18, MIPS R3000 little-endian (delay slots and $gp methodology are in [[re-mips]])
   - GBA: import the whole ROM at 0x08000000, ARM7TDMI mixed with Thumb (see [[re-arm]]); GB/NES: when the decompiler has no native CPU, use an approximate instruction set + manual bank expansion (see pitfall 6), or a dedicated loader plugin
   - Saves: first `strings` to find a product code / checksum feature (a PSX slot header has a product-code string of the `BXXXX-12345` class at 0x0A)

4. **SDK library fingerprints** (version identification → faster function matching):
   - Switch: the ModuleId at NSO header 0x40, cross-checked against switchbrew's SDK version table / a community database, yields the SDK version (the map drifts as firmware evolves; check freshness first); a `NintendoSDK` version string inside the binary follows what the sample actually shows
   - ORBIS: the PT_SCE_MODULE_PARAM segment contains an sdk_version field (uint32, for example 0x08030001 corresponds to the 8.03 class) and the module-parameter magic 0x3C13F4BF; the `.comment`/`.sceNote` sections often contain an SDK version string — sdk_version is the compile-time SDK version, not the runtime firmware version
   - Xbox: the XEX2 import-library optional header lists system DLL names and ordinals (corresponding to an XDK version range); an XBE library-version array is the same idea
   - Retro: toolchain fingerprints — a commercial GBA ROM is mostly ARM7TDMI + a vendor compiler (library-function shapes / feature strings), and homebrew commonly has devkit-family feature strings; a commercial PSX disc commonly has vendor-SDK library-function shapes; cross-check a known library-signature table to speed function identification
   - Output: the SDK/toolchain version + a library-function feature table, for step 5 and later decompiler naming

5. **Patch differences** (join with [[re-variant]]):
   - Multi-version comparison: diff ROMs or main programs of the same game across regions / update packs — locate feature-change points and version-gate logic (a region check, an SDK-version branch)
   - Method: after decompress/unpack alignment, `diff` or follow the [[re-variant]] function-matching flow; when version differences concentrate in an SDK upgrade region and new features, stratify by the SDK fingerprint first and then diff layer by layer
   - Output: a difference-point inventory + analysis of the changed functions

6. **Retro: save and cheat-code analysis** (memory address + value pattern):
   - Save-structure parsing:
     - A PSX memory card: 128KB (0x20000) = 16 blocks × 8KB, and block 0 is the header/directory block; the `MC` signature is at 0x0 and 0x1F80; each block is 64 frames × 128 bytes; a slot header is 128 bytes — slot type at 0x00 (0xA0 empty / 0x51 first block / 0x52 middle / 0x53 last block), save size at 0x04, the next-block pointer at 0x08 (a multi-block save is a linked list), the product-code name at 0x0A, an XOR checksum at 0x7F; the icon is 16×16 4bpp, at most 3 frames (the second data byte 0x11/0x12/0x13 is the frame count)
     - GB/GBA: `.sav` size is decided by the cartridge type — GB looks at the field at 0x149 (0x02=8KB, 0x03=32KB are common); GBA commonly has SRAM 32KB, Flash 64/128KB, EEPROM at the 512B class; there is no unified magic; identify it by capacity + content features (a checksum, ASCII text)
     - Analysis purpose: recover the save checksum algorithm and field semantics (a number / an item / a progress bitmap)
   - Cheat-code analysis (methodology, not a finished tool):
     - Principle: a cheat code = an encoding of "memory address + value/write pattern", for example a GBA CodeBreaker form `AAAAAAAA 0000` (an 8-digit address + a 4-digit value) — GB/GBC uses the GameShark 8-bit format; do not mix the names; the NES family uses a 6-character encoding (address/value + a key transform); first decode the address and value by the encoding rules
     - Recovery path: an emulator debugger (mGBA/FCEUX) memory view/search locates an in-game value (coins, lives) → record the address (GBA: EWRAM starts at 0x02000000, IWRAM starts at 0x03000000; GB: WRAM 0xC000-0xDFFF) → a debugger breakpoint finds the code that writes that address → in the decompiler, recover that function and the data flow → obtain the semantics of "some address stores some value" and every reference
     - Output: an address-semantics table (address → meaning/type/range), for a checksum, decompiler annotation, or behavior research; analysis only, and no finished cheat tool is provided
   - Sandbox: dynamic verification inside an emulator defaults to the sandbox + network isolation

## Cross-domain joins

- [[re-binary-core]]: the generic survey / decompile / debug base after the code segment is extracted ([[re-ghidra]], [[re-ida]], [[re-gdb]] are used as usual)
- [[re-game]]: the sister skill for PC-side Unity/Unreal game reversing; the "memory address + value pattern" game-logic analysis method is shared
- [[re-cracking]]: license/activation-check analysis; the compliance boundary of a console case matches this skill
- [[re-variant]]: diff multi-version / multi-region ROMs and main programs
- [[re-mips]]: the PSX MIPS R3000 instruction set and methodology (delay slots, $gp)
- [[re-arm]]: Thumb/ARM handling for GBA ARM7TDMI
- [[re-fw-extract]] / [[re-fw-rootfs]]: extract files and filesystems embedded in a cartridge/disc image (binwalk first)
- [[re-patching]]: land a byte-level edit of a ROM/program (remember to recompute the header checksum; see pitfall 4)
- [[re-sandbox]]: forced isolation for an emulator / dynamic execution ([[re-analyze/platform-tips]] default-sandbox rule)
- [[re-triage]]: the survey before container identification
- [[re-format-pe]]: parse the PE part embedded in XEX2

## Common pitfalls

- **Treating an encrypted container as plaintext**: symptom — a Switch NCA/NAX0 or a PS4/PS5 retail eboot.bin is dropped straight into the decompiler, and it is all high-entropy garbage / the disassembly hallucinates code; cause — the contents are encrypted in the NCA body (AES-XTS) and the ORBIS container layer, and the NSO0/ELF magic is visible only after decryption; fix — identify the encrypted boundary first (missing magic + high entropy = ciphertext), and with a legal keyset decrypt and extract through the container tool (hactool unpacks NCA/NAX0); without keys, do only the structure layer; this skill's scope is a legally obtained sample, and it does not do a decryption bypass
- **An SDK fingerprint misjudged**: symptom — treating the compile SDK version as the runtime firmware version, or matching a ModuleId to the wrong SDK from an old cross-check table, so the library-function table does not line up; cause — the ModuleId↔SDK map drifts as firmware evolves, and ORBIS's sdk_version field is the compile-time version; fix — mark a fingerprint conclusion as "compile SDK version", check the cross-check table's freshness first (follow the page that is maintained now), and cross-check the actual version string inside the binary before deciding
- **The metadata header is separate from the body**: symptom — you parsed only the NSO or looked only at the NPDM, and the permission surface / entry information / code are not associated, so the analysis is missing a piece; cause — NPDM (permission/entry metadata) is a separate file that coexists with the NSO, the NCA partition table is in the header while partition data is scattered by offset, and XEX2's header fields and PE data are stored separately; fix — file the same batch of container artifacts (NPDM+NSO, each NCA partition, the XEX header + PE segment) as one whole, list them first, and then parse them one by one
- **A ROM header checksum and a patch that stops working**: symptom — after editing a ROM (a patch / a translation / a modification) the emulator or the real hardware refuses to boot; cause — GBA header 0xBD is the complement checksum of a byte-by-byte sum of 0xA0-0xBC (then subtract 0x19 and take 8 bits), and changing the title/game code requires a recompute; the GB header checksum at 0x14D covers 0x134-0x14C; changing NES mapper bits does not affect boot but does affect mapping correctness; fix — after editing the header, recompute the checksum by the algorithm, and write the checksum recompute into the patch plan's steps
- **Emulator vs real-hardware behavior differences**: symptom — a modification that runs on mGBA crashes on real hardware, and FCEUX and Mesen differ on mapper behavior for the same ROM; cause — timing-sensitive code (GBA audio/interrupt timing), mapper-implementation differences, emulator-accuracy differences; fix — mark the conclusion "verified in an emulator environment"; when you need a real-hardware-level conclusion, cross-check several emulators + recheck on real hardware (a reader / a flash cart); save write-back and power-off timing are especially unreliable on an emulator
- **Misaligned disassembly when the decompiler lacks native CPU support**: symptom — GB's SM83 has no native module, and approximating it as Z80 disassembles instructions that do not exist (the same encoding forks in meaning between SM83 and Z80, such as 0x22/0xE8/0x10); NES 6502 variant details are treated as ordinary instructions; cause — SM83 encodings are close to 8080/Z80 but it is not a Z80-compatible variant, and an approximate instruction set is not the target CPU; fix — identify the CPU first (GB looks at the 0x104 logo / the cartridge type at 0x147, NES looks at the mapper in flags), use an SM83 SLEIGH + Game Boy loader such as GhidraBoy for GB, mark the limit by hand when there is no native support, and correct an approximate disassembly against an emulator measurement
- **Authorization boundary**: console modding / custom firmware, retail-media decryption, and obtaining and distributing unauthorized ROMs are outside this skill; analysis samples must come from a legal channel; a cartridge dump is limited to analysis of a cartridge you own, and you confirm it yourself under the rules of your jurisdiction; the skill body only provides format parsing and analysis methods

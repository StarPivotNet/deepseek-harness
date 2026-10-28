---
name: re-fw-extract
description: >
  Firmware extraction and unpacking: binwalk/unblob, magic scan, endianness.
  Triggers: `固件`, binwalk, `解包固件`, firmware, IoT, MCU, 8051, AVR, PIC, MSP430, Intel HEX, .hex
capabilities: [firmware-extraction]
---

# Firmware extraction and unpacking

## When to use / when not to use

- Use: you have a firmware file (.bin / .img / an update package / an IoT image) and need to unpack it and look at the contents
- Use: you need to judge the firmware packaging method, architecture, and endianness
- Do not use: it is already a filesystem image / rootfs (go straight to [[re-fw-rootfs]])
- Do not use: you need to run the firmware and observe behavior (go to [[re-fw-emulate]])
- Do not use: you need physical-board hardware extraction (go to [[re-hardware-io]])

## Tool setup

Verify every tool before use. Unpacking and a magic scan are pure static analysis and can skip the sandbox ([[re-analyze/platform-tips]] highest principle); when an extracted product must be run, hand off to [[re-fw-emulate]].

### binwalk — main automatic unpacker

binwalk has two coexisting product lines; distinguish them before install: **v3 (a Rust rewrite) is the current upstream main line**, **v2 (the original Python implementation) is legacy**, and their parameter sets and module support differ.

- v3 (current main line): install by the channels in the official README — a Docker image / `cargo install binwalk` / a source build. upstream no longer treats pip as an install entry
- v2 (legacy): the PyPI `binwalk` package stopped at 2.1.0 (2015-01); distro-repo packages are also on the 2.x line (Debian trixie 2.4.3, bookworm 2.3.4)
  - Linux: `apt install binwalk` (Debian/Ubuntu) / `dnf install binwalk` / `pacman -S binwalk`
  - pip: `pip install binwalk`
  - macOS: `brew install binwalk`
  - Windows/WSL: native Windows has no official package; use the Linux build inside WSL
- Verify: `binwalk --version` — **confirm the major before use**. This skill's command examples (`-e` / `-M` / `-E`) are kept in both v2 and v3; when you need other v3 parameters, check `binwalk --help` for the actual version

### unblob — a more accurate automatic unpacker (recommended main tool)

- Cross-platform: `pip install unblob` (many dependencies; a venv is recommended: `python3 -m venv venv && venv/bin/pip install unblob`)
- Distros generally have no official package; use pip
- Verify: `unblob --version`

### dd — split by offset

- Linux/macOS: ships with coreutils (macOS ships /usr/bin/dd)
- Windows/WSL: the Linux build inside WSL; native Windows uses the dd that ships with Git Bash, or WSL
- Verify: `dd --version`

### hexdump — hex view and a manual magic scan

- Linux: `apt install bsdmainutils` (Debian/Ubuntu) / `dnf install util-linux` (Fedora/RHEL, includes hexdump)
- macOS: ships /usr/bin/hexdump
- Windows/WSL: the Linux build inside WSL
- Verify: `hexdump -C /dev/null` (usable if there is no error; the macOS build has no `--version`)

### sasquatch — unpack an old / vendor-modified squashfs

- Linux: build from source (`git clone https://github.com/devttys0/sasquatch`; after `apt install zlib1g-dev liblzma-dev build-essential`, `make`)
- macOS: the same source build (needs Xcode Command Line Tools)
- Windows/WSL: build inside WSL
- Verify: `sasquatch -h` prints usage (the build product is in a repo subdirectory and must be added to PATH)

## Procedure

Run in order. Record each step.

1. **Automatic unpack (unblob first, binwalk as fallback)**:
    ```sh
    unblob firmware.bin                      # 更准，自动识别 50+ 容器格式并递归解包
    # 或 binwalk：
    binwalk firmware.bin                     # 先列出签名与偏移
    binwalk -Me firmware.bin                 # -M 递归 -e 提取
    ```
   Products: a `firmware.bin/` (unblob) or `_firmware.bin.extracted/` (binwalk) directory. A filesystem that was extracted goes to [[re-fw-rootfs]]; an ELF goes to [[re-binary-core]].

2. **Manual magic scan (when automatic unpack is incomplete)**:
    ```sh
    hexdump -C firmware.bin | head -40
    # 或按 binwalk 报告的偏移核对：
    dd if=firmware.bin bs=1 skip=<偏移> count=16 | hexdump -C
    ```
   Common magics: JPEG `FF D8 FF`, gzip `1F 8B`, squashfs `hsqs`, cramfs `45 3D CD 28` (little-endian; big-endian is reversed), U-Boot `27 05 19 56`, jffs2 `85 19`, ELF `7F 45 4C 46`. Once one is identified, handle it in that format.

3. **Judge endianness**:
    ```sh
    file firmware.bin                        # 输出含 LSB/MSB 提示
    readelf -h <解出的ELF>                    # Machine 字段 + Data 字段（大小端）
    strings firmware.bin | head               # 可读串确认字节序
    ```
   Big-endian ARM/MIPS firmware is common: on big-endian, magics and strings are encoded big-endian (for example `hsqs` appears reversed); after confirmation, the whole flow follows that endianness.

4. **Unpack nested containers layer by layer**:
   - unblob / `binwalk -Me` recurse automatically, but nesting (a zip inside a tar, a custom header wrapping gzip) often breaks partway
   - Manual, layer by layer: unpack the outer layer first → `file` confirms the inner type → unpack again with the matching tool (tar/gzip ship with the system; squashfs uses sasquatch; others use 7z/unsquashfs from [[re-fw-rootfs]] Tool setup), until a filesystem or an ELF appears
   - **Trailing data after an end marker**: after the end marker of a format such as an image (PNG `IEND`, JPEG `FFD9`), a container/compressed stream is often appended (the parser stops at the end marker, and the appended data is invisible to a normal view) — `file` reports the whole file as an image. **The end-marker position cannot be fixed by a raw-byte first/last search** (`IEND` can appear inside a tEXt chunk payload, and `FF D9` can appear inside a JPEG APP/COM segment; the first/last hit may be a false marker): for PNG, start at the 8-byte signature and walk `Length/Type/Data/CRC` to a structurally valid `IEND` of length 0; for JPEG, start at `SOI` and parse by marker/segment, and after `SOS` handle `FF00` stuffing and `RSTn`, and take the `EOI` whose **syntactic position holds**; cut the appended data at the real end offset that was parsed (a raw-search result is only a candidate)
   - **A zip missing its signature can still be repaired**: an appended zip may be missing the `PK\x03\x04` at the start of the local file header (4 bytes were stripped) — verify by field self-consistency: after restoring the signature, version (commonly 20/45), mod date (year 1980+), and compressed/uncompressed size (consistent with the EOCD/central-directory entry) are all reasonable, and the EOCD at the tail is intact → prefixing `PK\x03\x04` makes it complete and unpackable (`unzip` reporting "missing 4 bytes" or zipfile `OSError: Invalid argument` is the typical sign)
   - **Automate a nesting pattern**: when the same technique repeats (for example every layer is "an image + a tail zip containing the next layer"), write a loop that peels automatically — extract the tail → repair → decompress → locate the next layer → repeat, until there is no appended data; keep a named product of each intermediate layer (so it can be rolled back)

5. **Manual split when automatic fails (dd by offset)**:
    ```sh
    binwalk firmware.bin                     # 找内嵌文件偏移
    dd if=firmware.bin of=part1.bin bs=1 skip=<偏移1> count=<长度1>
    dd if=firmware.bin of=part2.bin bs=1 skip=<偏移2>
    file part*.bin                           # 每块验证
    ```
   A vendor custom header is the most common: after skipping the first N header bytes it is a standard format (hexdump and eyeball the header length first, then cut).

## MCU image analysis (8051 / AVR / PIC / MSP430)

### When to enter this section

- Precondition: steps 1-5 are done (automatic unpack, magic scan, endianness judgment, nested unpack, dd split), and the image is confirmed to contain no filesystem/ELF/executable container
- Judgment conditions (entering this section is enough if they hold):
  - No filesystem: binwalk/unblob have zero hits or only a few false positives, and there is no magic such as squashfs/cramfs/jffs2
  - A single image: small (tens of KB), no partition table, no bootloader header, no multi-segment structure
  - MCU signatures: `file` reports data/unknown; strings have no OS or library signature strings (no "libc", no RTOS kernel name); the low addresses at the start of the image are a short jump / vector data rather than a readable header
- Exception handoff: if the image shows RTOS signatures (scheduler/task-creation strings, a TCB shape) → locate the reset vector and startup code, then hand off to [[re-rtos]]

### Image format: Intel HEX and binary

- **Intel HEX (.hex)**: ASCII text, one record per line `:LLAAAATT<data><checksum>` — LL is the data length, AAAA is the in-segment address, TT is the record type (00 data / 01 end / 02·04 extended address / 03·05 start address), and the last byte is the checksum
  - Addresses may be segmented and discontinuous: gaps are left between multi-segment records, and disassembling the whole file as a bin must be misaligned
  - Convert to a memory image first: place the data at the real address by record (02/04 extended-address records decide the high 16 bits of the address), then import into a disassembler at the flash start base
- **Binary (.bin)**: a raw memory image, with no address information; give the base by hand at import
- Program memory layout (generalized; concrete values differ by chip):
  - flash start: 0x0000 or the chip's mapped base (on the order of 0x8000/0x10000); inferring backward from where the reset vector sits is more reliable
  - interrupt vector table: a fixed region at low addresses; the reset vector sits at a fixed offset inside the table (see the next section)

### Locate the vector table

- Reset vector → startup code: take the entry address from the reset-vector location; disassembling along it is the startup sequence (disable interrupts, initialize stack/clock/peripherals, jump to main)
- The reset-vector location differs by architecture: 8051 is at 0x0000, AVR is at 0x0000, MSP430 is at 0xFFFE (the high-address end), PIC is usually 0x0000 (some series have another fixed offset) — look up the location by architecture; do not guess
- Firmware that runs an RTOS: reset vector → startup code → kernel init/task creation → scheduler start; join [[re-rtos]] and split by the task table

### ISA identification and disassembly

- Identification points (combine instruction word width, addressing signatures, and endianness):
  - **8051**: Harvard architecture; program/data spaces are separate (MOVC reads the program region, MOVX accesses the external data region); SFR special-function registers (0x80-0xFF direct addressing); the 0x20-0x2F region is bit-addressable; accumulator A and DPTR dominate data movement
  - **AVR**: RISC, a register file of 32 general registers (R0-R31); most instructions are single-cycle; Harvard architecture
  - **PIC**: Harvard architecture; registers are split into banks and switched by a status bit (bank switch); instruction word width differs by series (12/14/16 bits); import into a disassembler at the matching width
  - **MSP430**: von Neumann (a unified address space), 16-bit; the interrupt vector table is concentrated in the high-address region (0xFFE0-0xFFFF)
  - Endianness: AVR/PIC/MSP430 are little-endian; 8051 has no native endianness instruction, and multi-byte data is conventionally stored big-endian (Keil C51 defaults to big-endian), the opposite of the other three — confirm against the actual data when importing into a disassembler (the byte arrangement of multi-byte constants and jump-target addresses is the judgment basis)
- Disassembly: import the processor module of the matching architecture (Ghidra includes 8051/AVR/PIC/MSP430 processor support, [[re-ghidra]]; other disassemblers have the matching processor too; the tool is replaceable, the method is the core)
- Fuse/config bits (a generalized concept): burn-time config items (each architecture names them differently: fuse bits/config bits/security bits), written once at burn time, affecting clock-source selection, the watchdog, code/read protection, and similar. They do not appear in the image contents, but they decide later chip hardware behavior — when the image cannot be read, suspect them first

### Common pitfalls of this section

- **Disassembling a multi-segment Intel HEX directly as a bin**: Symptom — disassembly is misaligned, addresses do not match code, and everything is an invalid instruction; cause — HEX segment-record addresses are discontinuous, and ignoring 02/04 extended-address records drops high-address segment data onto low addresses; fix — place the data at the real address by record type first (extended-address records participate in address synthesis), generate a continuous memory view, then import at the flash base
- **Guessing the vector-table offset wrong**: Symptom — disassembling straight from the file header yields a pile of data/invalid instructions, and the entry cannot be found; cause — each architecture's reset-vector location differs (8051/AVR at 0x0000, MSP430 at 0xFFFE, PIC usually at 0x0000 or a series-fixed offset); guessing wrong starts disassembly at data; fix — confirm the architecture first, then take the entry from that architecture's fixed reset-vector location, and follow the startup code from the reset vector
- **Fuse bits lock read protection, and the image cannot be obtained**: Symptom — chip read protection is on, a read returns all F / refuses, and a complete image cannot be obtained; cause — burn-time config bits turned on read protection (code protection), and the normal read interface is locked; fix — take an alternative path: interact with the chip's built-in UART bootloader (if it was not disabled), or capture firmware-update/burn traffic with a logic analyzer ([[re-hardware-io]]) and recover it by protocol; when the image cannot be read, do not force it; switch to behavior-side analysis (serial output / protocol interaction)
- **Data EEPROM is conflated with program flash**: Symptom — disassembly yields a large number of invalid instructions, or half a day of analysis finds it is data; cause — the image contains a data EEPROM / calibration-table / config-table image (a non-volatile data region, separate from the program region) that was treated as code; fix — locate the program-region start with the reset vector / vector table; exclude high-entropy / all-F / repeating-pattern segments outside the program region as data regions first, then disassemble

## Cross-domain joins

- [[re-firmware]]: workflow step 2 always calls this skill
- An extracted filesystem → [[re-fw-rootfs]]; an extracted runnable program → [[re-fw-emulate]]
- An extracted ELF → [[re-binary-core]] ([[re-format-elf]] / [[re-ghidra]]); a malicious sample found → [[re-malware]]
- This skill is called by the [[re-analyze]] triage "analyze firmware / IoT device" path (re-firmware → re-fw-extract)

## Common pitfalls

- **Automatic unpack failing ≠ there is nothing**: Symptom — binwalk output is blank or extracts 0-byte files; cause — a vendor custom header / encryption layer makes the magic mismatch, and the signature library misses it; fix — hexdump and manually scan the custom header (step 2), skip the header offset, and split with dd (step 5)
- **Wrong endianness → everything is wrong**: Symptom — extracted files/ELFs/strings are all garbage; cause — big-endian ARM/MIPS firmware was treated as little-endian; fix — confirm endianness with `file` + `readelf -h` first (step 3), and keep it consistent through later unpack/analysis
- **A big-endian MIPS header is missed by binwalk**: Symptom — binwalk cannot identify a known filesystem (such as squashfs); cause — signatures match little-endian features, and the big-endian magic is reversed; fix — hexdump and find the reversed magic by hand, dd by offset, and unpack with sasquatch
- **Unpack products mixed with garbage**: Symptom — an extracted "file" is random data, and `file` reports data; cause — a signature false positive or a misaligned split offset; fix — verify each product with `file` + the first 16 bytes' magic; if invalid, retry the offset
- **Extension does not match contents (a disguised extension)**: Symptom — a `.jpg` reports PNG, a `.so` reports tar, a `.c` reports XZ; cause — the author deliberately used an unrelated extension (common in steganography / nesting / inspection-avoidance scenes); fix — always trust `file`/magic; an extension is only a lead; when `file` output carries a hint such as "with extra data prepended", follow it directly
- **zip errors but can list files**: Symptom — `unzip` reports "missing 4 bytes"/"invalid zip with overlapped components" (a zip-bomb false positive) or Python zipfile `OSError: [Errno 22] Invalid argument`; cause — the local file header is missing the `PK\x03\x04` signature, or there is prefix garbage before the data; fix — first `unzip -l` to see whether it can list (if it can, the EOCD/central directory is intact), restore the signature (step 4), or force it with `UNZIP_DISABLE_ZIPBOMB_DETECTION=TRUE`
- **ME firmware (Intel ME / CSME) starts from the boot chain**: Symptom — after extracting ME firmware partitions (FTPR/RBE/BUP) there is no place to start, and a string of ROM_SVC_* calls in the code is unreadable; cause — ME is independent-processor firmware, and its boot chain differs from ordinary firmware: ROM (fused inside the PCH, not extractable) verifies FTPR → decompresses RBE (initialize PCH/SPI, UTOK check, boot_cfg) → kernel (ThreadX RTOS) → BUP (hardware bringup, reads boot_cfg to decide whether to enable DCI) → 38 user processes such as pm/vfs/heci/crypto; fix — unpack the FPT first (Flash Partition Table: the partition routing table at a fixed offset in the ME region, recording each partition's location/size/type — ROM/RBE have no filesystem and locate partitions only by looking it up; UEFIExtract source has a parse reference), then follow RBE→kernel→BUP; debug-interface / hardware-init logic is in BUP
- **UTOK is the OEM backdoor for ME debug unlock**: Symptom — you want to enable the ME debug interface (DCI/DFX) and cannot find the switch; cause — the unlock mechanism Intel left for OEMs: an independent UTOK partition in the SPI Flash FPT partition table; writing data unlocks the DFX debug interface (no hardware fuse needed); fix — reverse RBE's `rbe_utok_check` to locate the check logic: the flag UTOK[0x298]==1 is what starts debug capability (the vendor default FF does not start it), and DCI being open is controlled by a multi-layer check chain (boot_mode==2, boot_cfg parsing, a CT handler gate, FPF Debug Auth, and similar); changing the flag alone is not enough; location trick: the ME runtime base is 0x4000, and string offsets are converted against it
- **ME firmware exploitation is limited by the ROM cookie**: Symptom — a buffer overflow was found in ME firmware (such as Intel-SA-00086: the CT file's `num_records` (uint16 at offset +0x06) is unchecked, and a record count over 100 overwrites the stack cookie/return address), but ROP will not land; cause — ME's cookie is generated by ROM (mask ROM, not extractable) prefilling a process-context table in SRAM, and it cannot be bypassed with TLS the way the TXE platform can; fix — first confirm the target platform's cookie source (if ROM generates it, overflow exploitation is limited); after a full reverse of the authentication chain (UTOK→boot_cfg→CT handler multi-layer checks), look for a non-overflow path
- **A transform that resets per block**: Symptom — a single whole-file XOR/rotate works only at the start; cause — the transform resets on a block size (commonly 256/512/1024/2048/4096); fix — first check, against common Flash/transfer block sizes, whether the transform resets its period per block, and decode in explicit blocks
- **A mask carried at the start of a block**: Symptom — high-entropy firmware is treated as strong encryption; cause — a per-block self-carried mask obfuscation (for example `mask = block[0]`, `plain[i] = ROR8(packed[i], n) XOR mask` (the mask byte itself does not participate in the transform; i starts at 1)); fix — first constrain and recover the first block with a strong crib (a vector-table SRAM stack pointer / a Thumb Reset Vector), then verify the model
- **A mode crib is unreliable**: Symptom — a text-dense block still garbles when the mode byte is used as the mask; cause — the most common plaintext byte is not necessarily zero; fix — switch to a block-first-byte model; verification standard: garbage disappears + a second firmware of the same series reproduces it + a round-trip matches byte for byte
- **A CRC string ≠ a CRC field**: Symptom — seeing a string named CRC and assuming the tail is a standard CRC; cause — the string is only a metadata key; fix — after systematically ruling out common CRC / hardware CRC / Adler / accumulator families, keep it as an unknown field; do not force a name
  (source: reverse-skill field-journal, MIT)

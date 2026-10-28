---
name: re-packer-id
description: Packer and obfuscator identification: signatures, section names, entry point, entropy. Triggers: `查壳`, `加壳识别`, packer, `壳名`, UPX
capabilities: [unpack]
---

# Packer and obfuscator identification

## When to use / when not to use

- Use: an unknown sample, to confirm whether it is packed and to name the packer so the unpack path can be chosen; a static first look that found high entropy, unusual section names, or a tiny import table (see the [[re-triage]] output) and needs a firmer check
- Use: before dynamic analysis, to decide whether the observed behavior belongs to the packer or to the program
- Do not use: the target is already a clean sample and the logic is what you want (switch to [[re-binary-core]])
- Do not use: the exact packer name is already known and only the unpack action is left (go straight to [[re-unpack-simple]] / [[re-unpack-advanced]]; the identification step can be skipped)
- Note: **failure to identify is not proof of no packer** (the signature set is incomplete, or the packer is obscure). Judge from the feature combination, and if needed follow the manual flow for an unknown packer

## Tool setup

Static identification may skip the sandbox (the top rule in [[re-analyze/platform-tips]]: static analysis may skip the sandbox); verify a tool before use.

### Detect It Easy (DIE, cross-platform primary)

- Linux: download `die_lin64_portable_<ver>.tar.gz` from the official GitHub release `Horsicq/Detect-It-Easy` and extract it (CLI `diec` / GUI `die`); Debian/Ubuntu can also `apt install die` (the distro build is older; use the official build when the signature set is incomplete)
- macOS: `brew install --cask detect-it-easy`
- Windows: extract the official release `die_win64_portable_<ver>.zip`; GUI `die.exe` / CLI `diec.exe`
- Check: `diec --version`

### PEiD (classic Windows tool, a supplement to DIE)

- Windows only (it also runs under Wine): download PEiD 0.95 (GitHub mirror) and prefer the `PEiD 0.96/0.97` signature update; when DIE does not identify the sample, cross-check with this
- Check: opening the sample in PEiD shows a packer name or an entry-point signature

### file / strings (first features)

- Linux: `apt install file binutils` / `dnf install file binutils` / `pacman -S file binutils`
- macOS: shipped with Xcode Command Line Tools (`xcode-select --install`)
- Windows/WSL: the Linux packages inside WSL
- Check: `file --version`, `strings --version`

### Entropy (python3 primary; ent/binwalk optional)

- python3: `apt install python3` / shipped on most systems; check `python3 --version`
- ent (optional): `apt install ent` / `brew install ent`; check `ent` (no arguments prints usage)
- binwalk (optional, entropy plot): install as in [[re-fw-extract]]; check `binwalk -E sample.exe | head`

### pefile (optional, PE section / EP / import-table scripts)

- All platforms: `pip install pefile`
- Check: `python3 -c "import pefile"`

## Steps

Run in order and record each result (evidence path + sha256; see [[re-triage]]). The identification conclusion (packer name / unknown packer / no packer, plus an OEP clue) is the input to the unpack path.

1. **Collect first features (file/strings)**:
   ```sh
   file sample.exe
   sha256sum sample.exe
   strings -n 6 sample.exe | head -30
   ```
   A packed sample usually has very few readable strings, and a packer signature near the EP (the UPX header has the `UPX!` magic; ASPack and others have section-name signatures). A clean sample has rich strings.

2. **Signature-set scan (DIE/PEiD)**:
   ```sh
   diec sample.exe          # CLI 扫描；GUI 用 die
   ```
   PEiD (Windows): drop the sample in and read the four signature columns: packer name / Entrypoint / Section / Overlay. Three outcomes: **a definite packer name** (UPX 0.89~3.xx / ASPack / FSG / VMProtect…), **a suspicious feature** (only the entry point or a section name hit), **unrecognized**. Unrecognized does not mean clean (see pitfall 1).

3. **Unusual section names**:
   ```sh
   objdump -h sample.exe | head -30
   ```
   Signs: `UPX0`/`UPX1`, `.aspack`, `.adata`, `.petite`, all-caps custom section names, or an unusual section count or order. Section names can be disguised as `.text`/`.data` (see pitfall 2). Normal names still need steps 4-6.

4. **Entry-point check (is the EP outside the first section)**:
   ```sh
   objdump -f sample.exe     # 看 start address
   python3 - <<'EOF'
   import pefile
   pe = pefile.PE('sample.exe')
   ep = pe.OPTIONAL_HEADER.AddressOfEntryPoint
   for s in pe.sections:
       va, vs = s.VirtualAddress, s.Misc_VirtualSize
       if va <= ep < va + vs:
           print("EP 位于节:", s.Name.rstrip(b'\x00').decode(), hex(va))
   EOF
   ```
   A normal PE points the EP at the first section, `.text`. **An EP in a later section or a writable section is a strong packer sign.**

5. **Entropy > 7**:
   ```sh
   ent sample.exe            # 整文件熵（可选）
   binwalk -E sample.exe | head -20   # 熵分布图，高熵段 = 压缩/加密
   python3 - <<'EOF'
   import math, collections
   d = open('sample.exe','rb').read()
   c = collections.Counter(d); n = len(d)
   h = -sum((v/n) * math.log2(v/n) for v in c.values())
   print(f"entropy = {h:.3f} bits/byte")
   EOF
   ```
   **Entropy > 7.0 bits/byte → suspect packing or encryption.** Per-section entropy is more useful (a mix of a high-entropy packer section and a low-entropy code section is also a packer sign).

6. **A tiny import table**:
   ```sh
   objdump -p sample.exe | grep -A6 'DLL Name' | head -20
   ```
   A normal PE imports hundreds or thousands of APIs. A packed PE often imports only a few APIs from `kernel32.dll`, such as `LoadLibraryA` / `GetProcAddress` (the rest are resolved dynamically at runtime). A tiny import table plus high entropy → packing is nearly certain.

7. **Record the OEP clue now (during identification, not later at unpack time)**:
   ```sh
   objdump -d sample.exe | sed -n '1,20p'    # EP 附近指令
   ```
   A simple compression stub often starts with `pushad`/`pusha` (the premise of the ESP law). A strong packer's entry is often `push imm32; mov reg, imm; jmp vm_handler`. **Record the entry instruction sequence and the entry address.** Unpack time uses them directly as the breakpoint and the OEP test.

## Cross-domain handoff

- [[re-anti-analysis]]: step 1 of that workflow (packer identification) always calls this skill. The conclusion decides the unpack-simple / unpack-advanced branch
- The triage path "sample is packed / unpack" in [[re-analyze]] calls this (re-anti-analysis → re-packer-id)
- [[re-malware]]: identify the packer on a packed sample before choosing the unpack path
- [[re-mobile]] / [[re-apk]]: after a packer is identified, confirm the packer class (an Android packer)
- [[re-triage]]: unusual entropy or suspicious section names come here for confirmation
- [[re-crypto-id]]: the packer layer pollutes constant fingerprints — identify and unpack first, then fingerprint the constant tables
- A strong packer or an unknown packer → [[re-unpack-advanced]]; a simple compression packer → [[re-unpack-simple]]; no packer → back to [[re-binary-core]]

## Pitfalls

- **An incomplete signature set misses a new packer**: symptom — DIE/PEiD report "Not found", but the sample entropy is 7.8 and the import table has only 3 APIs; cause — a private or obscure packer is not in the signature set; fix — do not trust one signature. Judge from the four features together (section names + EP + entropy + import table) and, if it is an "unknown packer", follow the manual unpack flow
- **Disguised section names**: symptom — every section is `.text`/`.data` and looks normal, but entropy is high and the EP points at the second section; cause — the packer renamed the section table on purpose; fix — section names are a clue, not evidence. Cross-check EP location + entropy + the import table
- **A packer inside a packer**: symptom — it is identified as UPX, but after `upx -d` the unpacked file still shows packer features to `file`; cause — layered packing (UPX wrapping Themida, and so on); fix — unpack one layer and identify again. **Re-check the four elements on every layer: the PE header (new EP location / section-table shape / header fields), section names (whether a new packer section appeared), entropy distribution (whether a new high-entropy section appeared), and the import table (whether it is still tiny / only dynamic `GetProcAddress` calls remain).** All four must look normal before the sample is fully unpacked. Any one that is still wrong sends you back through this skill
- **No OEP clue was recorded during identification**: symptom — halfway through unpacking you need "the packer entry instructions / the EP address" and have to guess the breakpoint; cause — nothing was recorded at identification time; fix — step 7 records the entry instructions (`pushad` and the rest) and the address during identification, so the ESP law can use them directly
- **A packer name is not "every option is on"**: symptom — DIE says VMProtect/Themida and the full strong-packer flow is assumed, but the sample is only simple compression or virtualization was never enabled; cause — the name only says which packer was applied. Virtualization and anti-debug are build-time options; fix — the identification report includes version and configuration clues (whether `.vmp0`/`.vmp1`/`.themida` sections exist, whether the entry is a VM dispatcher or an ordinary stub, and the bitness). [[re-anti-analysis]] then decides [[re-unpack-simple]] or [[re-unpack-advanced]]
- **Automated unpackers are sensitive to version and bitness**: symptom — x64Unpack/Magicmida and similar tools do nothing useful, or the dump is corrupt; cause — an unpacker is built for a specific packer version and bitness (Magicmida supports 32-bit only and does not repair a VM anti-dump; x64Unpack has only been checked on Themida 2.4.6 / VMProtect 3.4); fix — during identification, record packer name + version + bitness (the DIE version field / deep scan). Check the support matrix before picking a tool. If it is unsupported, use the manual flow

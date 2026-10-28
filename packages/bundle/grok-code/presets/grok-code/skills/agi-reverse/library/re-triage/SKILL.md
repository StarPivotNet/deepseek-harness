---
name: re-triage
description: >
  First look at a file: file/hash (sha256/md5)/entropy/strings/architecture identification.
  Triggers: `先看看这文件`, triage, `初勘`, `这是什么文件`, hash
capabilities: [triage]
---

# First look at a file (triage)

## When to use / when not to use

- Use: the first step on an unknown sample; decide the file's real type and architecture; hash the file for evidence before any analysis; entropy check for packing/encryption
- Do not use: the file type is already known and you only need to dig into structure (go straight to the matching format skill [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]]); you only need function logic (a decompiler skill)
- Do not use: the sample is already confirmed packed and the goal is unpacking itself (the [[re-anti-analysis]] domain)

## Tool setup

Verify every tool before use. Follow the top rule in [[re-analyze/platform-tips]] (static analysis may skip the sandbox, but anything that runs the sample always uses a sandbox).

### file — file-type determination

- Linux: `apt install file` / `dnf install file` / `pacman -S file` (most distros include it)
- macOS: `brew install file` (built-in /usr/bin/file)
- Windows/WSL: use the Linux build inside WSL; on native Windows use the file that ships with Git for Windows, or a third-party build
- Verify: `file --version`

### sha256sum / md5sum — hash for evidence

- Linux: included with coreutils (otherwise `apt install coreutils` / `dnf install coreutils` / `pacman -S coreutils`)
- macOS: built in; use `shasum -a 256` or `md5`
- Windows/WSL: Linux build inside WSL; native Windows PowerShell: `Get-FileHash -Algorithm SHA256`
- Verify: `sha256sum --version`

### strings — extract key strings

- Linux: included with binutils (`apt install binutils` / `dnf install binutils` / `pacman -S binutils`)
- macOS: `brew install binutils` (commands take a `g-` prefix, such as `gstrings`) or `llvm-objdump --strings`
- Windows: Sysinternals `strings64.exe` (choco: `choco install sysinternals`), or the Linux build inside WSL
- Verify: `strings --version` (Linux) / `gstrings --version` (macOS brew)

### objdump / readelf — confirm architecture and headers

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils`
- macOS: `brew install binutils` (`gobjdump`) or `brew install llvm` (`llvm-objdump`)
- WSL: the Linux build works directly
- Verify: `objdump -V` / `readelf --version`

### xxd — hex view

- Linux: `apt install xxd` / `dnf install vim-common` / `pacman -S xxd`
- macOS: `brew install xxd`
- WSL: Linux build
- Verify: `xxd -v`

### ent / python — entropy

- `ent`: `apt install ent` (Debian/Ubuntu); dnf/pacman have no official package → use the python approach
- python (cross-platform fallback, recommended): no extra dependency beyond `pip install --user`; write a script or a one-liner:
  ```sh
  python3 - <<'EOF'
  import math, collections
  data = open('sample.bin', 'rb').read()
  c = collections.Counter(data); n = len(data)
  e = -sum((v/n) * math.log2(v/n) for v in c.values())
  print(f"entropy={e:.3f} bits/byte ({len(data)} bytes)")
  EOF
  ```
- Verify: entropy on `/dev/zero` is ≈ 0.000, and on a random file ≈ 7.9+

## Steps

Run in order. Record the result of each step.

1. **file decides the format**:
   ```sh
   file sample.bin
   ```
   Record Magic, format (PE32/PE32+, ELF 32/64-bit LSB, Mach-O arm64, ...), and architecture. Do not fully trust file — magic can be forged. Cross-check with objdump next:
   ```sh
   objdump -f sample.bin   # print header info and architecture
   ```
   For ELF, also `readelf -h sample.bin` and read the Machine field.

2. **Hash for evidence (do this before touching the file)**:
   ```sh
   sha256sum sample.bin > sample.sha256
   md5sum sample.bin
   ```
   Save the output as `sample.sha256` and write it into the analysis notes. Any later change to the file (patch / unpack product) must be comparable to the original hash.
   - **Packed sample: record the five-item baseline before unpacking** — after packing is confirmed (hand off to [[re-anti-analysis]]) and before you start unpacking, record more than SHA256: **PE timestamp** (TimeDateStamp), **EP RVA** (AddressOfEntryPoint), **section hash** (each section's VirtualSize and data hash), **import table** (DLL names + imported API list, exported with `objdump -p` / pefile). Comparing this baseline before and after unpacking is how you decide "whether it reached an analyzable state" ([[re-unpack-simple]] / [[re-unpack-advanced]]).

3. **strings extracts key strings**:
   ```sh
   strings -n 6 sample.bin | head -100
   ```
   - Look for: readable file names/URLs/paths, `flag`/`key`/`secret`, error messages (they leak internal function names), Go/Rust runtime features (`runtime.main`, `_ZN...`)
   - Chinese-locale samples: default `strings` takes ASCII only. UTF-16 strings use `strings -e l sample.bin` (little-endian 16-bit). For GBK Chinese strings, `xxd sample.bin | head` first and judge the encoding by eye before deciding
   - When output is huge, filter short strings with `-n 6` first, then `grep -iE 'http|flag|key|secret|dll|\.so'`

4. **Entropy**:
   ```sh
   ent sample.bin
   # or the python one-liner (see Tool setup)
   ```
   - Entropy > 7.0 bits/byte: suspect packing/encryption/compression → next step follows the [[re-anti-analysis]] path
   - Entropy 4.5-7.0: mixed content, the common range for a normal executable; continue
   - Entropy < 4.5: mostly plaintext data / uncompressed code
   - Per-section entropy is more accurate: use `objdump -h` or pefile and compute entropy per section (a packer's signature is some sections with extremely high entropy)

5. **Security features and compiler identification**:
   ```sh
   readelf -h sample.bin | grep Type              # ET_EXEC is usually non-PIE; ET_DYN may be PIE or a shared object
   readelf -d sample.bin | grep -i FLAGS_1        # FLAGS_1 containing PIE (DF_1_PIE) is a PIE executable
   readelf -l sample.bin | grep -A1 GNU_STACK     # stack with E permission = missing NX
   readelf -l sample.bin | grep GNU_RELRO         # present = RELRO on (Full also checks BIND_NOW)
   readelf -s sample.bin | grep __stack_chk_fail  # present = canary on
   strings sample.bin | grep -iE 'GCC:|clang version|Microsoft Visual'  # compiler features
   ```
   - Compiler identification helps later judgment: MSVC commonly has `__security_cookie`; GCC/Clang commonly have `__stack_chk_fail` (canary shape differs)
   - Crypto-constant detection hands off to [[re-crypto-id]] (AES S-box / TEA delta fingerprints)
   - Write security features into the sections summary of the output contract, for [[re-vuln]] / the report

6. **Decide the next step**:
   - Normal format + normal entropy → [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]] (by type)
   - Abnormal entropy / suspicious section names (UPX0/.aspack) → [[re-anti-analysis]] to confirm the packer first
   - The goal is dynamic behavior → [[re-tracing]] + [[re-gdb]] inside a sandbox (top rule in [[re-analyze/platform-tips]])

7. **Output contract**: emit a structured summary per [[re-analyze/analysis-contract]] — **core fields** (target_id / sha256 / evidence / findings / unverified) + **file-domain extension fields** (arch / format / entropy / sections / imports_exports / strings_refs / security features). That is the input to the next stage (format / decompile / sandbox); do not rescan. A non-file target (protocol/model/device) uses the fields of its own domain (see [[re-analyze/analysis-contract]] §3.2). Do not force file-domain fields onto it.

## Related skills

- [[re-binary-core]]: workflow step 2 always calls this skill
- [[re-malware]] / [[re-firmware]] / [[re-mobile]] / [[re-ctf]]: every gateway's first step on a sample is this first look
- This skill's conclusion (the RE_TRIAGE result) chooses the later format skill. It is a mandatory prerequisite before any dynamic analysis

## Pitfalls

- **High entropy ≠ necessarily packed**: compressed data (a compressed segment inside a UPX packer, a zlib resource segment) also has entropy >7. Judge together with section names and the import table. Do not decide from entropy alone
- **strings encoding in a Chinese locale**: Chinese strings are often GBK or UTF-16LE. Default `strings` prints garbage or drops them — pass the encoding with `-e`, and use `xxd` to look when needed
- **Hash before touching the file**: sha256 for evidence before any analysis. Dynamic execution can dirty the sample file. Without the original hash there is nothing to compare
- A full `strings` dump of a large file can reach hundreds of MB → set a minimum length with `-n` and truncate with `head`
- **A tool error ≠ a damaged file**: symptom — `file`/`readelf`/`objdump` errors on the sample or output stops; cause — an adversarial sample forges header fields (abnormal section-header size, absurd program-header count, missing dynamic section) so the parser fails. The file is not actually damaged; fix — use `xxd` to check the key header fields by hand (e_lfanew / e_shoff / e_shnum / e_shentsize), repair them to the real values, then parse again. Do not throw the sample away as garbage
- **No baseline before unpacking → nothing to compare**: symptom — after unpacking the EP changed, sections were added or removed, and the import table became dynamic calls, and you cannot tell packer-normal behavior from an unpack error; cause — the PE header / sections / import-table baseline was not recorded before unpacking; fix — before you start, record the five items in step 2 (SHA256 / PE timestamp / EP RVA / section hash / import table), and compare item by item after unpacking before judging success or failure
- **A visible string ≠ the answer (decoy flag)**: symptom — `strings` shows a flag/key/key string directly, but submitting it is wrong; cause — a hard sample deliberately puts the decoy where "an analyst sees it first and does not suspect it" (DOS stub, resource section, an obvious string). The real answer is hidden in protocol logic / encrypted data; fix — a string is a lead, not a conclusion. Cross-check (code references, protocol logic, comparing several copies). **The easier a place is to see, the more suspicious it is**. A "flag format" string in the DOS stub (inside the PE header) is basically a trap

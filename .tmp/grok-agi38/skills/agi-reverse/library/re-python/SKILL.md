---
name: re-python
type: atomic
description: >
  Analysis of packaged or obfuscated Python samples: PyInstaller/PyArmor/Nuitka/Cython unpacking, pyc version identification, and decompilation.
  Triggers: `Python打包`, PyInstaller, PyArmor, pyc, python exe, `Python 样本`, `打包样本`.
capabilities: [bytecode-parser]
---

# Packaged-Python sample analysis (PyInstaller / PyArmor / pyc)

## When to use / when not to use

- Use: a PyInstaller one-file or one-dir exe, a PyArmor-protected sample, a .pyc file, a Nuitka/Cython compiled product, a packaged Python malware sample
- Do not use: pure .py source obfuscation (a base64/encoding wrapper) → switch to [[re-script-deob]]. Python model weights (pkl/onnx) → [[re-ai-model]]

## Tool setup

See [[re-analyze/platform-tips]] — unpacking and decompilation are static steps and skip the sandbox. Taking plaintext dynamically ([[re-sandbox]]) enters the sandbox under the top rule.

### python3 (the base runtime, required)

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: `brew install python` (also shipped with the system)
- Windows: the official installer or `choco install python`
- Check: `python3 --version`

### pyinstxtractor (PyInstaller archive extraction)

- All platforms: `pip install pyinstxtractor-ng`, or the GitHub script `python pyinstxtractor.py`
- Check: `pyinstxtractor-ng <target.exe>` runs without an error (there is no separate --help command)

### PyArmor-Unpacker (unpacking a PyArmor-protected sample)

- All platforms: `git clone https://github.com/Svenskithesource/PyArmor-Unpacker`, and pick one of the three methods by PyArmor version as the README says
- Check: the python scripts in the repo run

### pycdc / pycdas (pyc decompilation)

- Linux/macOS: `git clone https://github.com/zrax/pycdc && cd pycdc && cmake . && make`
- Windows: a prebuilt binary, or compile inside WSL
- Check: `./pycdc --help`

### file (a helper for identifying the packer, general)

- Shipped on each system (Linux binutils / macOS / Windows needs an extra install, or skip it)
- Check: `file --version`

## Steps

Run in order. Archive each product (path + sha256; see [[re-triage]]).

1. **Identify the packer**:
   ```sh
   file sample.exe
   strings sample.exe | grep -iE 'PyInstaller|_MEIPASS|pyi-|PyArmor|pyarmor' | head
   ```
   - PyInstaller signs: a `PyInstaller` version string, a `_MEI` temporary-directory name, a `pyi-` prefixed bootloader
   - PyArmor signs: a `pyarmor` runtime string
   - Nuitka/Cython: no pyc, a pure compiled product (`file` shows an ordinary executable, with no packaged-Python-runtime feature)
   - Identification failed but it is confirmed Python-related → treat it as a suspicious PyInstaller

2. **Unpack PyInstaller**:
   - A pip install: `pyinstxtractor-ng sample.exe`. The GitHub script: `python pyinstxtractor.py sample.exe`
   ```sh
   python pyinstxtractor.py sample.exe
   # 输出 sample.exe_extracted/ 目录，含 PYZ-00.pyz（依赖归档）与主脚本 .pyc
   ```
   - Locate the main .pyc (the name matches the entry script). Modules inside the PYZ are extracted automatically to `PYZ-00.pyz_extracted/`. The module list can be viewed with archive_viewer.py

3. **Unpack PyArmor** (when step 1 detected PyArmor):
   - Pick one of the three PyArmor-Unpacker methods by PyArmor version (the README decides the version → the matching method)
   - The unpack product is still pyc or source. Continue to the next step

4. **Identify the pyc version**:
   ```sh
   python3 -c "import struct,sys; print(struct.unpack('<H', open('main.pyc','rb').read(2))[0])"
   ```
   - The magic table (little-endian 2 bytes, common values; trust MAGIC_NUMBER on this machine):
     - `0d33`=3.6, `0d42`=3.7, `0d55`=3.8, `0d61`=3.9, `0d6f`=3.10, `0da7`=3.11, `0dcb`=3.12
     - 3.13+: do not hard-code the number. Convert from MAGIC_NUMBER on this machine (`python3 -c "import importlib.util; print(hex(int.from_bytes(importlib.util.MAGIC_NUMBER[:2],'little')))"`)
   - The pyc header layout (a unified 16 bytes on 3.7+): magic(4) + flags(4) + mtime(4) + size(4). The code object starts at offset 16. The low bit of flags = hash-based (PEP 552; mtime/size are meaningless). A pyc extracted by PyInstaller has flags/mtime/size all 0 (zeroing is normal, not corruption)
   - The version decides the marshal format: from 3.14 marshal rises to v5, and the code object's internal layout differs from older versions — a hand-written marshal parse must dispatch on the magic version. Tools such as pycdc lag on 3.13+. Prefer `dis` / `marshal` from a python that matches the version
   - If the version matches the target, decompile with that python version or with pycdc. If it does not match, install the matching version and try again

5. **Decompile and clean up**:
   ```sh
   pycdc main.pyc > main_decompiled.py   # 或匹配版本 python 的 dis 模块
   ```
   - Clean confusion code: delete fake functions and dead code (unreferenced wrapper functions, common in PyArmor), and locate the core logic (crypto / network / exfiltration)
   - Decompilation failed (a version mismatch / obfuscation) → analyze the key functions at bytecode level with `dis`, or switch to [[re-binary-core]] for a deep recovery

## Cross-domain handoff

- The [[re-managed]] gateway: this skill belongs there (the "packaged Python sample" branch of the selection tree)
- [[re-script-deob]]: pure script obfuscation (no packaging)
- [[re-malware]]: behavior verification and IOCs of a malicious Python sample (after unpacking, switch to behavior analysis)
- [[re-binary-core]]: a deep pyc recovery / a mixed product (an embedded native module is [[re-format-elf]])
- The [[re-triage]] base: the first-look input for packer identification

## Pitfalls

- **A pyc version mismatch fails decompilation immediately**: symptom — pycdc prints garbage or errors; cause — the magic version does not match the target; fix — do the magic identification in step 4 first, and pick the tool by version
- **A pyc header whose mtime/size is 0 is not corruption**: symptom — a tool opens a pyc extracted by PyInstaller and errors or shows a blank, and the unpack is suspected to have failed; cause — PyInstaller zeroes mtime/size when writing a PYZ (the marshal body is unaffected); fix — identify the version from magic, skip the 16-byte header, and `marshal.loads` to confirm the code object, or hand it to pycdc
- **A hash-based pyc (PEP 552)**: symptom — the flags field in the pyc header is non-zero (the low bit is 1), and mtime/size is a hash or a placeholder; cause — the builder compiled in hash-check mode; fix — identification looks only at magic and the low bit of flags. Decompilation is unaffected (the code object is still a standard marshal stream)
- **A PyArmor version difference makes the unpacker fail**: symptom — PyArmor-Unpacker reports that it is unsupported; cause — the PyArmor version is too new or too old; fix — switch methods by version, or locate the runtime's encrypt/decrypt logic by hand (switch to [[re-binary-core]])
- **Cython/Nuitka has no pyc**: symptom — no .pyc is found; cause — a compiled product; fix — analyze the product directly ([[re-format-elf]] / [[re-ghidra]]). Do not look for a pyc
- **Fake functions interfere with location**: symptom — after unpacking, the source is full of unreferenced wrapper functions; cause — PyArmor's confusion code; fix — filter by the call relation first (no caller means a candidate), then locate the core logic
- **strings cannot find packer features because they are hidden by encryption**: symptom — strings shows no PyInstaller feature, but the behavior is Python; cause — string encryption or a packer; fix — judge from behavior clues and the extension. When needed, watch the dynamic side ([[re-sandbox]])
- **An obfuscated sample as a whole is a three-piece set of "encrypted data + a bootstrap shell + a native decrypt component"**: symptom — statically there is only one bootstrap call and one encrypted byte-string constant, no normal pyc is found, and function bytecode stays ciphertext in memory for a long time; cause — the whole program is encrypted as a marshal stream and embedded as one byte-string constant into the bootstrap call. The decrypt key is derived from static data inside a native extension shipped with the sample (the key material and the recipe change with the build). A function is decrypted in place only just before it runs, and re-encrypted in place immediately after it returns, so the plaintext window is squeezed extremely short. The function constant table is also injected with native stub objects that handle enter / leave / integrity checks. The file only has marker strings left; the real objects can only be created at runtime; fix — split the sample into the three pieces and handle them separately. Per-function plaintext is either recovered by restoring the encrypt/decrypt flow statically, or captured inside the runtime decrypt window. Note that the decrypted function body is still ordinary CPython bytecode. There is no custom bytecode virtual machine — bytes that look like a VM are standard bytecode after encryption
- **Locate key material with "a salt anchor + a relative offset". Do not hard-code an absolute address**: symptom — on a sample from another build version, the old key-location script fails entirely; cause — the key is derived from a digest of several static pieces concatenated together (a typical concatenation includes a salt, an embedded public key, a hash of the signed-license description, and a masked region that must be restored first). The masked region is restored by XOR against a fixed-length region and a repeated-byte pad, and alignment padding in the file looks the same as a run of identical bytes. A all-zero candidate treated as the pad derives the wrong key. Inputs that join the concatenation are also controlled by a conditional branch (an external key file, a trial/full switch); fix — search the native extension's raw bytes for the visible salt-anchor string first, and compute every other piece of key material as a relative offset from that anchor. The same code can be reused across several builds. When finding the pad automatically, exclude an all-zero candidate. Decide which inputs are enabled from the flag bits. A static recovery does not have to make the startup integrity check pass (for example a public-key signature check). Reproducing the key-derivation input concatenation from the branch logic is enough
- **The decrypt product is a standard marshal stream, but rebuilding a CodeType has format quirks**: symptom — parsing the decrypted byte stream as an ordinary .pyc misaligns fields and scrambles constants, and on a few Python versions it crashes outright with an exception that cannot be caught; cause — the length declared for the constant tuple at serialization time may be smaller than the number of items actually written (the extra items follow with no header). The stream may also contain a private type-byte range, which stands for a native object that can only be created in memory at runtime (the body cannot be read statically; leaving the placeholder in shifts later constant indexes). Feeding ciphertext bytecode straight into a disassembler or a CodeType constructor crashes the interpreter on some versions; fix — build the CodeType with a one-shot template that is compiled and then `.replace()`'d, rather than calling the constructor directly (constructor argument order changes with the version). Pass the local-variable count explicitly. Represent native objects with a placeholder and remove them before construction. When one record fails to parse, keep the fields already read (bytecode and constants come first and are usually already in hand), and degrade the whole result to reporting the code objects that parsed completely rather than failing everything. A failed decrypt is replaced by template placeholder bytecode, and ciphertext is shown only as hex. From 3.11 the code-object layout changes. Read the target version from the blob header and switch automatically to a matching interpreter. Do not write a separate parse rule for every version
- **Taking plaintext dynamically must hit the window "after the entry stub decrypts", and the import style matters too**: symptom — a runtime hook captures no plaintext, or the callback crashes internally; cause — every call of a protected function goes through three steps: the entry stub decrypts, it runs, and the exit stub re-encrypts. The plaintext window is extremely short (a short function may leave immediately), so a read after the fact gets nothing. The entry stub is a Python-callable object on the outside (the shape of a builtin function object) and can be recognized from the module constant table. The real native function pointer is hidden in the metadata structure of the C function object and can be read through a memory-layout offset. On the first import, the callback triggering the same hook again nests and breaks the callback chain. Running it as __main__ takes another runtime path and bypasses the discovery mechanism; fix — intercept the call that runs after the module's first decrypt, and read the entry-stub pointer from the constants of the code object that was passed in. The first import returns a null pointer and stops, and a second round waits until the inline hook is in place. Later execution imports it as a named module. Locate the import slot by scanning the data section for the resolved real function-address pointer, not by scanning call sites (a call site references the slot address, and scanning it directly is easy to get wrong)
- **An obfuscator's internal format is not a documented compatible interface, and a conclusion must name the version**: symptom — the same recovery script fails on another version, and it is unclear which step broke; cause — the key-derivation inputs, the embedded marker position, the blob header, the per-function descriptor, the native entry, and the marshal rebuild behavior can all change with the version. The tool and the target interpreter version are also tightly bound (the code-object / marshal layout changes with the version); fix — every conclusion names the exact version. Reusing a tool across versions does not assume it works. Re-check each item on every new version (the key recipe, the marker position, the header structure, the descriptor, the entry function, the rebuild behavior). A branch that has not been checked on a real sample is marked unmeasured explicitly. Compare a static rebuild with a dynamic capture (the real runtime decrypt product) field by field — dynamic capture exposes a format error in the static inference (for example treating a native object as an ordinary constant, or a declared tuple length that is off), and static analysis fills the dead paths dynamic capture cannot reach (an uncalled function, an untaken branch). Shape differences such as trial/full and whether there is an external key file are handled from flag bits and branch logic. Do not assume a single shape

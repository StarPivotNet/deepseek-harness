# Python packaged-build layout: pyc / PyInstaller / PyArmor

The three products have different analysis entries: a `.pyc` is parsed directly as a header plus marshal; PyInstaller extracts pyc from the CArchive/PYZ first and then follows that path; PyArmor is a "shell pyc + native runtime" combination, and its structure is tightly bound to the version. Field values in this file are measured on this machine (Python 3.14.7 / PyInstaller 6.22.2). Version differences are marked separately.

## 1. pyc file layout

A pyc is a 16-byte header plus one marshal-serialized code object (unified on 3.7+; before 3.7 the header was 12 bytes).

### Header fields (16 bytes, 3.7+)

| Offset | Name | Length | Meaning |
|---|---|---|---|
| 0x00 | magic | 4 | `2b 0e 0d 0a` (measured on 3.14) or a little-endian u16 read (0x0e2b); the version decision |
| 0x04 | flags | 4 | 0 = a timestamp check; low bit 1 = hash-based (PEP 552; mtime/size are meaningless) |
| 0x08 | mtime | 4 | the source file's mtime; PyInstaller zeroes it when writing a PYZ (not corruption) |
| 0x0c | size | 4 | the source file's byte count; also zeroed by PyInstaller |
| 0x10 | code object | — | the marshal stream starts here |

### magic version table (little-endian u16)

| Value | Version | Value | Version |
|---|---|---|---|
| 0x0d33 | 3.6 | 0x0d6f | 3.10 |
| 0x0d42 | 3.7 | 0x0da7 | 3.11 |
| 0x0d55 | 3.8 | 0x0dcb | 3.12 |
| 0x0d61 | 3.9 | 0x0e2b | 3.14 (measured on this machine) |

3.13 and later: do not hard-code the number. Convert it on the target machine — `python3 -c "import importlib.util; print(hex(int.from_bytes(importlib.util.MAGIC_NUMBER[:2],'little')))"`.

### marshal code-object overview

- The marshal type byte of a code object is `0x63` ('c'). With the reference flag `FLAG_REF` (0x80) it is `0xe3` — a `py_compile` product's top level is `0xe3`, and an entry extracted by PyInstaller is `0x63`. Both are legal
- From 3.14 the marshal version is 5 (`marshal.version`), and the code object's internal field layout differs from older versions — a hand-written marshal parser must dispatch on the magic version. Do not assume field offsets
- The decompile fallback is always the matching version's official `marshal.loads` + `dis`, not a hand-written parser

## 2. PyInstaller layout

### Product shapes

```
onefile:  [bootloader(ELF/PE/Mach-O)] [CArchive 数据] [cookie]
onedir :  程序目录 = bootloader 可执行文件 + 同目录 _internal/（内含 PKG 归档或散文件 + PYZ + 依赖）
```

- Both shapes contain one PYZ (a module-bytecode archive) and one PKG/CArchive (the other resources)
- At runtime, onefile extracts the CArchive into a `_MEIxxxxxx` temporary directory and then runs (the `_MEI` feature in `strings` is this)

### CArchive cookie (the archive tail, 88 bytes, big-endian)

Format `!8sIIII64s` (measured `_COOKIE_FORMAT` in the PyInstaller 6.22.2 source):

| Offset | Name | Length | Meaning |
|---|---|---|---|
| 0x00 | MAGIC | 8 | `MEI\x0c\x0b\x0a\x0b\x0e` |
| 0x08 | archive_length | 4 | the archive's total length (= toc_offset + toc_len + 88) |
| 0x0c | toc_offset | 4 | the TOC start offset (relative to the archive start) |
| 0x10 | toc_length | 4 | the TOC's byte count |
| 0x14 | pyvers | 4 | `major*100+minor` (314 = Python 3.14, measured) |
| 0x18 | pylib_name | 64 | the Python dynamic-library name (`libpython3.14.so.1.0`, measured) |

Locate: scan the file for MAGIC and take the last hit (the cookie is at the end of the archive). Under onefile the bootloader precedes the archive. **Archive start = cookie position + 88 − archive_length** (the cookie itself is not inside the archive; forgetting the 88 shifts everything).

### CArchive TOC entries (variable length, aligned to 16)

An entry is an 18-byte header (`!IIIIBc`, big-endian) plus a UTF-8 name (including NUL). The whole entry is padded to 16 bytes:

| Offset | Name | Length | Meaning |
|---|---|---|---|
| 0x00 | entry_length | 4 | this entry's total length (including the name and the padding) |
| 0x04 | data_offset | 4 | the data offset relative to the archive start |
| 0x08 | compressed_length | 4 | the compressed length |
| 0x0c | data_length | 4 | the original length |
| 0x10 | compress | 1 | 0 = not compressed, 1 = zlib |
| 0x11 | typecode | 1 | measured: 'm' = an embedded bootstrap module (a zlib-compressed pyc), 's' = a script class (the entry / a startup hook), 'b' = binary data, 'z' = a PYZ-class entry (base_library.zip and PYZ.pyz) |
| 0x12 | name | variable | UTF-8 + a NUL terminator (the name has no extension). The entry is aligned to 16 |

### PYZ (the module-bytecode archive)

A 16-byte header + module data + a tail TOC (a marshal list):

| Offset | Name | Meaning |
|---|---|---|
| 0x00 | MAGIC | `PYZ\0` (4 bytes) |
| 0x04 | pyc magic | the same bytecode magic as a pyc (measured `2b 0e 0d 0a`) |
| 0x08 | toc_offset | a big-endian i32, the TOC offset relative to the PYZ start |
| 0x0c | reserved | 4 bytes |

- A module entry: `zlib.compress(marshal.dumps(code_object))` written in order, with no separate header
- TOC: a marshal-serialized list of `(name, (typecode, offset, length))`, at the tail of the file. typecode is a module (PYMODULE) / a package (PKG, `__init__`) / a namespace package (NSPKG, length 0)
- After pyinstxtractor-ng unpacks a PYZ, the result is a `PYZ.pyz_extracted/` directory. Each module rebuilds a 16-byte pyc header (mtime/size are 0)

### Unpack product layout (pyinstxtractor-ng, measured)

```
sample_app_extracted/
├── sample_app.pyc        # 入口脚本（code 对象从 0x10 开始）
├── PYZ.pyz               # 模块归档
├── PYZ.pyz_extracted/    # 解出的模块 pyc
├── python3.14/           # 版本目录
│   └── lib-dynload/      # 扩展模块 .so
├── base_library.zip      # 标准库 zip
└── lib*.so.1.0           # 运行时依赖
```

## 3. PyArmor layout (tightly bound to the version)

The PyArmor product shape changes with the version (the shell structure, key derivation, and the cipher have all changed). The following is the common skeleton. Check the details per version:

- A protected pyc is a "shell": the real bytecode is encrypted, and at runtime `pyarmor_runtime` (a native extension shipped with the sample) decrypts and runs it
- The product contains a large number of unreferenced wrapper functions (confusion code) that interfere with static analysis
- A common three-piece shape: encrypted data (a byte-string constant) + a bootstrap call + a native decrypt component. The per-function encrypt/decrypt window is extremely short (the entry stub decrypts, it runs, the exit stub re-encrypts)
- The unpack idea and the tools are in SKILL.md: pick one of the three PyArmor-Unpacker methods by version. A recovery conclusion must name the exact PyArmor version

## Lessons (internalized)

- Every parse reads magic and fixes the version first: the pyc header, the marshal format, and the pyvers in the PyInstaller cookie each decide their own version
- A PyInstaller archive offset is "relative to the archive start", not the file start (onefile has a bootloader in front). archive_length in the cookie is the conversion base
- TOC entries are variable length (the name is padded to 16 bytes). Step by entry_length. Do not scan at a fixed size
- A pyc header whose mtime/size is 0 is normal PyInstaller behavior, not a failed unpack

## Notes

- Static unpacking and decompilation skip the sandbox. Taking plaintext dynamically ([[re-sandbox]]) follows the top rule
- Use together with [[re-managed]] (the gateway this skill belongs to), [[re-triage]] (the first-look input), and [[re-script-deob]] (pure script obfuscation)
- A Cython/Nuitka product has no pyc. Analyze the native directly with [[re-format-elf]] / [[re-ghidra]]

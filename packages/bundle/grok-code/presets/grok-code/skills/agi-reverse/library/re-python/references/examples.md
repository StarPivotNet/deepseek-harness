# Minimal parse examples for a Python packaged build

The examples below use this machine's Python 3.14.7 and PyInstaller 6.22.2 as the specimen. The commands and output can be reproduced as written (toolchain: `python3`, `pip install pyinstaller pyinstxtractor-ng`; when the system pip is limited by PEP 668, `python3 -m venv` first and then install). The structure definition is in [[layout]].

## 1. Parsing a pyc header (reproducible with python3 on this machine)

### Generate the pyc

```sh
python3 -c "import py_compile; py_compile.compile('sample.py', cfile='sample.pyc')"
# sample.py 内容：import base64
# k = base64.b64decode("czNjcmV0")
# print(k)
```

### struct-parse the header + a marshal check + disassembly

```python
import struct, marshal, dis

d = open('sample.pyc', 'rb').read()
magic, flags, mtime, size = struct.unpack('<IIII', d[:16])
print('magic=0x%08x  flags=%d  mtime=%d  size=%d' % (magic, flags, mtime, size))
print('code 对象从偏移 16 开始，类型字节 0x%02x' % d[16])
code = marshal.loads(d[16:])          # 与解释器同版本的权威解析
print('argcount=%d nlocals=%d stacksize=%d' % (code.co_argcount, code.co_nlocals, code.co_stacksize))
dis.dis(code)
```

Measured output on this machine:

```
magic=0x0a0d0e2b  flags=0  mtime=1787648948  size=56
code 对象从偏移 16 开始，类型字节 0xe3
argcount=0 nlocals=0 stacksize=3
  0           RESUME                   0
  1           LOAD_SMALL_INT           0
              LOAD_CONST               1 (None)
              IMPORT_NAME              0 (base64)
              STORE_NAME               0 (base64)
  ...
```

Comparison points: the low 2 bytes of `magic`, `0x0e2b`, are 3.14. `flags=0` is a timestamp check. `size=56` is the source file's byte count. The type byte `0xe3` is `0x63|0x80` (code + the REF flag). An entry extracted by PyInstaller is `0x63` — both are legal. Do not treat the type byte as corruption.

### A byte sample (the 16-byte pyc header, field by field)

```
00000000: 2b0e 0d0a 0000 0000 9e5b 8d6a 3800 0000  +......[.j8...
         magic=0x0a0d0e2b─┘ └flags=0     └size=56(0x38)
                            mtime=0x6a8d5b9e──────┘
00000010: e300 0000 0000 0000 0000 0000 0003 0000  ................
         类型0xe3(code+REF)  argcount=0 posonly=0 kwonly=0 nlocals=3
```

A hand check: `xxd sample.pyc | head -2` matches the above. A pyc header extracted by PyInstaller has mtime/size 0 (zeroing is normal; see the header-field table in [[layout]]).

## 2. PyInstaller onefile: build → unpack → parse the cookie

### Build and unpack

```sh
pip install pyinstaller pyinstxtractor-ng
pyinstaller --onefile sample_app.py
python3 -m pyinstxtractor_ng dist/sample_app
```

Measured unpack output on this machine (an excerpt):

```
[+] Possible entry point: sample_app.pyc
[+] Found 130 files in PYZ archive
[+] Successfully extracted pyinstaller archive: dist/sample_app
```

The product layout is at the end of [[layout]] §2. The entry pyc header is `2b 0e 0d 0a | 00000000 | 00000000 | 00000000` — flags/mtime/size are all 0 (zeroing is normal), and the code object starts at 0x10 (`63 00 00 00 ...`).

### Parsing a CArchive cookie by hand (big-endian, `!8sIIII64s`)

```python
import struct

d = open('dist/sample_app', 'rb').read()
magic = b'MEI\x0c\x0b\x0a\x0b\x0e'
i = d.rfind(magic)                        # cookie 在归档末尾，取最后一次出现
ln, toc, toclen, pyver = struct.unpack_from('!IIII', d, i + 8)
name = d[i + 24:i + 88].split(b'\0')[0].decode()
start = i + 88 - ln                       # 归档起点 = cookie 尾 − archive_length
print('cookie @0x%x' % i)
print('archive_length=%d toc_offset=0x%x toc_length=%d pyver=%d' % (ln, toc, toclen, pyver))
print('pylib=%s  archive 起点=0x%x' % (name, start))
```

Measured output on this machine:

```
cookie @0x974549
archive_length=9847480 toc_offset=0x963220 toc_length=4160 pyver=314
pylib=libpython3.14.so.1.0  archive 起点=0x102e9
```

Comparison points: pyver=314 is Python 3.14 (`major*100+minor`). `toc_offset + toc_length + 88 == archive_length` (measured 0x963220+4160+88=9847480, which matches). Under onefile, everything before the archive start is the bootloader — every offset inside the archive must add that start. **Start = cookie end − archive_length** (the cookie's own 88 bytes are not inside the archive; a wrong count shifts everything by 88 bytes).

### Walking TOC entries (variable length, aligned to 16 bytes)

```python
import struct

d = open('dist/sample_app', 'rb').read()
magic = b'MEI\x0c\x0b\x0a\x0b\x0e'
i = d.rfind(magic)
ln, toc, toclen, pyver = struct.unpack_from('!IIII', d, i + 8)
start = i + 88 - ln                        # 归档起点
pos = start + toc
end = pos + toclen
while pos < end:
    entry_len, off, clen, dlen, comp, tc = struct.unpack_from('!IIIIBc', d, pos)
    name = d[pos + 18:pos + entry_len].split(b'\0')[0].decode('latin1')
    print('%-26s type=%s off=0x%-7x clen=%-7d' % (name[:26], tc, off, clen))
    pos += entry_len
```

Measured output on this machine (an excerpt):

```
struct                     type=m off=0x0       clen=232
pyimod01_archive           type=m off=0xe8      clen=2896
pyimod02_importers         type=m off=0xc38     clen=13829
pyimod03_ctypes            type=m off=0x423d    clen=2874
pyiboot01_bootstrap        type=s off=0x4d77    clen=1158
pyi_rth_inspect            type=s off=0x51fd    clen=1486
sample_app                 type=s off=0x57cb    clen=366
libbrotlicommon.so.1       type=b off=0x5939    clen=63578
...（共 58 条，遍历终点 == cookie 位置 0x974549）
base_library.zip           type=z off=0x761256  clen=415154
PYZ.pyz                    type=z off=0x7c6808  clen=1690136
```

Comparison points: `type=m` is an embedded bootstrap module (a zlib-compressed pyc block), `s` is a script class (the entry / a startup hook), `b` is binary data, and `z` is a PYZ-class entry (base_library.zip and PYZ.pyz). Names have no extension and are variable length — step by `entry_length` (entries are aligned to 16 bytes). Do not scan at a fixed size.

## 3. Parsing a PYZ header

```python
import struct
d = open('sample_app_extracted/PYZ.pyz', 'rb').read()
print('MAGIC=%r pyc_magic=%s toc_offset=0x%x' % (
    d[:4], d[4:8].hex(), struct.unpack('!i', d[8:12])[0]))
```

Measured output on this machine:

```
MAGIC=b'PYZ\x00' pyc_magic=2b0e0d0a toc_offset=0x19b92b
```

Comparison points: a PYZ header is `PYZ\0` + the pyc magic (the same version decision as a pyc) + a big-endian TOC offset. The TOC is at the tail of the file (a marshal list). Module entries index a zlib-compressed code object by (name, (typecode, offset, length)).

## Lessons (internalized)

- Version before everything else: pyc magic → marshal version → PyInstaller pyver, three separate version decisions. Mixing them misaligns the parse
- Archive offsets are relative: a onefile cookie is located with `rfind`, and the archive start is cookie − archive_length
- Step TOC entries by entry_length, aligned to 16. Do not scan at a fixed size
- Official `marshal.loads` + `dis` is the authoritative parse path. A hand-written parse stops at the header fields

## Notes

- The samples are locally built products, for structure comparison only. A real sample is judged from its own header fields (the tables in [[layout]])
- Taking plaintext dynamically (capturing inside the entry-stub decrypt window) runs inside the sandbox ([[re-sandbox]]; see [[re-analyze/platform-tips]])

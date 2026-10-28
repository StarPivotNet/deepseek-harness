# DRM minimal parse examples

Examples are built around the smallest sample that can be reproduced on this machine: PSSH is constructed and parsed in Python (ISO/IEC 23001-7 fields); Widevine protobuf uses the official test vectors and the same field numbers as pywidevine (see [[layout]]). No example involves real key material.

## 1. PSSH box parse (Python, runs directly on this machine)

```python
import struct

# 构造一个 Widevine PSSH v0（Widevine SystemID + 初始数据）
WIDEVINE_SYSTEM_ID = bytes.fromhex('edef8ba979d64acea3c827dcd51d21ed')

def build_pssh(system_id, data, version=0, key_ids=()):
    body = bytes([version, 0, 0, 0]) + system_id
    if version == 1:
        body += struct.pack('>I', len(key_ids))
        for kid in key_ids:
            body += kid
    body += struct.pack('>I', len(data)) + data
    return struct.pack('>I', 8 + len(body)) + b'pssh' + body

def parse_pssh(buf):
    assert buf[4:8] == b'pssh', 'not a pssh box'
    size, = struct.unpack_from('>I', buf, 0)
    version = buf[8]
    sysid = buf[12:28].hex()
    off = 28
    kids = []
    if version == 1:
        n, = struct.unpack_from('>I', buf, off); off += 4
        kids = [buf[off + 16*i : off + 16*(i+1)].hex() for i in range(n)]
        off += 16 * n
    dsize, = struct.unpack_from('>I', buf, off); off += 4
    data = buf[off : off + dsize]
    return dict(size=size, version=version, system_id=sysid,
                key_ids=kids, data_len=dsize, data=data)

pssh = build_pssh(WIDEVINE_SYSTEM_ID, b'\x08\x10\x12\x04test')
print(parse_pssh(pssh))
# {'size': 40, 'version': 0, 'system_id': 'edef8ba979d64acea3c827dcd51d21ed',
#  'key_ids': [], 'data_len': 8, 'data': b'\x08\x10\x12\x04test'}
# size = 8(头) + 4(version/flags) + 16(SystemID) + 4(DataSize) + 8(Data) = 40 ✓
```

Comparison points: the v0 layout is size + pssh + version/flags + SystemID + DataSize + Data; SystemID identifies the DRM type (the comparison table is in [[layout]]); a v1 KID list is inserted between SystemID and DataSize — parsing must read version first (pitfall 5).

## 2. Find PSSH in real media (commands)

```sh
# 简易定位（box 链遍历更可靠，见上）
grep -oba 'pssh' sample.mp4 | head -5
# 结构化解析用 ffprobe（ffmpeg 自带）
ffprobe -v error -show_entries stream_tags=variant_bitrate -of json sample.mp4
# 或 mp4dump（bento4）：输出所有 box 树
mp4dump sample.mp4 | grep -A4 pssh
```

## 3. Widevine challenge/response structure quick reference (field-number comparison)

Verify the parse against the same protobuf field numbers as pywidevine (the full table is in [[layout]]):

```python
# 依赖: pip install protobuf
# 用 grpcio-tools 从 Widevine 协议 .proto 生成后：
# 外层 SignedMessage: msg.type 判定层（0=license request 1=license 2=error）
# 内层 LicenseRequest: client_id(1) content_id(2) type(3) request_time(4)
#                     protocol_version(6) key_control_nonce(7)
def peek_proto(data, fields):
    """极简 protobuf 字段窥探（varint 场景）：打每字段的 字段号/类型/值头"""
    out = []
    i = 0
    while i < len(data):
        tag = data[i]; i += 1
        fno, wtype = tag >> 3, tag & 7
        if wtype == 0:                      # varint
            val = 0; sh = 0
            while True:
                b = data[i]; i += 1
                val |= (b & 0x7f) << sh
                if not b & 0x80: break
                sh += 7
            out.append((fno, 'varint', val))
        elif wtype == 2:                    # length-delimited
            ln = data[i]; i += 1
            out.append((fno, 'bytes', ln, data[i:i+ln]))
            i += ln
        else:
            break
    return out

# 用例：构造的 WidevineCencHeader 初始数据（见 [[layout]] WidevinePsshData 字段）
```

Comparison points: the outer SignedMessage `type` decides the inner schema — parsing a response directly as a LicenseRequest must be wrong (pitfall 6).

## 4. PlayReady header / challenge XML comparison

```xml
<!-- 内容元数据里的 WRMHEADER（PlayReadyHeader 命名空间） -->
<WRMHEADER xmlns="http://schemas.microsoft.com/DRM/2007/03/PlayReadyHeader" version="4.0.0.0">
  <DATA>
    <PROTECTINFO><KEYLEN>16</KEYLEN><ALGID>AESCTR</ALGID></PROTECTINFO>
    <KID>Cofu3FaCfjuAJNqKod80iw==</KID>      <!-- KID GUID（小端 base64） -->
    <CHECKSUM>2u+jpp0wDIk=</CHECKSUM>
    <LA_URL>https://lic.example/rightsmanager.asmx</LA_URL>
  </DATA>
</WRMHEADER>

<!-- 许可证挑战（SOAP，protocols 命名空间） -->
<AcquireLicense xmlns="http://schemas.microsoft.com/DRM/2007/03/protocols">
  <challenge><Challenge xmlns="http://schemas.microsoft.com/DRM/2007/03/protocols/messages">
    <LA xmlns="http://schemas.microsoft.com/DRM/2007/03/protocols" Id="SignedData">
      <Version>1</Version><ContentHeader><!-- 内嵌 WRMHEADER --></ContentHeader>
    </LA>
  </Challenge></challenge>
</AcquireLicense>
```

Comparison points: KID is a public identifier (there is a follow-up only if it matches the license URL); CHECKSUM prevents a KID/key mismatch — after you get a "key", check it against this before concluding (pitfall 2).

## 5. Verify the CDM export table (Ghidra/readelf)

```sh
# 自有环境 Widevine CDM（路径见 SKILL.md 步骤 1）
readelf -d libwidevinecdm.so | grep NEEDED          # 依赖链（沙箱环境核对）
readelf -s libwidevinecdm.so | grep -E 'Initialize|CreateSession|UpdateSession|Decrypt'
# 导出函数是静态分析入口：交叉引用到密钥加载/解密路径
```

## Lessons internalized

- Layered modeling first (device key → CEK → media); for any "key", first ask which layer it belongs to and what it unwraps
- Read version first when parsing PSSH; unwrap SignedMessage first on a Widevine message, then pick the schema by type
- A version anchor (CDM version + sha256 + analysis time) is the premise of every conclusion

## Usage notes

- Every step stays inside the authorized scope and a controlled environment ([[re-analyze/platform-tips]] highest principle); key material does not enter the report
- Use together with [[re-protocol]], [[re-crypto-id]], and [[re-netcap]]; the examples in this file contain no real key material

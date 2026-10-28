# DRM layout: key layering / CENC-PSSH / Widevine protobuf / PlayReady SOAP

Three structural layers of DRM analysis: the media side (PSSH and encryption scheme), the protocol side (license challenge/response format), and the device side (CDM exports and the key chain). This file gives the key field tables for the three layers. Fields follow ISO/IEC 23001-7, the Widevine protobuf (same source as pywidevine), and the official PlayReady specification.

## Key-layering model (build the layers before touching anything)

```
device key (L3 software key inside the CDM / persistent storage; L1 is in the TEE)
  │ decrypts the license response (CEK ciphertext + rights policy)
  ▼
content key (CEK)
  │ AES-CBC/CTR decrypts media samples (cenc/cbc1/cbcs)
  ▼
plaintext media
```

- For each layer, answer "where it comes from, what it unwraps": the device key unwraps the license, the CEK unwraps the media — using an intermediate layer to unwrap media must fail (pitfall 2)
- A CEK usually also has rights-policy constraints (output protection such as HDCP) and a short lifetime (key rotation)

## CENC PSSH box (ISO/IEC 23001-7, big-endian)

```
offset  field              notes
0x00    size (u32)         whole box size in bytes (including itself)
0x04    'pssh' (u32)       type (0x70 73 73 68)
0x08    version (1B) + flags (3B)   version 0 / 1
0x0C    SystemID (16B)     DRM system UUID
[when version=1] KID count (u32) + KIDs (16B×N)
0x?     DataSize (u32)     init-data length
0x?     Data               DRM-specific init data (Widevine is a WidevineCencHeader protobuf)
```

### SystemID table

| DRM | SystemID |
|---|---|
| Widevine | `edef8ba9-79d6-4ace-a3c8-27dcd51d21ed` |
| PlayReady | `9a04f079-9840-4286-ab92-e65be0885f95` |
| FairPlay | `94ce86fb-07ff-4f43-adb8-93d2fa968ca2` |
| Common (v1) | `1077efec-c0b2-4d02-ace3-3c1e52e2fb4b` |

- EME keySystem strings: `com.widevine.alpha` / `com.microsoft.playready` / `com.apple.fairplay`
- DASH equivalent: `ContentProtection schemeIdUri="urn:uuid:EDEF8BA9-..."` + base64 `<cenc:pssh>`
- Media encryption schemes: cenc (AES-CTR) / cbc1 (AES-CBC) / cbcs (pattern, sample-level encryption) — decides the decrypt-analysis direction

## Widevine messages (protobuf)

Every client-server message's outer layer is a SignedMessage; the inner schema is selected by type.

### SignedMessage (outer)

| Field no. | Name | Notes |
|---|---|---|
| 1 | type | 0=license request 1=license 2=error |
| 2 | msg | inner serialized message (parsed by type) |
| 3 | signature | signature (derived from session key / device key) |
| 4 | session_key | session key (RSA-OAEP wrapped) |
| 5 | remote_attestation | remote attestation |

### LicenseRequest (inner when type=0)

| Field no. | Name | Notes |
|---|---|---|
| 1 | client_id | ClientIdentification (device certificate / fingerprint) |
| 2 | content_id | ContentIdentification (oneof) |
| 3 | type | 1=NEW 2=RENEWAL 3=RELEASE (a first fetch is always NEW) |
| 4 | request_time | Unix seconds (client clock) |
| 6 | protocol_version | always CURRENT (protocol version 21) |
| 7 | key_control_nonce | u32 random (31 bits); participates in CMAC key derivation |
| 8 | encrypted_client_id | privacy mode (AES-CBC-encrypted ClientIdentification) |

### ClientIdentification

- 1=token (TOKEN_TYPE_KEYBOX or DEVICE_CERTIFICATE), 2=client_info (name/value pairs), 3=provider_info, 4=supported_protocols (includes 3=SRM and similar), 5=key_control_nonces (legacy)

### ContentIdentification (oneof content_id_variant)

| Variant no. | Name | Notes |
|---|---|---|
| 1 | widevine_pssh_data | WidevinePsshData: pssh_data, key_ids, content_id, protection_scheme, crypto_period_* |
| 2 | webm_key_id | WebM (header + license_type) |
| 3 | existing_license | renewal/release (refers to an existing license) |
| 4 | init_data | raw init data (privacy / non-standard PSSH) |

### License (inner when type=1)

- 1=license_identification (request_id + session_id), 2=content_key_info[] (each: 1=key_id, 2=key_type (SW_SECURE_CRYPTO/SW_SECURE_DECODE/HW_SECURE_CRYPTO/HW_SECURE_DECODE/HW_SECURE_ALL), 3=key (CEK ciphertext), 4=permissions), 3=certificate, 4=protection_scheme
- key_type level corresponds to the security level (L1/L3) — device-side capability decides which key can be obtained

## PlayReady license (SOAP/XML)

- Three namespaces: header `http://schemas.microsoft.com/DRM/2007/03/PlayReadyHeader`; protocol operations `http://schemas.microsoft.com/DRM/2007/03/protocols` (`AcquireLicense`/`LicenseResponse`); message wrapper `.../protocols/messages`
- Challenge: `AcquireLicense` → `challenge` → `LA` (SignedData, Version=1 + ContentHeader embedding WRMHEADER)
- Response: `Response` → `LicenseResponse` → encrypted `License` blob (base64)

### WRMHEADER (PlayReady header, version attribute 4.0.0.0+)

```xml
<WRMHEADER xmlns="http://schemas.microsoft.com/DRM/2007/03/PlayReadyHeader" version="4.0.0.0">
  <DATA>
    <PROTECTINFO><KEYLEN>16</KEYLEN><ALGID>AESCTR</ALGID></PROTECTINFO>
    <KID>base64-KID</KID>              <!-- 4.1+ 为 VALUE/ALGID/CHECKSUM 属性形式 -->
    <CHECKSUM>base64-checksum</CHECKSUM>
    <LA_URL>https://.../rightsmanager.asmx</LA_URL>
  </DATA>
</WRMHEADER>
```

- KID is a public key-identifier GUID (little-endian byte order, base64); CHECKSUM prevents a KID/key mismatch
- The server looks up / derives the content key by KID (key seed + KID derivation algorithm)
- FairPlay (Apple side): SPC (Server Playback Context, device certificate + session) → CKC (Content Key Context, containing CEK ciphertext) — extended by the [[re-ios]] domain

## CDM exports (libwidevinecdm.so, C ABI)

| Export | Role |
|---|---|
| Initialize | initialize a CDM instance (flags such as allow_distinctive_identifier / allow_persistent_state) |
| CreateSession | create a session (session_type + init_data_type + init_data) and produce a challenge |
| UpdateSession | feed the license response (the license message returned by the server) |
| CloseSession / RemoveSession | close a session / delete a persistent session |
| Decrypt | decrypt a sample (InputBuffer → plaintext; returns kNoKey if there is no key) |
| SetServerCertificate | set the server certificate (privacy mode / session-key wrapping) |

- Static-analysis entry: exports → cross-references into the key-load / decrypt path
- The interface carries a version (ContentDecryptionModule_7/8/11); the same export name behaves differently across versions

## Version-difference points

- PSSH version 0 (old) vs 1 (new, with a KID list) — read version first when parsing
- Widevine protocol version CURRENT=21 (field numbers are stable, but a server may reject an old protocol)
- PlayReady WRMHEADER: the 4.0 KID element → the 4.1+ VALUE/ALGID/CHECKSUM attribute form
- The CDM updates quarterly: analysis methods reuse across versions; keys/offsets/signatures do not

## Usage notes

- Every dynamic step is inside a controlled environment ([[re-analyze/platform-tips]] highest principle); key material does not enter the report
- Use together with [[re-protocol]] (protocol structure), [[re-crypto-id]] (algorithm identification), and [[re-netcap]] (capture)

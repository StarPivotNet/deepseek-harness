---
name: re-drm
description: >
  DRM analysis: PlayReady/Widevine implementations, license flow, and decryptor recovery.
  Triggers: DRM, PlayReady, Widevine, `许可证`, `内容保护`
capabilities: [drm-analysis]
---

# DRM analysis (PlayReady / Widevine / license flow)

## When to use / when not to use

- **Boundary (inherited from [[re-cracking]])**: limited to your own content-protection scheme / authorized testing / a CTF or research environment; unauthorized content decryption and commercial DRM bypass are forbidden
- Use: analyze the component structure and license challenge/response flow of a DRM system (Widevine / PlayReady / FairPlay)
- Use: understand how a player/CDM (content decryption module) manages keys and decrypts content (authorized research)
- Use: DRM vulnerability/weakness research (key extraction, decrypt-flow bypass, and similar, **authorized environment only**) with responsible disclosure
- Use: identify PSSH and the encryption scheme of CENC-encrypted media (MP4/CMAF)
- Do not use: ordinary content-protection understanding / protocol reversing (that is the [[re-protocol]] domain)
- Do not use: the sample has no DRM and is only ordinary encryption (the [[re-crypto-*]] series)
- Do not use: building a piracy tool / extracting keys for piracy distribution (**explicitly forbidden; see the authorization boundary**)
- **Authorization boundary (required reading)**: this skill is limited to authorized research — your own device, your own content, a lab environment, or security research with written permission. Forbidden: extracting/distributing content keys for piracy, publishing a usable key-extraction tool, bypassing DRM to obtain unauthorized content. DRM analysis touches anti-circumvention law (such as DMCA 1201 class) and platform ToS; analysis is produced from a vulnerability-research + defense view; findings go through responsible disclosure (vendor security team / bug-bounty program); sensitive details (key material) are not written into a public report.

## Tool setup

Static analysis (CDM decompilation / capture analysis) skips the sandbox; running a CDM and capturing license traffic is dynamic execution and happens inside a controlled environment ([[re-analyze/platform-tips]] highest principle). Verify every tool before use.

### Decompiler workbench ([[re-ghidra]]) — CDM/decryptor analysis

- [[re-ghidra]] (default): import the CDM binary (the Widevine CDM is an ELF so with an export table) and the player binary
- [[re-ida]]: alternative; verify: after importing libwidevinecdm.so you can decompile exports such as `Initialize`/`CreateSession`
- Obtaining the CDM (your own environment): Chrome's Widevine CDM is at `~/.config/google-chrome/WidevineCdm/` (Linux) / `%LOCALAPPDATA%\Google\Chrome\User Data\WidevineCdm` (Windows) / `~/Library/...` (macOS); Edge's PlayReady is analogous

### Network capture ([[re-netcap]]) — license challenge/response

- tshark/wireshark/mitmproxy install is in [[re-netcap]] "Tool setup"
- Verify: `tshark --version`; `mitmdump --version`
- HTTPS decryption follows [[re-netcap]] step 4 (install the mitmproxy CA into the controlled environment)

### protobuf parsing (Widevine side)

- `pip install protobuf` (or grpcio-tools); verify: `python3 -c "import google.protobuf; print(google.protobuf.__version__)"`
- Use: the license challenge/response is protobuf; parse by field number (field table in [[layout]])

### CDM analysis helper tools (Widevine L3 device, research use)

- No standalone distro package: analysis tools for the Widevine L3 CDM (software implementation) come from community research (search GitHub for Widevine L3 research repos, such as pywidevine); install `pip install pywidevine` (only for authorized research on your own device)
- Verify: `python3 -c "import pywidevine; print(pywidevine.__version__)"`
- Use and boundary: analyze only your own device / your own content; key material does not appear in the report (see pitfall 3)

## Procedure

Run in order. Record an evidence path + sha256 for each step's products (component inventory, license-flow notes, CDM structure notes) (see [[re-triage]]), for the report. **Every step stays inside the authorized scope and a controlled environment** (authorization boundary is in "When to use").

1. **Identify DRM components (CDM / decryptor)**:
   - Player/browser side: EME API (`requestMediaKeySystemAccess("com.widevine.alpha")` / `"com.microsoft.playready"`) → locate the DRM type and CDM path
   - CDM components: `libwidevinecdm.so` (built into Chrome; **the suffix marks the architecture** — `-arm`/`-arm64`/`-x86`/`-x64` are CPU architectures, not security levels; L1/L3 depends on the device TEE root of trust; an ARM device with no TEE also runs the L3 software implementation; see pitfall 1); PlayReady components are in Edge/Windows system components; FairPlay is on the Apple side (the [[re-ios]] domain)
   - CDM exports (C ABI): `Initialize`, `CreateSession` (CreateSessionAndGenerateRequest), `UpdateSession` (handles the license response), `CloseSession`, `RemoveSession`, `Decrypt`, `SetServerCertificate` — the export table is in [[layout]]
   - Record: DRM type, CDM path and version, file sha256 (version anchor, pitfall 4)

2. **Identify CENC/PSSH (media side)**:
    ```sh
    # 在 MP4/CMAF 里找 pssh box（可脚本遍历 ISO BMFF box 链）
    grep -oba 'pssh' sample.mp4 | head
    ```
   - PSSH box: `size(4) + 'pssh'(4) + version/flags(4) + SystemID(16) + [v1 only: KID count+KIDs] + DataSize(4) + Data` (field table in [[layout]])
   - SystemID identifies the DRM: Widevine `edef8ba9-79d6-4ace-a3c8-27dcd51d21ed`; PlayReady `9a04f079-9840-4286-ab92-e65be0885f95`; FairPlay `94ce86fb-07ff-4f43-adb8-93d2fa968ca2`
   - DASH-side equivalent: `ContentProtection schemeIdUri="urn:uuid:EDEF8BA9-..."` + base64 `<cenc:pssh>`; the encryption-scheme field (cenc/cbc1/cbcs) decides the later decrypt-analysis direction
   - Product: a PSSH list (SystemID → DRM type → init data); a Python parse example is in [[examples]]

3. **Recover the license flow (challenge / response)**:
    ```sh
    # 受控环境内播放一段自有内容，mitmproxy/tshark 捕获许可证请求
    tshark -r license.pcap -Y 'http.request' -T fields -e http.host -e http.request.uri | head
    # 典型流程：初始化 → license challenge（POST，含设备指纹/证书）→ license response（含密钥材料）
    ```
   - Widevine: the license request/response is protobuf (wrapped in SignedMessage; field table in [[layout]]); PlayReady: SOAP/XML (`AcquireLicense`, namespace `http://schemas.microsoft.com/DRM/2007/03/protocols`); content metadata usually carries the license URL (PSSH box / manifest field)
   - Recover: what is in the challenge (device certificate / asymmetric-key public key / session ID) → how the server verifies the device → what the response encapsulates (ciphertext of the content key CEK + rights policy)
   - Product: a license flow diagram (initiator → challenge → response → key unwrapped) + format and field notes for each step

4. **Analyze the decryptor implementation (key management)**:
   - CDM static ([[re-ghidra]]): recover exports (`Initialize`, `CreateSession`, `UpdateSession` (handles the license response), `Decrypt`) → find key storage and the decrypt path
   - Key layering (see pitfall 2): device key (L3 software key stored inside the CDM / persistent storage) → decrypt the license response to get the content key (CEK) → the CEK decrypts the media; analyze "which step unwraps which key"
   - Identify the decrypt algorithm: AES-CBC / AES-CTR and similar (the [[re-crypto-id]] constant-table fingerprint approach), CENC (Common Encryption) sample schemes (cenc/cbc1/cbcs)
   - Product: a key-chain diagram (source and protection of each key layer) + the decrypt call path

5. **Locate vulnerabilities / weaknesses (authorized research)**:
   - Common research surfaces: L3 device-key extraction (a software key extracted from CDM memory / persistent storage), missing license-response verification, anti-rollback (CDM version check) bypass, missing integrity check before decrypt
   - Method: static location (key decrypt/load functions) → dynamic observation (breakpoints/instrumentation inside a controlled environment to watch key-material flow) → verify the boundary (under what conditions what can be unwrapped)
   - **Responsible disclosure after a finding**: record reproduction conditions and impact assessment, and submit to the vendor security team / bug-bounty program; do not publish PoC details
   - Product: a findings list (conditions / impact / disclosure status)

6. **Report (compliance)**:
   - Report structure: authorization-scope statement → component inventory (CDM version/hash) → license flow diagram → decryptor/key-management structure → findings and disclosure plan → defense recommendations
   - Compliance points: do not include key material or a usable extraction tool; state the ToS/legal boundary (DMCA 1201 class anti-circumvention clauses); phrase conclusions from a vulnerability-research / defense view
   - Product: archived report (sha256)

## Cross-domain joins

- [[re-ghidra]]: CDM and player decompiler workbench (structure annotation / scripted analysis)
- [[re-netcap]]: license challenge/response capture (mitmproxy decrypts HTTPS; joins [[re-protocol]] step 1)
- [[re-protocol]]: license-protocol recovery (challenge/response structure, protobuf/SOAP parsing)
- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]: algorithm identification, key-material location, ciphertext recovery
- [[re-android-native]] / [[re-ios]]: mobile CDM (Widevine integration on Android, FairPlay/Apple side) — the device-side extension of DRM
- [[re-sandbox]] / [[re-analyze/platform-tips]]: dynamic execution (play your own content / capture) follows the controlled-environment highest principle

## Common pitfalls

- **L1/L3 level difference (hardware vs software)**: Symptom — the same Widevine CDM-related sample has a key structure/flow that can be analyzed on device A and does not line up at all on device B, or analyzing an L1 target with an L3 approach hits a wall everywhere; cause — security levels differ: an L1 key is protected in TEE (trusted execution environment) hardware, while L3 is a pure-software CDM that can be extracted and analyzed; architecture mark: the suffix on `libwidevinecdm.so` marks the **architecture** (`-arm`/`-arm64`/`-x86`/`-x64`), not the security level — L1/L3 depends on the device TEE root of trust (only an ARM device with a TEE is L1; an ARM device with no TEE also runs L3; x86 platforms generally have only L3); PlayReady likewise splits hardware root of trust from a software implementation; fix — confirm the target security level first (device capability / vendor docs); only L3 supports software-layer key-extraction analysis; L1 analysis goes toward the TEE / root of trust (hardware security); annotate the level strictly on the conclusion, and do not apply one level's results to another
- **Key layering (device / content)**: Symptom — you worked hard to get a "key", and using it to decrypt media content fails; cause — DRM is a layered key system: the device key decrypts the license response → yields the content key (CEK), and only the CEK decrypts the media; what you got is some intermediate layer, or the CEK is still constrained by a rights policy (output protection and similar); fix — fully recover the license flow first (step 3: device public key/certificate in the challenge, CEK ciphertext in the response), then enter decryptor analysis (step 4) and confirm for each layer "where it comes from, what it unwraps"; check the key-chain diagram for which layer the key you hold belongs to, and fill in any missing layer
- **Legal and ToS boundary (research only)**: Symptom — research products (extraction scripts, key material) are used for piracy distribution, and the researcher bears legal consequences (DMCA 1201 class anti-circumvention liability, platform ToS breach); cause — DRM analysis products are naturally usable as piracy tools, and key extraction and bypass may directly violate anti-circumvention law; fix — strictly limit to your own device / your own content / a lab with written authorization; the report writes only "how the mechanism works" and "how to defend", not reproducible key-extraction steps, and attaches no key material; findings go through responsible disclosure (vendor bug bounty); if a boundary is unclear, check the authorization document before acting
- **DRM updates often (conclusions expire)**: Symptom — after a CDM update every extraction/analysis method fails, and old conclusions are void after key rotation; cause — the CDM updates on a schedule, rotates keys, and hardens anti-extraction (packing/obfuscation/short in-memory key lifetime); fix — record the exact CDM version + file sha256 + analysis time (step 1); analysis methods (flow recovery, structure analysis, layered modeling) reuse across versions; concrete keys/offsets/signatures do not; organize analysis conclusions as "structure/flow", not "some key value"
- **PSSH versions mixed**: Symptom — parsing a v1 PSSH with the v0 layout shifts every field; cause — when the version field is 1, the KID list is inserted between SystemID and DataSize; fix — read version first when parsing (byte 8); for v1, skip the 4+N×16-byte KID region before reading DataSize ([[layout]] field table)
- **Both challenge and response are wrapped in SignedMessage**: Symptom — parsing the response directly as a LicenseRequest fails; cause — every Widevine message's outer layer is a SignedMessage (the type field distinguishes: 0=license request, 1=license, 2=error), and the inner message picks a protobuf by type; fix — unwrap the outer SignedMessage and look at type first, then pick the inner schema by type ([[layout]] field table)

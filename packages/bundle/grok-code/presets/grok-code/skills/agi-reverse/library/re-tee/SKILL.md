---
name: re-tee
description: >
  TEE/TrustZone reverse engineering: OP-TEE architecture, Trusted Applications, secure storage, the SMC interface, and device keys.
  Triggers: TEE, TrustZone, OP-TEE, `可信应用`, Trusted App, secure world, SMC, `安全存储`, secure storage, `设备密钥`
capabilities: [tee-analysis]
---

# TEE / TrustZone reverse engineering (OP-TEE / Trusted App / secure storage)

## When to use / when not to use

- Use: TrustZone/OP-TEE-class TEE analysis — Trusted Application reverse engineering, command dispatch table recovery, secure storage (secure storage / device key) objects and data flow
- Use: device keys / trust root — DRM hardware trust root ([[re-drm]] L1 class), device-key extraction and protection mechanisms (authorized research)
- Use: TEE interface surface — SMC calls, host-side TEE driver ioctls, client-library call-sequence recovery
- Use: firmware security assessment — evaluate the target device TEE implementation's exposed interface, storage protection strength, and trust-root boundary
- Do not use: ordinary app layer (use [[re-mobile]]); Windows kernel/drivers (use [[re-kernel]]; the TEE side is the Linux/ARM domain)
- Do not use: pure firmware extraction and unpacking (use [[re-fw-extract]] first; this skill analyzes TEE components after that)
- Do not use: the target is only ordinary encrypted data (use the [[re-crypto-*]] series; do not enter this skill when there is no TEE component)
- Do not use: only need to decide "whether the device uses a TEE" (no image, no call surface to analyze) — feature-level evidence is enough; do not enter the deep flow
- Do not use: EL2 hypervisor/virtualization domain (use [[re-hypervisor]]; TEE is the EL1/EL3 domain)
- Note: **dynamic debugging inside the secure world is usually not feasible** (see pitfall 3) — default to static analysis plus host-side observation; host-side dynamic execution follows the top rule in [[re-analyze/platform-tips]] and runs in a sandbox

## Tool setup

Static analysis (image parsing / decompilation) does not need a sandbox. Host-side dynamic work (running a client, hooking ioctl) enters a sandbox under the top rule in [[re-analyze/platform-tips]]. Do not do dynamic work inside the secure world (see pitfall 3). Default to static analysis plus host-side observation.

### Decompiler workbench ([[re-ghidra]] / [[re-ida]], ARM64)

- [[re-ghidra]] (default): import the TEE OS image and the TA (a .ta must have its signed header stripped first; see step 2 and pitfall 5)
- [[re-ida]]: alternative; both need ARM64 support
- Verify: can decompile ARM64 code and locate `smc` call sites and `TA_InvokeCommandEntryPoint`-class dispatch tables

### Firmware extraction toolchain ([[re-fw-extract]])

- binwalk/unblob, magic scans, endianness checks — locate and extract the TEE OS and TA images from the bootrom / boot chain / device firmware
- Verify: `binwalk --version` (install commands are in [[re-fw-extract]] "Tool setup")

### python3 (binary parsing / scripts)

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`; macOS: built in; Windows: official installer or `choco install python`
- Verify: `python3 --version`
- Use: signed-header / ELF payload split and parse, structure field annotation, decryption recovery scripts (handoff to [[re-crypto-decrypt]])

### Reference implementation (official OP-TEE open source, for understanding structure)

- Official repos optee_os / optee_client / optee_examples (and the qemu emulation environment) are the authoritative reference for TEE structure and call sequences — when the target differs from OP-TEE, check the official source, do not rely on remembered values
- The qemu environment can run the full client → TA call chain, for comparing call sequences and parameter layout; differences between emulation and a real device (real driver / interrupts / storage medium) follow the real device

### frida / host-side observation ([[re-frida]])

- Host-side dynamic: hook the client-library call sequence and ioctl arguments (frida install and sandbox rules are in [[re-frida]]; dynamic execution defaults to a sandbox)
- Verify: `frida --version`

## Steps

Run in order. Record each step's products (image location, header annotation, command-id table) with evidence path + sha256 (see [[re-triage]]) for the report.

1. **Architecture placement (world split / SMC / TEE OS entry)**:
   - TrustZone splits normal world (NS) and secure world (S). On ARMv8-A the TEE OS usually runs at secure EL1, Trusted Applications at secure EL0, and the EL3 monitor carries the secure-monitor firmware (such as ATF BL31-class boot firmware, generalized)
   - The **SMC instruction** is the channel from normal world into secure world: AArch64 is `smc #imm` (AArch32 is `smc`). Executing it from EL1/EL2 traps into the EL3 monitor, which then dispatches to the TEE OS. Searching decompilation for `smc` is the call-surface landing point
   - SMC argument convention (SMCCC): the function id is in w0 (including service / calling-convention flag bits), arguments are in w1-w7 (SMC32) or x1-x17 (SMC64; **only SMCCC ≥1.2 extends to x1-x17; 1.0/1.1 is only x1-x7**), and return values start at w0 — annotate call sites by reading registers from the convention table, do not guess a normal ABI (see pitfall 4)
   - Feature hunt: grep version strings, exported API string tables, and SMC function-id constant tables first — the string table often gives the TEE OS type and version directly, faster than decompiling one by one
   - Locate the TEE OS load entry: bootrom → boot firmware → TEE OS image (image-header magic, load / verify code) — search the boot chain for TEE image features (image-header magic, version strings, exported API string tables). The TEE OS may also be embedded in a device firmware partition (locate it after [[re-fw-extract]])
   - Product: world/EL split diagram + TEE OS image location and load entry

2. **OP-TEE structure (core vs TA split, .ta format)**:
   - core (trusted OS kernel, secure-world system services) and TA (Trusted Application, secure-world user mode) are separate. core provides the TA with `TEE_*` internal APIs (cryptography, secure storage, time, and so on). The TA implements business logic on that API — before analyzing a TA, confirm the core/TA boundary (who provides the API, who calls it)
   - **.ta file format** (REE filesystem TA): file = signed header + ELF payload. Signed header (`struct shdr`, official core/include/signed_hdr.h): magic (`0x4f545348` = "OTSH"), img_type, img_size, algo, hash_size, sig_size, then hash and signature. img_type values: 0 plaintext signed TA / 1 bootstrap TA (UUID+version subheader) / 2 encrypted TA / 3 subkey chained header. The encrypted variant (img_type=2) is followed by a `shdr_encrypted_ta` subheader (enc_algo, flags, iv_size, tag_size + iv + tag); the ciphertext is AES-GCM
   - Parse flow: locate the signed header by file-header magic → cut the ELF payload by img_size → [[re-format-elf]] parses sections/segments → annotate `ta_head` (UUID, version, flags, and so on; the UUID is the TA interface id and matches the UUID the host calls)
   - Do not trust the extension: some devices ship the TEE OS/TA as .tos/.trusted-class names — always decide the format by magic, not by picking a parser from the extension
   - Product: signed-header field annotation + cut ELF payload + ta_head/UUID record

3. **TA analysis (entry / command dispatch / secure storage)**:
   - Entry chain: `TA_CreateEntryPoint` (init) → `TA_OpenSessionEntryPoint` (session open) → `TA_InvokeCommandEntryPoint` (command dispatch, switch on cmd_id) — **the command dispatch table is the TA's external interface catalog**. Annotate command id and behavior on every branch
   - Parameter model: invoke carries a parameter-type description and at most 4 `TEE_Param` values (value scalar pairs / memref memory references). A memref points at shared memory and is the main input/output channel — annotate parameter type and structure on every command branch
   - Session lifetime: the pairing of OpenSession/CloseSession with command calls is what you recover (who opens the session, when, with what initial parameters) — session-open parameters often contain initial key material
   - Command-id enumeration: number every switch branch (including illegal commands / the default branch). Compare with the host call surface (step 4) and confirm which commands are really reachable and which are internal — reachable commands are the main interface / attack surface; mark priority
   - **secure storage object operations**: locate `TEE_*` storage API call sites (object create/open/read/write/seek/delete class), recover the object id (often derived from UUID + object name/index) and the data flow. secure storage ciphertext finally lands on the normal-world filesystem (via tee-supplicant) or hardware storage (RPMB class; hardware side see [[re-hw-chip]]) — finding the ciphertext file's decrypt path is finding the object data
   - On-disk shape: the REE filesystem side is usually an index file plus data-block files (object directory map) — find the object by index, locate ciphertext by block, then recover object contents
   - Product: command-id → behavior table + parameter structure annotation + secure storage object list

4. **Host call surface (ioctl / client library, close from both ends)**:
   - Linux TEE subsystem: `TEE_IOC_*` ioctls on `/dev/tee0` (used by client libteec): open session, invoke, close session, shared-memory alloc/register class. `/dev/teepriv0` belongs to tee-supplicant (privileged daemon) and is not the client call path — do not treat teepriv0 as a "private session" channel (see [[gotchas]])
   - User-mode client library call sequence (GlobalPlatform TEE Client API): `TEEC_InitializeContext` → `TEEC_OpenSession` (UUID and parameters) → `TEEC_InvokeCommand` (command id and TEEC_Operation) → `TEEC_CloseSession` → `TEEC_FinalizeContext`
   - **Close from both ends**: read ioctl arguments on the host (UUID, command id, parameter layout, shared-memory contents) → match them to the TA dispatch table (step 3). Once both sides are annotated, the TA input/output format closes. If one side is missing, infer from the other (see pitfall 2)
   - Dynamic observation (in a sandbox): frida-hook client library calls and ioctl arguments ([[re-frida]]); record session open, the command call sequence, and buffer contents
   - Logs: tee driver and OP-TEE init logs in `dmesg` (driver version, interrupt number, supplicant status) help fingerprint and version
   - Extra observation: tee-supplicant process behavior (disk writes / device access) — the REE-side landing point of the secure storage data flow
   - Product: host call sequence + TA interface crosswalk (UUID / command id / parameter layout one to one)

5. **Vendor differences (custom TEE, generalized)**:
   - Custom TEE differences: SMC function-id scheme, TA image format (header / signature / encryption), secure storage layout, exported API names and semantics — all may differ from OP-TEE
   - Approach: fingerprint the TEE type first (image-header features, string / exported API features, SMC function-id pattern) → confirm OP-TEE family or a custom implementation → apply the general flow layer by layer (architecture placement → format parse → interface enumeration → call-surface close). OP-TEE details are a reference template, not the default
   - Differences: where the structure does not line up, first suspect a "custom extension" (added fields / reordered / different magic). Record the difference instead of forcing the template. When there is no format document, infer the layout from "field length + common values (UUID / version / size)" ([[re-proto-rev]] approach)
   - Cross-check the inference: match command id to behavior by comparing "return code + output buffer contents" entry by entry — error-code semantics often expose parameter-check order and the permission boundary
   - Product: TEE type fingerprint + difference list

## Related skills

- [[re-fw-extract]]: prerequisite extraction and unpack of TEE OS/TA images (bootrom / boot chain / firmware partition)
- [[re-binary-core]]: image decompilation base ([[re-format-elf]] parses the TA ELF; [[re-ghidra]]/[[re-ida]] workbench)
- [[re-kernel]]: host-side TEE driver analysis (ioctl dispatch, driver load, Linux kernel side)
- [[re-mobile]]: mobile TEE integration surface (TEE calls inside the app, DRM integration, joined to the host call surface)
- [[re-hw-chip]]: secure storage hardware side (RPMB-class storage, trust root, physical protection)
- [[re-frida]]: host-side dynamic observation (client library / ioctl instrumentation, sandbox rule)
- [[re-drm]]: device keys / hardware trust root (DRM L1-class trust root lives in the TEE)
- [[re-crypto-decrypt]]: decrypt recovery of encrypted TA payloads / secure storage ciphertext
- [[re-sandbox]] / [[re-analyze/platform-tips]]: top rule for isolating host-side dynamic execution

## Pitfalls

- **A TA is a signed (+ encrypted) image; analyzing it directly fails**: symptom — drop a .ta straight into a decompiler and import fails or everything is garbage; cause — .ta = signed header + ELF payload (the encrypted variant is also AES-GCM ciphertext), and the file header is not an ELF header; fix — locate the signed-header magic (such as "OTSH") and cut out the payload first (step 2). For the encrypted variant, recover the decrypt flow first ([[re-crypto-decrypt]]) and analyze the plaintext ELF. The verify/decrypt flow itself is also an analysis target (trust root / keys are on the core side)
- **When secure-world code is unavailable, infer from the host**: symptom — TEE OS/TA firmware cannot be extracted (SoC internal ROM / protected storage), and there is no way to do secure-world dynamic work; cause — the TEE OS is often built in or protected and is not shipped with the user-area firmware; fix — record UUID / command id / parameter layout from the host ioctl (`TEE_IOC_*`) call surface plus the client library call sequence (step 4), and infer the TA interface and internal logic from return behavior. When static evidence is thin, the call surface is the main evidence
- **secure world anti-dump / monitoring**: symptom — attach does nothing, a memory dump will not come out or its contents are wrong, runtime behavior does not match static analysis; cause — the TEE side has anti-debug and integrity protection (debug-port fuse, security monitoring, anti-dump mechanisms, generalized); fix — do not dynamically debug inside the secure world; stay with static analysis plus host-side observation. Record behavior differences as "TEE-side monitoring fired" evidence and mark confidence; do not force an attribution
- **Wrong SMC argument convention misreads the interface**: symptom — treat an SMC call site as a normal function call, guess register arguments from a normal ABI, and the inferred interface is entirely wrong; cause — SMC follows SMCCC (function id in w0, arguments in w1-w7 / x1-x17, where SMC64 x1-x17 starts at SMCCC 1.2; return values start at w0), which is not a normal ABI, and a shifted read scrambles the whole data flow; fix — build a table from the public calling convention first (function-id encoding, argument register layout, return convention), then annotate `smc` call sites in the decompilation. Argument meaning comes from the convention table, not from guessing (see the calling-convention group in [[gotchas]])
- **Parsing the signed header / ta_head as an ELF header**: symptom — parsing a .ta as an ELF header fails (e_ident does not match), or ta_head's UUID is treated as a string table; cause — the .ta file header is the signed header (the ELF header is inside the payload), and ta_head is the first structure inside the ELF, not the file header; fix — cut the ELF payload by signed-header fields (magic/img_size) and then use [[re-format-elf]]. Before importing into Ghidra/IDA, strip the signed header with a script (archive the step 2 product)
- **Applying OP-TEE details to a custom TEE**: symptom — analyzing a custom TEE with OP-TEE's header and command model puts every field in the wrong place and the interface does not match; cause — a custom TEE's format and conventions differ (image header, SMC function ids, storage layout); fix — fingerprint the TEE type first (step 5), confirm the family, then pick an analysis template. Handle differences by inferring layout from "field length + common values (UUID / version / size)" ([[re-proto-rev]] approach). OP-TEE structure is only a reference
- **Do not force a UUID that does not match**: symptom — the UUID the host calls is not in the TA dispatch table; cause — several TA versions coexist in the firmware package, or the TA image version does not match the system (the UUID is the interface id, and version evolution changes the UUID); fix — check versions against the TA list/directory in the firmware package, and match UUID and command id against each candidate TA
- **Missing secure storage ciphertext is not "no data"**: symptom — no secure storage ciphertext on the REE filesystem; cause — the medium is RPMB/hardware, or the on-disk path differs from the default (tee-supplicant config); fix — confirm the storage medium and supplicant config first (REE FS vs RPMB). For RPMB, switch to the [[re-hw-chip]] approach. Do not conclude "no data" from "not found"
- Decision branches (image shape / interface surface / evidence grades) are in [[decision-tree]]. Format and calling-convention boundaries are in [[gotchas]]

# TEE/TrustZone reverse-engineering decision tree and evidence grades

## Scenario decision tree (entry → branches)

### 1. Target shape branch (level 1)

```
What you can obtain
├─ TA image (.ta) → signed-header parse → ELF payload → [[re-format-elf]] + decompile
├─ TEE OS image (core) → decompile, locate TEE_* internal APIs and smc dispatch
├─ Embedded in a firmware partition (bootrom/boot chain) → [[re-fw-extract]] first, then locate
└─ None of the above (SoC internal ROM/protected) → infer from the host call surface (branch 4)
```

### 2. Image format branch (level 2)

```
.ta file header
├─ magic "OTSH" (0x4f545348) → OP-TEE-family signed header
│  ├─ img_type=0 → plaintext signed TA: cut out the ELF and analyze it
│  ├─ img_type=1 → bootstrap TA: subheader has UUID+version, payload follows
│  ├─ img_type=2 → encrypted TA: AES-GCM ciphertext; recover the decrypt flow first ([[re-crypto-decrypt]])
│  └─ img_type=3 → subkey chained header (newer versions)
├─ other magic → custom TEE: infer the layout from "field length + common values" ([[re-proto-rev]])
└─ already an ELF → bare TA / test build with no signed header; analyze directly
```

### 3. Interface-surface branch (level 3, close from both ends)

```
Interface surface
├─ secure-world side: TA_InvokeCommandEntryPoint command dispatch table
│  └─ annotate behavior and parameter type (value/memref) per cmd_id
├─ host user mode: client library calls (TEEC_OpenSession/InvokeCommand)
│  └─ record UUID, command id, TEEC_Operation parameter layout
├─ host kernel mode: /dev/tee0 ioctl (TEE_IOC_OPEN_SESSION/INVOKE/CLOSE_SESSION)
└─ match both sides → close: each command branch = UUID + cmd_id + parameter layout + behavior
```

### 4. Data-target branch (level 4)

```
What you want
├─ device key / trust root → DRM direction ([[re-drm]]) to confirm the TEE role; the key is in core/TA
│  └─ if it cannot be extracted, record purpose and protection (red line: do not force extraction)
├─ secure storage object → locate on-disk ciphertext (REE filesystem via tee-supplicant / RPMB)
│  └─ find the decrypt path (object-id derivation + crypto flow) and recover plaintext
├─ command interface catalog → recover the dispatch table (step 3)
└─ call sequence (who calls what, when) → host-side hook ([[re-frida]]) and record
```

### 5. Secure world unavailable branch (level 5)

```
TEE OS/TA unavailable
├─ full record of the host ioctl/client call surface (UUID/command id/parameters)
├─ observe return behavior (success/failure codes/output buffer) and infer internal logic
└─ downgrade the conclusion grade: call-surface evidence is primary; mark internal implementation as "inferred"
```

## Evidence grade table

| Grade | Evidence shape | Example | Use |
|---|---|---|---|
| A strong | both sides closed | host ioctl arguments match the TA dispatch table entry by entry, and the plaintext/ciphertext chain is connected | interface and data-flow conclusions are allowed |
| B medium | one side complete | only a complete host call surface, or only a static dispatch table (not confirmed dynamically) | "suspected" is allowed; mark the missing side |
| C weak | feature level | image-header magic, UUID, or string features confirm the TEE type | supports only "TEE type determination" |
| counter-evidence | benign explanation | the called command is a normal business path, with no privilege bypass / anomaly | record and archive |

- Device-key conclusion grades: extraction succeeded (A) → confirmed unextractable + purpose (B) → only inferred to be inside the TEE (C). Do not treat an inference as an extraction result
- Behavior that disagrees with static analysis is recorded as "TEE-side monitoring fired" evidence, with a confidence mark

## Lessons (internalized)

- Fingerprint before applying a template: TEE type (OP-TEE family vs custom) decides every format assumption. Do not take OP-TEE details as the default
- Read SMC from the convention table, do not guess: build the SMCCC table first (w0 function id, argument registers, return value), then annotate call sites
- Closing from both ends needs a landing point on each side: UUID, command id, and parameter layout must match before it closes
- An encrypted TA's decrypt flow is itself the analysis target: keys / trust root are on the core side; recovering the decrypt logic is the evidence
- secure storage: find the on-disk copy first, then the decrypt path. REE files written by tee-supplicant and the RPMB partition are both targets
- Script the signed-header strip: cut the payload (img_size offset), save the script, keep it reproducible

## Notes

- Host-side dynamic work (client/ioctl hooks) stays in a sandbox ([[re-sandbox]], top rule in [[re-analyze/platform-tips]]). Do not dynamically debug inside the secure world
- When a device key cannot be extracted, record purpose and protection; do not force extraction (red line). Grade conclusions with this table

# TEE/TrustZone reverse-engineering pitfalls and boundaries

## Image and format group (easiest to get wrong)

- **The signed header is not an ELF header**: the .ta file header is `struct shdr` (magic "OTSH", img_type, img_size, algo, hash_size, sig_size + hash + sig). The ELF header is inside the payload — parsing it as ELF will fail. Locate by magic first, then cut the payload by img_size
- **img_type variants differ**: 0 plaintext signed TA / 1 bootstrap TA (subheader has UUID + ta_version) / 2 encrypted TA / 3 subkey chained header — always parse as "signed header + subheader + payload". Do not assume one shape
- **An encrypted TA is AES-GCM ciphertext**: when img_type=2 the payload is ciphertext, and the `shdr_encrypted_ta` subheader carries enc_algo/iv/tag — recover the decrypt flow first ([[re-crypto-decrypt]]), then analyze. The decrypt key and trust root are on the core side; the decrypt logic itself is evidence
- **ta_head is the first segment inside the ELF**: UUID/version/flags live in the payload ELF's ta_head, not in file-header fields — after cutting out the ELF, use [[re-format-elf]] and annotate the first segment
- **bootstrap TA and ordinary TA entries differ**: a bootstrap TA uses the `TA_Boot` entry, not the standard EntryPoint chain — pick the analysis template by img_type

## Calling-convention group (SMC/ABI boundary)

- **SMC is not a normal function call**: SMCCC puts the function id in w0 (including OEN and the SMC32/SMC64 flag), arguments in w1-w7 (SMC32) or x1-x17 (SMC64, SMCCC ≥1.2; 1.0/1.1 is only x1-x7), and return values start at w0 — reading registers as a normal ABI shifts the whole data flow
- **SMC32 and SMC64 register widths differ**: the same function id has different argument positions/widths under the two conventions — check bit 30 of the function id (SMC64 flag) before choosing a parse
- **Do not mix HVC and SMC channels**: `hvc` / `smc` are executed by a caller at a lower EL and enter EL2 / EL3 respectively as synchronous exceptions (`svc` enters EL1; enablement is controlled by SCR_EL3.HCE/SMD and similar). In decompilation, separate the channels before annotating call sites. Mixing them attributes hypervisor calls to the TEE. Seeing `smc` is not automatically a TEE; continue with SMCCC FID/OEN to decide which service owns it
- **32/64-bit TAs mixed**: AArch32 and AArch64 TAs differ in calling convention (TEE_Param layout) — pick the parse template from the ELF architecture

## Host-side group

- **/dev/teepriv0 is not a "private session" channel**: teepriv0 belongs to tee-supplicant (privileged daemon). Client calls go through /dev/tee0 — treating teepriv0 as the client entry will miss the call surface
- **ioctl arguments live in a struct**: UUID/command id/parameter layout for `TEE_IOC_*` are in the `struct tee_ioctl_*` request, not bare ioctl arguments — when hooking, parse the request struct
- **Shared-memory registration is a separate flow**: before invoke you often need `TEE_IOC_SHM_REGISTER` to register shared memory — when hooking the call sequence, pair shm registration with invoke, or you cannot recover buffer contents
- **tee-supplicant handles storage RPC**: secure storage hits disk via tee-supplicant on the REE side (default path such as a /data/tee-class directory) — look for ciphertext files in tee-supplicant's behavior, not in file operations inside the TA
- **client library versions differ**: libteec and the newer libckteec differ (PKCS#11 direction) — pick the API template from the library the target actually uses

## Counterexamples and boundaries

- **Applying OP-TEE details to a custom TEE**: image header / SMC function ids / storage layout all differ — fingerprint first (image-header features / strings / SMC pattern), confirm the family, then apply a template. OP-TEE is only a reference
- **Do not force-dig when the secure world is unavailable**: for SoC internal ROM / protected storage, the host call surface plus behavior inference is the only path — downgrade the conclusion to "inferred". Do not treat an inference as confirmation
- **Device keys cannot be extracted**: extracting a private key from an SE / secure world is usually impossible — record purpose and protection (authorized research). Do not force extraction (red line)
- **"A TEE exists" ≠ "the data is inside the TEE"**: many implementations put only the key in the TEE, and business data is plaintext in the normal world — confirm the data boundary before choosing the analysis target
- **Do not force an attribution for behavior differences**: the secure world has anti-dump / integrity monitoring (generalized) — when behavior disagrees with static analysis, record it as "TEE-side monitoring fired" evidence and mark confidence

## Notes

- Host-side dynamic work stays in a sandbox ([[re-sandbox]], top rule in [[re-analyze/platform-tips]]). Do not dynamically debug inside the secure world
- Grade conclusions with [[decision-tree]]. For device-key conclusions, separate three bands: "extraction succeeded / unextractable + purpose / inferred"

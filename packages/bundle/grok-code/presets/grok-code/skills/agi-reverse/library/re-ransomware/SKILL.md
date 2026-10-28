---
name: re-ransomware
description: >
  Ransomware analysis: crypto identification, the ransom note, and a decrypt-and-recover plan.
  Triggers: `勒索`, ransomware, `加密文件`, `勒索信`, `解密恢复`
capabilities: [malware-behavior, crypto-identification]
---

# Ransomware analysis (crypto identification / the ransom note / decrypt and recover)

## When to use / when not to use

- Use: a victim's files were encrypted (the extension changed, the file header is damaged, entropy rose) and a ransom note appeared (README/DECRYPT)
- Use: the question is "can this be recovered", and a decrypt-and-recover route is needed (extract the key → a decrypt script / a community decryptor)
- Use: recovering the ransomware sample's algorithm, key management, and C2 interaction
- Do not use: the sample is not yet confirmed as ransomware (do the [[re-triage]] first look + the [[re-behavior]] behavior check first)
- Do not use: only the crypto algorithm itself is being analyzed (go straight to [[re-crypto-id]] / [[re-crypto-keys]])
- Note: running the sample means it will really encrypt files. It must run inside a sandbox snapshot ([[re-sandbox]] is a required prerequisite, the top rule in [[re-analyze/platform-tips]]). Static analysis may skip the sandbox

## Tool setup

Verify every tool before use. The full install of the crypto trio and the sandbox is in those skills; this skill reuses them. What this skill adds is a filesystem snapshot tool (so the sample cannot encrypt the analysis environment; pitfall 1).

### The crypto-analysis trio (reuse the crypto domain)

- [[re-crypto-id]]: algorithm identification (constant-table fingerprints, a custom cipher)
- [[re-crypto-keys]]: key extraction (hardcoded / memory / a resource)
- [[re-crypto-decrypt]]: a decrypt script (the pycryptodome install is in that skill)
- Check: `python3 -c "from Crypto.Cipher import AES; print('ok')"` (see [[re-crypto-decrypt]])

### The sandbox environment (a runtime prerequisite)

- [[re-sandbox]]: a VM snapshot + network isolation (INetSim / fake DNS). Dynamic analysis of a ransomware sample defaults to VM-snapshot level (encryption is highly destructive)
- Check: the snapshot `VBoxManage snapshot <vm> list` has clean; the network `ping 8.8.8.8` fails

### Filesystem snapshot tools (keep the pre-encryption state)

- Linux: btrfs snapshots with `snapper` — Debian/Ubuntu `apt install snapper` / Fedora `dnf install snapper` / Arch `pacman -S snapper`; check: `snapper --version`. On a non-btrfs filesystem, back up the observation directory with `tar` / `rsync` (shipped)
- Windows: Volume Shadow Copy `vssadmin` (shipped) — `vssadmin list shadows` to check. A snapshot is also one recovery path (step 5)
- macOS: Time Machine `tmutil` (shipped) — `tmutil listbackups` to check
- Hash / enumerate: `sha256sum` / `find` (shipped with coreutils)

### Family identification and decryptor research (online, no install)

- ID Ransomware (id-ransomware.malwarehunterteam.com): upload the ransom note or an encrypted file header to identify the family
- No More Ransom (nomoreransom.org): the official decryptor collection (timeliness is pitfall 4)
- [[re-ti]]: look up the sample hash on VT / community reports, and confirm the family and existing analysis conclusions

## Steps

Run in order and record evidence (path + sha256; see [[re-triage]]). Static first (the static-first principle in [[re-analyze/platform-tips]]): do 1-2 on the host. Enter the sandbox only when a run is required.

1. **The initial judgment (an extension change / an encrypted-header feature / a ransom note)**:
   ```sh
   sha256sum sample.exe 被加密文件            # 存证（[[re-triage]]）
   file 被加密文件                            # 文件头是否被改写/替换
   xxd -l 64 被加密文件                       # 头部特征：固定前缀=感染 ID/密钥块，尾部特征同理
   find / -xdev -iname "*README*" -o -iname "*DECRYPT*" -o -iname "*RECOVER*" 2>/dev/null
   find . -type f -mmin -60 -size +1k | head  # 加密时间窗内被改动的文件
   ```
   - Decision signals: a batch extension change (.crypt/.locker/.encrypted), the original file deleted or overwritten, a ransom note in the directory, the desktop wallpaper replaced
   - First keep a whole-file hash and a directory listing of the victim's files (a backup that pairs with the snapshot)

2. **Identify the algorithm (the crypto domain)**:
   - Static analysis of the sample: [[re-crypto-id]] — constant-table fingerprints (an AES S-box / an RSA public-key DER / a CRC table), XOR/ROL/ROR transforms, and whether it is hybrid crypto (RSA wrapping an AES key is the most common)
   - Observe the ciphertext: a fixed block at the head or the tail (an infection ID, a key block), ciphertext length alignment (AES block size 16), entropy (>7.0 → a candidate for encryption / compression / high randomness, which needs the file header and context as support — high entropy by itself is not an encryption verdict)
   - Three-way decision: symmetric (AES of the whole file) → find the symmetric key; asymmetric (RSA encrypts directly) → almost unrecoverable; hybrid (RSA encrypts the AES key) → if the key block is stored with the file, see step 3
   - Pass the conclusion (the algorithm hypothesis + the evidence) to steps 3 and 5

3. **Recover key management (local / network / C2 distribution)**:
   - Local: [[re-crypto-keys]] static first (strings / hardcoded / a resource / the import table) → if nothing, then memory ([[re-memdump]] dumps with gcore by default; the dump time is during the encryption loop, after the key was derived and before it was destroyed)
   - Delivered over the network / C2: inside the sandbox, [[re-sandbox]] (INetSim/fake DNS) + [[re-netcap]] capture, and [[re-protocol]] rebuilds it — the key may be delivered by the C2 only at runtime, and static analysis cannot get it
   - Hybrid model: the sample contains an RSA public key, and the AES key is encrypted and written into the file header → without the private key it is unrecoverable (say so honestly; see the pitfall in [[re-crypto-keys]])
   - Record the source evidence of every candidate key (offset / function name / dump path) for [[re-crypto-decrypt]]

4. **The ransom note and the C2 interaction (through [[re-protocol]])**:
   - Read the ransom note: extract the email / URL (Tor / dark web) / BTC address / infection ID → record them as IOCs ([[re-ioc]])
   - C2 interaction: [[re-protocol]] orchestrates it — [[re-netcap]] captures → [[re-crypto-id]] decides ciphertext → [[re-crypto-keys]] takes the key → [[re-crypto-decrypt]] decrypts the traffic → [[re-proto-rev]] rebuilds the interaction (key upload / status report / infection-ID registration)
   - Watch especially: whether data was uploaded before encryption (double extortion, pitfall 2), and whether the key is sent back to the C2

5. **The recovery plan (extract the key → a decrypt script; no key → a community tool)**:
   - With a key: [[re-crypto-decrypt]] writes a batch decrypt script (replay the algorithm / mode / IV from the [[re-crypto-id]] conclusion) → check a small sample until plaintext comes out → run the full set
   - Partial encryption / header encryption: only the first few KB or some blocks were encrypted → cutting the header off or rebuilding the file header recovers most files (check first whether the ciphertext length equals the original length; that is the cheapest path)
   - With no key: ID Ransomware identifies the family → No More Ransom / a vendor decryptor (it must match the variant, pitfall 4) → if it fails, report honestly that it is "not recoverable right now"
   - Snapshot / backup recovery first: roll back with vssadmin / snapper / Time Machine (note that the sample may delete shadow copies first; check whether they were deleted)
   - Product: a recoverability conclusion + a decrypt script + the evidence chain (the [[re-ioc]] report structure)

## Cross-domain handoff

- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]: cited by steps 2/3/5, the main chain of identify → key → decrypt
- [[re-sandbox]] / [[re-behavior]]: the required prerequisite for dynamic analysis (the top rule in [[re-analyze/platform-tips]]) and watching encryption / exfiltration behavior
- [[re-protocol]]: the C2 interaction behind the ransom note (netcap / crypto-* / proto-rev), step 4
- [[re-ti]]: sample-hash / family identification (VT, ID Ransomware)
- [[re-ioc]]: the ransom-note email / URL / wallet address, and the key and ciphertext fingerprints, become IOCs
- [[re-malware]]: this skill is cited by the re-malware gateway (the ransomware-sample branch). Behavior analysis and the report follow the gateway's full flow
- Related branches of [[re-analyze/platform-tips]]: the default sandbox (encryption is highly destructive), static first, and the platform branch (Linux uses snapper, Windows uses vssadmin)

## Pitfalls

- **The sample encrypts every file inside the sandbox**: symptom — as soon as the sample runs, every file in the sandbox is encrypted, including the sample itself and the behavior log, and the evidence products are destroyed; cause — it was run without a filesystem snapshot or a honeypot isolation, or the snapshot was not restored after analysis; fix — a [[re-sandbox]] snapshot + a honeypot folder (fake documents / a fake key, to watch which targets it encrypts) + pass the sample in read-only, and restore the snapshot immediately after analysis (the pitfall list is in [[re-sandbox]]). Keep an independent backup of the original sample and the ciphertext copy on the host
- **Double extortion (data leak + encryption)**: symptom — the ransom note threatens both "encrypted files + public leak of the data", and watching only the encryption misses the exfiltration stage; cause — the double-extortion pattern: steal the data first (a C2 upload) and then encrypt, so the ransom demand is doubled; fix — [[re-behavior]] / [[re-netcap]] watch network exfiltration first (the leak's impact is larger than the encryption). Record behavior and IOCs in two stages, and state them separately in the report
- **RaaS variant differences**: symptom — samples of the same family differ in the encrypted extension, the algorithm, and the key scheme, and applying a family-wide conclusion is wrong; cause — RaaS (ransomware as a service) rents a customizable variant to attackers, and each tenant can configure it; fix — trust a measurement of the sample in hand (reconfirm with [[re-crypto-id]]). Record sample-level features (the sample hash / the key-block fingerprint), not a family-level conclusion
- **Decryptor timeliness**: symptom — a No More Ransom decryptor reports "not this variant" or produces garbage; cause — the decryptor covers only a specific variant or an old version, and a new variant already changed the algorithm or the key scheme; fix — match the variant precisely with ID Ransomware + the sample hash before picking a tool. If it fails, follow the key-extraction route (steps 3/5) or report honestly that it is unrecoverable. Tools are updated when a C2 key leaks; recheck periodically

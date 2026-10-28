---
name: re-crypto-id
description: >
  Crypto-algorithm identification: constant-table fingerprints, custom encryption modes.
  Triggers: `加密识别`, AES, XOR, `算法指纹`, custom encryption
capabilities: [crypto-identification]
---

# Crypto-algorithm identification

## When to use / when not to use

- Use: you have ciphertext (traffic or a data blob) and do not know the algorithm
- Use: the sample contains a crypto implementation, and you need to narrow the algorithm before decompiling
- Use: you suspect custom encryption (an XOR/ROL/ROR transform) rather than a standard algorithm
- Do not use: the algorithm is already known (go straight to [[re-crypto-keys]] for the key and [[re-crypto-decrypt]] to decrypt)
- Do not use: a standard-library API call is clearly visible (`CryptEncrypt` / an OpenSSL symbol can be looked up directly — see the import-table clues in [[re-crypto-keys]])
- Do not use: pure static analysis can already decide it is plaintext ([[re-triage]] low entropy / many readable strings)

## Tool preparation

Verify every tool before use. This skill is mainly static/offline analysis and can skip the sandbox; the dynamic confirmation step (Frida) is only for a sample that is already running (sandbox by default, [[re-analyze/platform-tips]] supreme rule).

### python3 — fingerprint and entropy-analysis scripts

- Install and verify: see [[re-proto-rev]] tool preparation (python3)

### binutils — strings/objdump for constants and disassembly clues

- Linux: `apt install binutils` / `dnf install binutils` / `pacman -S binutils` (usually present)
- macOS: `brew install binutils` (or the system otool as a substitute)
- Windows/WSL: the Linux build inside WSL; on native Windows use the tools that ship with Ghidra
- Verify: `strings --version`; `objdump --version`

### hexdump — view ciphertext/constants in hex

- Install and verify: see [[re-fw-extract]] tool preparation (hexdump)

### Detect It Easy (DIE) — optional, fast signature identification (common on Windows)

- Windows: download the portable build from GitHub releases https://github.com/horsicq/Detect-It-Easy (`diec.exe` CLI / `die.exe` GUI); `choco install die` (present on some mirrors)
- Linux: AUR `yay -S detect-it-easy` or the Linux build from releases
- macOS: build from source (Qt dependency) or run the Windows build under Wine
- Verify: `diec --help` prints usage; `diec sample.bin` can print a signature

## Procedure

Run in order and record each step. The decision artifact (algorithm hypothesis + evidence) is passed to [[re-crypto-keys]] / [[re-crypto-decrypt]].

1. **Constant-table fingerprints (AES S-box / CRC table / MD5 IV)**:
   ```sh
   # look for constant-table candidates in the static data section: 256 contiguous bytes, low entropy, no ASCII
   strings -n 8 sample.bin | head -50
   objdump -s -j .data sample.bin | head -60
   # search for the start of the AES S-box (the first-16-byte feature)
   python3 - <<'EOF'
   data = open('sample.bin','rb').read()
   aes_sbox = bytes.fromhex('637c777bf26b6fc53001672bfed7ab76')
   crc32_tab_be = bytes.fromhex('0000000077073096ee0e612c990951ba')   # first 16 bytes of the standard CRC32 table (poly 0xEDB88320, display order/BE)
   crc32_tab_le = bytes.fromhex('00000000963007772c610eeeba510999')   # the same table's byte order in an x86/ARM little-endian binary's memory
   for name, sig in [('AES_SBOX', aes_sbox), ('CRC32_TAB(BE)', crc32_tab_be), ('CRC32_TAB(LE)', crc32_tab_le)]:
       i = data.find(sig)
       while i != -1:
           print(f"{name} @ 0x{i:x}"); i = data.find(sig, i+1)
   EOF
   ```
   - A hit on the AES S-box (a 256-byte table) → an AES candidate; a hit on a CRC table → there is a CRC/checksum (it may pair with [[re-proto-rev]] step 3); a hit on the MD5 IV → an MD5 candidate
   - Endianness: the hex listed above is display order (BE reading order). In a little-endian binary (x86/ARM) the constant table's actual bytes in memory are LE order — also search the CRC table for `00000000963007772c610eeeba510999` (the script already includes it); the MD5 IV display order is `67452301efcdab89...`, and the LE serialization is `0123456789abcdeffedcba9876543210` (search both patterns)
   - No hit → do not rule out a dynamically generated table (see pitfall 2); continue to the next step

2. **Entropy analysis to locate ciphertext (distinguish ciphertext from plaintext regions)**:
   ```python
   data = open('sample.bin','rb').read()
   import math, collections
   for base in range(0, len(data), 4096):
       blk = data[base:base+4096]
       if not blk: break
       c = collections.Counter(blk); n = len(blk)
       h = -sum((v/n)*math.log2(v/n) for v in c.values())
       if h > 7.0: print(f"0x{base:x}: entropy={h:.2f}  <- high-entropy region (ciphertext/compression candidate)")
   ```
   - A high-entropy region (>7.0) → a ciphertext or compressed-data candidate; record the offset for [[re-crypto-decrypt]] to locate the input point
   - A low-entropy region that still looks "scrambled" (no ASCII, no structure) → possible custom encryption or a simple transform (next step)

3. **XOR / ROL / ROR single-byte pattern detection**:
   ```python
   data = open('sample.bin','rb').read()
   for key in range(256):
       dec = bytes(b ^ key for b in data)
       score = sum(1 for b in dec if 32 <= b < 127)
       if score > len(data) * 0.6: print(f"XOR key=0x{key:02x}, printable={score/len(data):.0%}")
   ```
   - A detection result of "printable rate >60%" → single-byte XOR; hand decryption to [[re-crypto-decrypt]]
   - ROL/ROR: watch the relationship of adjacent ciphertext bytes (`x ^ rol(x)` repeating for the same key); or find a 256-entry rotation table (similar to an S-box, but the values show a cyclic-shift feature)
   - Cryptographic intuition also works: the result of a single-byte transform usually keeps the original distribution features; try the simplest thing first and then escalate (see pitfall 1)

4. **Common algorithm flow features (round count / block)**:
   - In the disassembly/decompile, look for characteristic function shapes: AES has a 10/12/14-round (128/192/256-bit) loop structure + constant-table references (paired with step 1); DES has 16 rounds + permutation tables (a 64-bit block); RC4 has a 256-byte KSA/PRGA loop
   - Data side: **length can only help judge the mode; it cannot distinguish the primitive**. Modes that pad to a whole block, such as ECB/traditional CBC, commonly have ciphertext that is an integer multiple of the block length; but CTR/OFB/CFB based on a block cipher can produce ciphertext of **any length equal to the plaintext** (in NIST SP 800-38A, OFB/CTR allow the last block to be truncated to u bits, and CFB's granularity is the segment size s), and CBC-CTS can also avoid padding expansion. So "arbitrary length" **does not imply** RC4/XOR/ChaCha — the same 37-byte plaintext yields 37-byte ciphertext for `aes-128-ctr/ofb/cfb`, and only `aes-128-cbc/ecb` is 48 bytes
   - Primitive identification relies on **constant tables / round-function shape / key schedule / IV-nonce-counter data flow**: constant-table fingerprints + round count (for example AES 10/12/14 rounds) fix the primitive, and length plus mode features (whether padding is required, whether the IV/nonce changes every time, whether the counter increments) fix the mode. **AES block size is always 128 bits (16 bytes); 192/256 is the key size**, and there is no AES with a "24/32-byte block"
   - When the decompiler has auto-detection, use it first (Ghidra's FindCrypt script / IDA's FindCrypt2) as a cross-check
   - When the decompiler has auto-detection, use it first (Ghidra's FindCrypt script / IDA's FindCrypt2) as a cross-check

5. **Dynamic confirmation (Frida breaks on the crypto function)**:
   - When the static conclusion is ambiguous (several candidates), run the sample inside the sandbox ([[re-sandbox]]) and Frida-hook the suspicious call:
     ```sh
     pip install frida-tools
     frida -p <pid> -l hook.js
     ```
     ```js
     // hook.js: break on the suspected crypto function and print arguments (ciphertext/plaintext) and the return
     Interceptor.attach(Module.findGlobalExportByName("crypt_fn"), {   // Frida 17+: the old form Module.findExportByName(null, ...) was removed
       onEnter(args) { console.log("arg0:", hexdump(args[0])); },
       onLeave(ret)  { console.log("ret:", hexdump(ret)); }
     });
     ```
   - Watch whether an argument is high-entropy ciphertext (matching the offset from step 2) and whether the return becomes readable → confirm that function is the encrypt/decrypt point
   - When the hook target name is uncertain, first use `Process.enumerateModules()` inside `frida -p <pid> -l /dev/stdin` to find a dynamically loaded crypto library
   - Dynamic confirmation feeds the static hypothesis: whichever candidate function actually consumes the ciphertext is the one to use (see the algorithm combination in pitfall 4: confirm the innermost layer first)

## Cross-domain joins

- [[re-protocol]]: step 2 of this gateway's workflow (crypto identification) — the required step when traffic is ciphertext
- [[re-malware]]: C2 communication crypto identification (re-malware step 4: netcap → crypto-id → crypto-keys → crypto-decrypt)
- [[re-firmware]]: algorithm identification for encrypted communication / an encrypted firmware layer inside firmware (paired with the encrypted-layer judgment when [[re-fw-extract]] unpack fails)
- [[re-crypto-keys]] / [[re-crypto-decrypt]]: downstream — after the algorithm is identified, find the key and write the decrypt
- [[re-binary-core]]: decompile corroboration (FindCrypt-class scripts in [[re-ghidra]] / [[re-ida]] / [[re-radare2]]); dynamic confirmation stays inside [[re-sandbox]]
- [[re-anti-analysis]]: unpack a packed sample before a constant-table fingerprint (packer-layer constants pollute the fingerprint)

## Common pitfalls

- **For custom encryption, try a simple mode (XOR) before escalating**: symptom — you spend half a day on an AES fingerprint and it turns out to be single-byte XOR; cause — you assumed a standard algorithm first and skipped the cheap check; fix — finish the single-byte XOR/ROL/ROR detection of step 3 within 30 seconds, then do constant-table fingerprints and round-count analysis (cheap hypotheses first)
- **A hidden table (generated dynamically) → the fingerprint fails**: symptom — the static data section has no AES S-box/CRC table, and you misjudge "not a standard algorithm"; cause — the algorithm generates the constant table dynamically at runtime (a common anti-analysis technique; see the [[re-anti-analysis]] domain); fix — dynamic confirmation in step 5: after it runs, search for the table feature in memory ([[re-memdump]]), or break on the round function with Frida and watch the references
- **An algorithm combination (XOR then AES) must be identified in layers**: symptom — decrypting as AES still yields garbage "plaintext", or the XOR detection printable rate is not high enough; cause — several encryption layers are stacked, and a single-layer hypothesis is incomplete; fix — peel the innermost/outermost layer first (watch which layer, once peeled, drops entropy and raises readability), confirm layer by layer, and record each layer's identification independently before combining them (see the innermost-first principle in step 5)
- **Treating compression as encryption**: symptom — a high-entropy region with entropy >7.0 is handled as encryption, and the decrypt script does not match; cause — zlib/LZMA compression is also high entropy; fix — first see whether the first 2-4 bytes of the high-entropy region have a compression-format marker (gzip header `1F 8B`; `78 9C` is a common zlib CMF/FLG combination, not gzip, and two bytes are not a unique criterion); if so, try `zlib.decompress`/`binwalk` first (see [[re-fw-extract]]) and only then talk about encryption
- **Searching only the S-box misses variant implementations**: symptom — a search for the 256-byte S-box table misses, you misjudge "not AES", and it actually is AES; cause — the implementation uses bitslicing / computes the S-box on the fly (no stored table), but the key schedule often still keeps a 16-byte Rcon table, or it switches to MixColumns multiplication tables (GF(2^8) multiply by 2/3/9/11/13/14); fix — also search the Rcon sequence (`01 02 04 08 10 20 40 80 1B 36 ...`, 0x1B is the characteristic value) and the multiplication-table layout, and cross-check several tables before deciding
- **A fingerprint hit ≠ the crypto function is using it**: symptom — you find an AES S-box/CRC table and spend half a day analyzing that algorithm, but the real business crypto is something else; cause — the constant table may come from uncalled static-library code or packer-layer constants (unpack before fingerprinting; see [[re-anti-analysis]]); fix — after a fingerprint hit you must xref-confirm the table is referenced (who references it, and whether it is on the crypto path), and cross-check round count / constant-table layout / IV-nonce data flow (**do not use ciphertext-length alignment as a primitive criterion**); the dynamic side (step 5) confirms it finally
- **Common signature-pattern cheat sheet**: symptom — signature-algorithm identification is slow; cause — signature algorithms have fixed pattern families; fix — match quickly by pattern: HmacSHA256(sorted_params, key) is the most common; MD5(params + salt + timestamp) is older systems; AES(JSON.stringify(params), key) is encryption rather than a signature; RSA sign is uncommon (mostly finance-class)
  (source: reverse-skill field-journal, MIT)

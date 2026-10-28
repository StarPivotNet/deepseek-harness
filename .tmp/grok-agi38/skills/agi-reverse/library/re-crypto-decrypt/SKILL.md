---
name: re-crypto-decrypt
description: >
  Encrypted-data recovery: locate the decrypt function, write a decrypt script.
  Triggers: `解密`, decrypt, `还原数据`, `解密流量`
capabilities: [crypto-decryption]
---

# Encrypted-data recovery

## When to use / when not to use

- Use: you need to turn ciphertext (a data blob / traffic / a config section) back into plaintext
- Use: the algorithm and the key are known (or already produced by [[re-crypto-id]] / [[re-crypto-keys]]), and you need batch decryption
- Use: recover the decrypt logic from the sample and rewrite it as a standalone reusable script
- Do not use: both the algorithm and the key are unknown (do [[re-crypto-id]] → [[re-crypto-keys]] first)
- Do not use: statically readable plaintext ([[re-triage]] low entropy, read it directly)
- Do not use: you want to run the original sample and watch the output (that is [[re-behavior]] / [[re-sandbox]]'s job — a decrypt script exists so you can reproduce it without the sample)

## Tool preparation

Verify every tool before use. This skill works on dump/decompile artifacts and ciphertext data; running the sample stays inside [[re-sandbox]] ([[re-analyze/platform-tips]] supreme rule).

### python3 + pycryptodome — the primary decrypt-script stack

- Linux: `apt install python3 python3-pip` / `dnf install python3 python3-pip` / `pacman -S python python-pip`
- macOS: `brew install python`
- Windows: the python.org installer (check Add to PATH); the Linux build inside WSL
- Crypto library: `pip install pycryptodome` (standard algorithms such as AES/DES/RSA/ChaCha)
- Verify: `python3 -c "from Crypto.Cipher import AES; print('ok')"`; `python3 --version`

### Target-program dump / decompile artifacts — the basis for recovering the algorithm

- Dump: the [[re-memdump]] default dump (gcore) — locate the ciphertext input point and the decrypt-call scene
- Decompile: artifacts from [[re-ghidra]] / [[re-ida]] / [[re-radare2]] (the function decompile view)
- Verify: `file out` is an ELF core; the target function can be found in the decompiler (`ghidra` / `rizin` can start)

### angr (optional) — symbolic execution fills in logic that is hard to recover

- All platforms: `pip install angr` — **Python version compatibility follows "Tool preparation" in [[re-angr]]** (the version matrix is maintained in only that one place, to avoid drift); the dependency set is large, so a venv is recommended: `python3 -m venv venv && venv/bin/pip install angr`
- Verify: `venv/bin/python -c "import angr; print(angr.__version__)"`
- Use: when decompile branches explode / obfuscation is severe, use symbolic execution to solve the crypto function's output (load the target binary → set the ciphertext input as a symbol → constraint solve)

## Procedure

Run in order and record each step. Precondition: the algorithm ([[re-crypto-id]]) and the key ([[re-crypto-keys]]) are confirmed, or at least one side has a candidate; archive the script and the verification result (a plaintext sample + sha256) for the report to cite.

0. **Falsify "ciphertext": locate the real ciphertext boundary first** (skipping this step is the most common way crypto analysis fails):
   - A high-entropy stretch may be "fake ciphertext" — a container/compressed data stream was mistaken for an encryption layer (for example a zip data body, or a compressed stream appended after an image). Compressed data is also entropy 8.0 and cannot be distinguished from encryption
   - First observe the overall structure: file-header/tail magic, the distribution of format markers (JPEG statistics size segment by segment), and use a known structure at the tail as an anchor (a zip EOCD's `cd_offset`/`cd_size` infers the data start backward; the EOCD signature is known plaintext)
   - **Do not fix a format boundary with a bare first/last marker search**: a marker byte pair can legally appear inside a payload — PNG's `IEND` text can land inside a tEXt chunk's data, and JPEG's `FF D9` can land inside a length-delimited segment such as APP1 (taking the first hit as the end truncates legal data). The correct approach is to parse per the format spec: PNG starts at the 8-byte signature and walks chunk by chunk as `Length/Type/Data/CRC` until a structurally legal `IEND` whose length is 0 (verify the CRC per chunk when needed); JPEG starts at `SOI` and parses by marker/segment, and after entering `SOS` handles `FF00` stuffing and the `RSTn` rules; only an **`EOI` that is valid at a syntactic position** is the end. A bare byte search can only produce candidate positions, and a candidate can fix the boundary only after a structural check
   - Compare the tail 16 bytes / the whole-file hash of same-size files first — a "header-swapped copy" (a second wrapping of the same payload, differing only in the header) saves an entire branch
   - Compression ratio is a signal: a layer that grows clearly after decompression means the contents have structure (compressible = encoding/plaintext); close to 1:1 means the inner layer is already compressed or encrypted
   - Enter the ciphertext location of step 1 only after confirming it is an isolated high-entropy blob

1. **Locate the decrypt function (cross-reference the ciphertext input point)**:
   - Start from the ciphertext offset: the high-entropy-region offset from [[re-crypto-id]] step 2 → in the decompiler, find the function that reads that offset / that global → follow the call chain to who wrote it (the writer is often the decrypt function)
   - Start from an API: the `Crypt*`/`EVP_*` call site found in [[re-crypto-keys]] step 4 is a candidate; watch whether the ciphertext pointer in the arguments points at the offset from step 2
   - Dynamic aid: [[re-gdb]] / [[re-x64dbg]] break on the candidate function (inside the sandbox) and print arguments/return values, confirming it outputs readable plaintext
   - No clear function → the ciphertext may be handled by an inlined algorithm (no call boundary); go back to [[re-crypto-id]] and locate it by data features (where a constant table is referenced)

2. **Recover the algorithm from the decompile**:
   - Transcribe the decompile view section by section into pseudocode, and make explicit: the algorithm (AES-CBC / a custom XOR…), where the key and IV come from (a fixed value / derived / context), and the mode and padding (where CBC's IV is, PKCS7 or zero padding)
   - A custom algorithm: translate bitwise operations one by one (XOR / shift / table lookup), and watch endianness (the same idea as [[re-proto-rev]] pitfall 1 — try both endiannesses for length/key fields first)
   - When recovering a standard algorithm, watch the details: whether AES uses CBC or ECB, whether the key length is 16/24/32, and whether the IV reuses the key (a common wrong implementation; see pitfall 1)
   - A loop/table-lookup that the decompile cannot show clearly → angr symbolic execution as a fallback (build a solve script and treat the function as a black box to get the output)

3. **Rewrite it as a standalone script (python)**:
   ```python
   # decrypt.py — rewritten from the algorithm recovered in the decompile
   from Crypto.Cipher import AES
   import sys
   key = bytes.fromhex("...")          # from [[re-crypto-keys]] step 1/2/5
   iv  = key[:16]                       # the sample's implementation: IV = the first 16 bytes of the key
   data = open(sys.argv[1], 'rb').read()
   pt = AES.new(key, AES.MODE_CBC, iv).decrypt(data)
   print(pt)                            # or write a file + a later check
   ```
   - Parameterize the script (key/IV/input file come from arguments or config); write it right once and reuse it — for batch-decrypting traffic
   - The key point: the script logic must match the sample (padding handling, tail truncation); when it does not match, go back and check the boundary conditions (see pitfall 1)

4. **Verify with known plaintext**:
   - Known-plaintext sources: a protocol-header magic (such as `\xAA\x55`), a file header (`PK` zip / `\x89PNG`), a message field (the fixed header in [[re-proto-rev]] step 2), or a plaintext string observed in [[re-behavior]] behavior
   - How to verify: a known-plaintext fragment can be found in the decrypt output → success; if not → check in order: whether the key/IV is right (try [[re-crypto-keys]] candidates one by one), endianness, padding handling, and whether there is still an outer encryption layer (see pitfall 3)
   - When there is no known plaintext, verify by "readability": an output printable rate >70%, or `file -` recognizing a format (PDF/zip/text) → treat it as a successful candidate

5. **The traffic case: decrypt a plaintext traffic stream**:
   - After [[re-crypto-id]] / [[re-crypto-keys]] have confirmed the traffic encryption algorithm and key, extract the ciphertext payload from the pcap ([[re-netcap]] step 3 tshark export):
     ```sh
     tshark -r c2.pcap -Y 'tcp.payload' -T fields -e data.data | sed 's/://g' | xxd -r -p > payloads.bin
     ```
   - Write a batch script: split by flow (one stretch per TCP flow), call the decrypt logic on each stretch (the same script as step 3), and write a plaintext-stream file
   - Verify: the plaintext stream shows protocol structure (a session sequence number / a command word), then go to [[re-proto-rev]] to rebuild the state machine
   - Watch session-key changes (re-derived on every handshake) → the script takes the matching key for each session (the derivation recovery in [[re-crypto-keys]] step 5)

## Cross-domain joins

- [[re-protocol]]: step 4 of this gateway's workflow (decrypt) — where the encrypted-communication chain lands (crypto-id → crypto-keys → crypto-decrypt → proto-rev)
- [[re-malware]]: C2 traffic decryption — re-malware step 4; the recovered plaintext (commands/config) goes to behavior judgment and IOCs ([[re-ioc]])
- [[re-firmware]]: decrypt an encrypted firmware layer / encrypted communication — paired with encrypted-layer handling when [[re-fw-extract]] unpack fails
- [[re-crypto-id]] / [[re-crypto-keys]]: upstream — the input source of the algorithm and the key
- [[re-memdump]]: locating the ciphertext input point and the decrypt-call scene (the dump artifact)
- [[re-anti-analysis]]: when decryption is inside a packer, unpack first (see pitfall 2); [[re-gdb]] / [[re-x64dbg]] dynamically help confirm function behavior
- The recovered plaintext goes to [[re-proto-rev]] to rebuild the state machine, or continues per the [[re-firmware]] / [[re-malware]] flow

## Common pitfalls

- **The recovery script disagrees with sample behavior → go back and check boundary conditions (length/padding)**: symptom — the plaintext the script decrypts differs from the sample's own output (extra/missing bytes, garbage at the tail); cause — boundary conditions were not aligned: padding style (PKCS7/zero), whether the length field includes padding, whether the IV changes per packet, and whether the ciphertext tail is truncated; fix — check the padding and length-handling code line by line in the decompile, implement it explicitly in the script, then go back to step 4 and verify with known plaintext
- **Decryption is inside the packer → unpack first**: symptom — no decrypt function can be found in a packed sample, or the function you found is only the packer's decompression; cause — the ciphertext data / decrypt logic is wrapped by the packer, and statically you see the packer's initial state (the same idea as [[re-memdump]] pitfall 2); fix — unpack with [[re-anti-analysis]] first (time the dump by plaintext/code materialization; do not treat the OEP as a universal criterion), and locate again on the unpack artifact
- **A multi-round decrypt chain**: symptom — after the first layer is decrypted it is still garbage / high entropy (entropy 7.0+); cause — several encryption layers (XOR then AES, or nested compression + encryption; see [[re-crypto-id]] pitfall 3); fix — verify each layer on its own (decrypt one layer and measure entropy and readability once), and recover layer by layer; "entropy dropped, so advance one layer" can be the stop condition
- **The wrong key/IV order decrypts to garbage**: symptom — known-plaintext verification fails, but the algorithm is definitely AES; cause — key/iv argument order (whether the sample concatenates key||iv or passes them separately), key endianness, or a reused IV / a fixed IV; fix — turn the [[re-crypto-keys]] candidates (including endianness variants and common wrong-implementation variants such as IV = a key prefix) into a parameter-combination loop and try them; a hit is decided by readability / known plaintext
- **A restricted symbol set = encoding, not encryption (fake encryption)**: symptom — entropy is 7.9+ but the byte value range is clearly restricted (for example only 66 symbols, a uniform distribution, no period), and xortool/IC is flat for every key length; cause — this is "encoding + single-byte XOR": **single-byte XOR does not change the frequency distribution or the symbol set** (it only shifts values); multi-byte XOR is what scatters symbols into 256 values; fix — collect the full set of symbol values and XOR-match it against a known character set (compare sets for 256 keys; milliseconds; do not brute-force): Base64's 64 characters + `\n` + `=` = 66 symbols, Ascii85 is 85, hex is 16, and so on; after a hit, XOR-recover → decode; cross-check: a padding character (for example `=` appears only once, at the end of the file, after encryption), newline frequency, and magic after decode
- **xortool/IC results that are all flat = a signal to change approach**: symptom — every key-length candidate is about 10-20% with no standout peak; conclusion — statistically there is no periodic structure, and multi-byte repeating-key XOR is basically ruled out; do not keep running with different parameters; fix — go back and observe the data itself (value range / symbol set / entropy); it is usually an encoding layer or a one-time keystream (a stream cipher)
- **Fake ciphertext is confirmed but there is more than one layer → layered-peeling discipline**: after each layer is peeled, verify artifact completeness with magic/readability before entering the next layer; keep and name every intermediate artifact (so you can roll back); entropy does not drop / the result is still high entropy = there is still an outer layer (for example Base64 outside XOR, then compression)
- **Pixel-level XOR (visual cryptography / image steganography)**: symptom — two "random noise" images, and the challenge says to overlay them; cause — visual cryptography splits the information into two shares, and it becomes visible after XOR (or ADD) of the pixels; fix — `ImageChops.logical_xor` or numpy `a^b` XORs the two images pixel by pixel (three RGB channels); the result is often "a 99.5% pure-white background + extremely light-gray text" (text 254 vs background 255) — looking at it directly / inverting colors both fail to show it; **enhance with a threshold**: `==255 → black, everything else → white`, and the text appears immediately; for small bitmap glyphs, cut them on a character grid (5x7) and read them glyph by glyph, and verify repeated characters with a pairwise bitmap-similarity matrix (for example the repeat pattern of `d562333d`)
- **Saturating ADD is a close relative of XOR**: symptom — the XOR result has no content; cause — the share may have been generated by additive secret sharing (XOR yields noise, and ADD/SUB is what produces the image); fix — also try saturating addition `clip(a+b)` and subtraction `a-b`, and compare several operation combinations
- **Heavy obfuscation on a new version → locate it by walking back to an old version**: symptom — after obfuscation the latest version's core function is abnormally huge, IDA analysis stalls, and forcing it is unrealistic; cause — an earlier version of the same SDK did not have heavy obfuscation, and the core logic is clearer; fix — by a behavior feature (for example "agreeing to the privacy policy triggers collection"), install a historical package (channels such as Wandoujia) → tap agree → capture and confirm the earliest version where that parameter appears; pick a version whose behavior is regular as the analysis start (easier to debug: both spawn and attach can reproduce it); the logic recovered from the old version in turn guides confirming which parameters the new version collects
- **Segmented / layered encrypted reporting (each segment uses a different algorithm)**: symptom — every field of a captured report request looks like ciphertext on its own, but decrypting all of them with one algorithm is garbage; cause — the client encryption flow is split into several segments: **single-field encryption → segmented encryption → whole-message encryption**, and each segment's algorithm/key differs (for example the first layer uses a random number as the key and encrypts byte by byte, the second layer uses a fixed key, and the third layer concatenates combined fields and encrypts again); and a field itself may be a device-collected risk feature (collected by an svc instruction, a field of the `r_1_0` class); fix — peel layer by layer under the "verify each layer on its own" discipline (entropy drops / it becomes readable, so advance one layer; see the multi-round decrypt-chain pitfall); note that a same-source SDK's "whole-message encryption" may wrap another VM-ized algorithm (about 70 handles simulating basic instructions; when the handles are not obfuscated, identify each instruction's semantics one by one); key sources split into random (a capture cannot reproduce it) and fixed (findable statically); do fixed first, then random
- **Double AES + encrypted strings (key/iv are also stored encrypted)**: symptom — after confirming AES, a direct decrypt still fails, or key/iv change every session; cause — a common implementation pattern: the first layer's key/iv are fixed (**hardcoded in the so as encrypted strings, and recovered at runtime by a decrypt function**), and the second layer's key/iv change every time; between the two encryptions a fixed prefix is concatenated (such as `03000001`) and then it enters the same function; and encrypt and decrypt may be the same function (a flag controls the direction); fix — hook the decrypt function's return and batch-export every decrypted string (an encrypted string memcpy'd before JNI_OnLoad → a global → the decrypt function), and search key/iv directly among them; to find the encrypt point, scan characteristic constants with findcrypt (the AES S-box and similar) → xref to the function that checks the key/iv length (16); a dynamic hook prints data before and after the two calls and compares them to verify

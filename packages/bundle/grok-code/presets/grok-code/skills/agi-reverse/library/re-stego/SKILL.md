---
name: re-stego
type: atomic
description: >
  Steganography detection and extraction: appended file tails, image LSB, audio and other carriers, extraction checks.
  Triggers: `隐写`, stego, LSB, `文件尾附加`, `隐写提取`, `图片隐写`.
capabilities: [stego-detection]
---

# Steganography detection and extraction

## When to use / when not to use

- Use: a steganography suspicion (a CTF challenge / a forensics object), an unusual file tail, or an unusual image or audio file (size / noise / a file structure that does not match)
- Use: a broken file structure (data after IEND / an oversized EXIF segment / a pixel count that does not match the file size)
- Use: a multi-carrier combination (common in challenges and forensics — each file hides one piece)
- Use: a forensics scan of unallocated space or filesystem residue (together with [[re-disk-forensics]])
- Do not use: ordinary file analysis (each domain has its own skill); decrypting encrypted data (ciphertext ≠ steganography; payload decryption goes to [[re-crypto-decrypt]]); identifying an unknown file type ([[re-triage]] first)
- Do not use: an aimless scan with no carrier clue (have a suspicious feature first; see [[decision-tree]])

## Tool setup

### zsteg (image LSB scan)

- All platforms: `gem install zsteg` or the source (GitHub)
- Check: `zsteg -h` or `gem list zsteg`
- Coverage: PNG/BMP are well supported; GIF support is limited — a GIF carrier uses the python-script path

### steghide (image / audio steganography)

- Linux: `apt install steghide` / `dnf install steghide`; macOS: `brew install steghide`
- Check: `steghide --version`; `steghide info file.jpg` (see whether data is embedded; no password required)

### binwalk (tail scan)

- Install and check as in the tool setup of [[re-fw-extract]]

### Other detection / extraction tools

- exiftool (EXIF / metadata): Linux `apt install libimage-exiftool-perl` / `dnf install perl-Image-ExifTool`; macOS `brew install exiftool`; check `exiftool -ver`
- pngcheck (PNG structure check / anomalies): Linux `apt install pngcheck`; macOS `brew install pngcheck`; check `pngcheck -v`
- sox (audio processing / spectrogram): Linux `apt install sox`; macOS `brew install sox`; check `sox --version`
- foremost (data carving, forensics): `apt install foremost` / `brew install foremost`
- stegsolve (bit-plane viewer, Java GUI): download the jar from GitHub (`java -jar stegsolve.jar`)
- outguess (JPEG DCT domain, an old tool): Linux `apt install outguess`
- ffmpeg (audio format conversion, optional): `apt install ffmpeg` / `brew install ffmpeg`
- python3 (bit operations / check scripts + PIL): install as in [[re-python]]; `pip install pillow`; check `python3 -c "from PIL import Image"`

## Steps

Run in order. Archive each product (path + sha256; see [[re-triage]]).

1. **Appended-tail detection**:
   ```sh
   binwalk sample.png | tail -20       # 附加数据扫描
   hexdump -C sample.png | tail -10    # 尾部目检
   ```
   - An appended tail: the file looks normal but the tail has extra data (this continues the appended-tail experience, the patch-authoring idea in [[re-patching]])
   - Structure check: `pngcheck -v sample.png` shows the gap between the IEND position and the end of the file (the difference ≈ the amount of appended data)
   - A quick scan for a weak clue: `strings -a sample.png | grep -iE 'flag|ctf|http'`
   - Size check: a size that clearly does not match the claimed content (for example a 3MB "small image") is a weak clue
   - Extract: binwalk splits automatically, or dd extracts by offset (`dd if=sample.png of=tail.bin bs=1 skip=<offset>`) → a magic check ([[re-triage]])
   - EXIF: `exiftool -a sample.jpg` (list every segment; an unusual field or a large comment is suspicious)
   - Other redundant regions: EXIF metadata (view with exiftool), reserved header areas, unused space in a compressed file

2. **Image LSB**:
   ```sh
   zsteg sample.png                    # 全通道 LSB 扫描
   zsteg -E 'b1,rgb,lsb,xy' sample.png # 指定通道/位平面提取
   ```
   - Channels: the least significant bit of each RGB/alpha channel; bit planes: b1/b2 (the low 2 bits) — the alpha channel is often used for hiding too
   - Common zsteg flags: `-a` scans every channel, `-v` is verbose, `-E` selects the extraction. Reading the output: a `b1,rgb,lsb,xy` line is that plane's extraction; all `failed` ≈ no steganography on that plane
   - Order: row order and bit order change the extraction (see pitfall 1; the combinations to enumerate are in the extraction-failure branch of [[decision-tree]])
   - The script path when there is no tool: python3 + PIL walks pixels and extracts the bit sequence (`getpixel` takes the low bit of a channel → assemble a bit sequence → turn it into bytes; the order pitfall is in [[gotchas]])
   - Script enumeration template: a triple loop of row order × bit order × channel. Each combination writes a file and is checked with `file`
   - stegsolve bit-plane viewer (GUI): compare several plane images and look for a visual pattern (common in LSB image steganography)

3. **Other carriers**:
   - Audio: spectral steganography (sox spectrogram: `sox in.wav -n spectrogram -o out.png`, then inspect the frequency-domain pattern), steghide extraction (`steghide extract -sf file.wav`), phase / echo steganography
   - Audio branch: look at the waveform / spectrum first (a frequency-domain pattern shaped like text or a QR code → spectral steganography), then split time domain (LSB-class, steghide) from frequency domain (phase / echo, which needs a dedicated tool)
   - Image DCT domain (JPEG): outguess-class tools (old; limited support for newer formats; see [[gotchas]])
   - File redundant regions: EXIF, reserved header areas, unused space in a compressed file (CRC / unused space inside a ZIP)
   - Other carriers: text (whitespace / line spacing), web pages (comments / hidden tags) — extend by scenario
   - Multi-carrier combinations (common in challenges): concatenate fragments from each file (by order or by a feature; the metadata first look is in [[re-triage]])

4. **Extraction check**:
   - Magic check (header features of the extract)
   - Readability check (strings/file)
   - Re-check the extract: the extracted file may hide something again (nesting) — run the full flow on the extract. If it is a script or an archive, continue in that domain ([[re-script-deob]] / [[re-python]] and the rest)
   - Check product: the extract's `file` type matches the expectation before calling it "confirmed embedding" (the grading table is in [[decision-tree]])
   - Compression before steganography: extract first, then decompress (look for a compression header on the extract — zlib `78 9C` / gzip `1F 8B` / bzip2 `42 5A 68`; see pitfall 3)
   - An encrypted payload: with no key, mark it not extractable (do not brute-force it). A key clue goes to [[re-crypto-decrypt]]

## Cross-domain handoff

- [[re-ctf]] gateway: this skill belongs there
- [[re-fw-extract]]: binwalk is reused
- [[re-patching]]: the appended-tail experience continues here
- [[re-triage]]: first look at the extract
- [[re-crypto-decrypt]]: payload decryption continues here
- [[re-disk-forensics]]: unallocated space / filesystem-side steganography (forensics)

## Pitfalls

- **LSB order**: symptom — the extract is garbage; cause — row order (top to bottom / bottom to top) / bit order (LSB first / MSB first); fix — the tool tries automatically, or a script enumerates the combinations
- **A multi-carrier misread**: symptom — several steganography layers in one file; cause — nested steganography; fix — extract layer by layer and check each layer
- **Compression before steganography**: symptom — the extract is garbage; cause — the plaintext was compressed and then embedded; fix — look for a compression signature first (zlib/gzip/bzip2 header) and then decompress
- **Tool-output noise**: symptom — a large number of candidates; cause — the scan output includes false positives; fix — filter by magic and readability
- **The carrier itself is broken**: symptom — the file is corrupt; cause — the steganography write damaged the structure; fix — repair first, or tolerate the damage (bit extraction does not depend on the structure)
- **JPEG lossy confusion**: symptom — an LSB extract is noise; cause — JPEG lossy compression overwrote the bit planes (LSB-class steganography is mainly for PNG/BMP; JPEG uses the DCT domain); fix — identify the format first (pngcheck) and then pick the method
- **An entropy false positive**: symptom — the scan reports "steganography present" but there is no content; cause — compressed or random data is naturally high entropy; fix — entropy is only a suspicion clue, not a conclusion by itself (the grading is in [[decision-tree]])
- **A steghide password**: symptom — extraction with no password fails; cause — a passphrase is required (CTF challenges often give a hint); fix — try with no password first, then follow the hint or a key clue. If there is none, mark it
- **A single tool's blind spot**: symptom — zsteg finds nothing but steganography is present; cause — the tool covers only some channels and algorithms; fix — cross-check zsteg + steghide + a script
- **Carrier-copy differences**: symptom — the same file from different sources scans differently; cause — a copy was transcoded or recompressed; fix — use the original carrier (check the hash; see [[re-triage]])
- **A challenge or scenario hint was ignored**: symptom — a long scan of the image, while the payload is actually in a companion file; cause — the multi-carrier hint was not read; fix — read the hint first and split carriers by the hint
- **A compression layer confused with a steganography layer**: symptom — the randomness of compressed data is treated as a steganography clue; cause — compressed content is naturally high entropy; fix — decompress first and then analyze the content (compression is not steganography)
- **Three branches for garbage**: symptom — something was extracted but it looks like garbage; cause — it may be compression, encryption, or the wrong order, or it may just be random padding; fix — follow the extraction-failure branch of [[decision-tree]] by compression header, readability, and statistical distribution
- Detection / extraction branches and evidence grading are in [[decision-tree]]. Limits and counterexamples are in [[gotchas]]

# Steganography method pitfalls and limits

## Detection

- **Entropy false positives**: compressed data and random padding are naturally high entropy. Entropy alone is only a clue — merge it with a structural anomaly (the grading table in [[decision-tree]])
- **JPEG lossy confusion**: LSB-class steganography basically applies only to PNG/BMP (lossless). JPEG recompression destroys bit planes — confirm the format before picking a method, and do not spend time on LSB for a JPEG
- **Tool version differences**: zsteg/steghide default channel enumeration differs between versions (for example b1 bit order, and whether alpha is scanned by default) — rescanning with another version or extra flags is a common fix
- **A forged signature**: a normal file header does not mean the whole file is normal (appended data can be disguised as a comment block or metadata) — check the structure segment by segment (pngcheck for the IEND position, the EXIF segment length)
- **Not detected ≠ absent**: steganography can hide in an unusual order, a new carrier, or multi-carrier fragments — "not detected" must include the list of methods already used

## Extraction

- **Order combinations explode**: row order × bit order × channel × bit plane is a large set — try the tool default first, then enumerate common combinations (zsteg `-E` variants), and only then a full script enumeration
- **Compression before steganography**: plaintext that was deflate/gzip'd before embedding comes out as garbage — check the extract for a compression header first (zlib `78 9C`, gzip `1F 8B`, bzip2 `42 5A 68`). Common in CTF
- **Encryption before steganography**: an encrypted payload with no key cannot be extracted — look for a key clue in the challenge or the scene (a password hint, a file in the same batch). If there is none, mark it. Do not brute-force it
- **Overlapping carriers**: several steganography layers in one file, or fragments across files — check each layer's extract on its own. Concatenate fragments by a feature (tail offset / sequence number / content continuity)
- **A damaged embed**: a partial write or carrier processing corrupts the extracted data — tolerate the damage (a partial magic match, a readable fragment), repair the carrier, and extract again

## Carriers

- **A damaged carrier**: the steganography write broke the file structure (a bad PNG / unusual EXIF) — repair first (pngcheck locates the damage) or extract by bits without depending on the structure
- **EXIF noise**: a comment or thumbnail inside an EXIF segment can be reported as appended data — use exiftool to list the metadata segments and separate "legal metadata" from "an appended payload"
- **A compressed carrier**: unused space and the CRC field inside a ZIP/RAR file are steganography sites — unpack first and compare the original size and checksum (binwalk scans offsets inside the container)
- **The JPEG DCT domain**: JPEG steganography lives in DCT coefficients, and bit-plane tools do nothing — use an outguess-class tool or DCT-coefficient statistics (JPEG steganography detection needs recompression analysis; mark it when that is beyond the basic flow)

## Notes

- Forensics: the authorized scope (carrier / data class) comes first. Archive product sha256 (the [[re-triage]] first look + the [[re-analyze/analysis-contract]] delivery)
- CTF: shrink the scope from the challenge hint (carrier type / an order hint / a key hint). Do not spend the time on a full enumeration
- This skill covers file carriers (images / audio / file redundant regions / unallocated space). Steganography on the network-protocol or traffic side is not this skill (assess it in [[re-netcap]] / [[re-proto-rev]])

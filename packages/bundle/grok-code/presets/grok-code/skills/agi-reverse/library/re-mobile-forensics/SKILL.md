---
name: re-mobile-forensics
type: atomic
description: >
  Mobile-device forensics: Android/iOS backup parsing, app-data extraction, deleted-data recovery, and timelines.
  Triggers: `移动取证`, `手机取证`, `ADB备份`, `iTunes备份`, `手机数据提取`.
capabilities: [mobile-forensics]
---

# Mobile-device forensics

## When to use / when not to use

- Use: data extraction from a device backup/image, app-data forensics, deleted-data recovery, timeline rebuild
- Use: parsing where app data lands on disk (database/preferences/cache) — understanding app structure is paired with [[re-mobile]]
- Use: point-in-time comparison forensics (data change before/after a backup / comparison of deleted records)
- Use: a light targeted extraction (one app, one table — a direct run-as / single-app backup, not a full dump)
- Use: assessing whether deleted data is recoverable (judge first, then act, and avoid wasted time)
- Use: when the device is already offline/damaged (the backup file can still be parsed — backup parsing does not depend on the device being online)
- Do not use: app reversing ([[re-mobile]]); general filesystem analysis ([[re-disk-forensics]]); dynamic extraction of a running process ([[re-frida]])
- Do not use: cloud backup / cloud-sync data (the Google/iCloud cloud side is not this skill; the forensics scope needs separate authorization)
- Do not use: an unauthorized device (red line: authorized devices only; device isolation and preservation principles are in [[gotchas]])

## Tool setup

### adb (Android device interface)

- Linux: `apt install adb` / `dnf install android-tools`; macOS: `brew install android-platform-tools`; Windows: official platform tools
- Verify: `adb --version`; `adb devices` needs USB debugging on and authorized (confirm the on-screen prompt)

### libimobiledevice (iOS device interface)

- Linux: `apt install libimobiledevice-utils`; macOS: `brew install libimobiledevice`; Windows: official build
- Verify: `idevice_id -l` (lists devices)

### Backup-parsing tools

- Android: abe (Android Backup Extractor, a Java jar, GitHub `nelenkov/android-backup-extractor`: `java -jar abe.jar unpack backup.ab backup.tar`) or an equivalent python script; verify: `java -jar abe.jar --help` (needs Java; install via [[re-java]])
- iOS: `idevicebackup2` + manifest parsing (see step 2)
- sqlite3 (database reads — Linux: `apt install sqlite3`; macOS: `brew install sqlite3`; Windows: official build); verify: `sqlite3 --version`
- foremost (data carving — Linux: `apt install foremost`; macOS: `brew install foremost`); verify: `foremost -h`
- python3 (parsing scripts): install via the tool setup in [[re-python]]

## Procedure

Run in order. Device operations follow the authorization boundary (red line: authorized devices only). Forensics order: isolate (disconnect / airplane mode) → record device state (version / unlock / encryption / network) → prefer a read-only extraction → archive products. Archive each step's products (path + sha256, see [[re-triage]]); remote-wipe and preservation detail is in [[gotchas]].

1. **Android extraction**:
   ```sh
   adb backup -f backup.ab -all        # full backup (the app must allow backup)
   adb backup -f app.ab -apk -noobb com.target.app   # single-app backup (by package name)
   adb shell run-as com.target.app ls data   # app sandbox (a debuggable app)
   # rooted device: dd an image of key partitions / adb pull /data for a direct extraction
   ```
   - Backup-feasibility precheck: `adb shell bmgr list transports` (confirm the system backup service is available; no output / an error → adb backup is unavailable, switch path)
   - Device-state record: version (`adb shell getprop ro.build.version.release`) + encryption/unlock state (affects the later parse path)
   - The state of `adb backup`: officially deprecated from Android 12. App data with targetSDK 31+ is no longer exported (only targetSDK<31 or a debuggable app works; new Play Store apps are basically unusable) — when it fails, switch to root/image extraction (the criterion is in [[decision-tree]])
   - ab format: magic `ANDROID BACKUP` + version/flag bytes (compression/encryption bits) + optional AES-256-CBC encryption parameters + a tar (optionally deflate-compressed) payload
   - Backup parsing: ab header → unpack the tar (an encrypted backup needs the backup password; with no password, mark it not extractable); `file backup.ab` first to check the magic and the size
   - Where products go: a separate directory + a name that includes the device id/time (so several devices are not mixed up)
   - Parse playbook: `abe unpack backup.ab backup.tar` (for an encrypted backup the password is the trailing positional argument: `abe unpack backup.ab backup.tar <password>`, or set the `ABE_PASSWD` environment variable) → `tar tf` lists contents → sqlite3/plist analysis
   - App sandbox: `run-as` (debuggable) / a rooted device reads directly; an app with `allowBackup=false` backs up empty and with no warning (see pitfall 2)
   - A binary-safe pull with run-as: `adb exec-out run-as com.target.app cat files/x.db > x.db` (exec-out does not do terminal escaping)
   - Root-image note: look up the partition table first (`adb shell ls /dev/block/by-name/` or `cat /proc/partitions`) and then dd the target partition; the image product is large. Confirm disk space first
   - A hardware Keystore key cannot be exported through a backup (bound to device hardware; mark the limit)
   - Database extraction → sqlite3 (the SQLite page-structure method in [[re-disk-forensics]])

2. **iOS extraction**:
   ```sh
   idevicebackup2 backup ./backup_dir
   # backup layout: Manifest.plist (metadata) + Manifest.db (file index) + files split into directories by fileID
   ```
   - Backup layout: Manifest.db (SQLite file index: domain/relative path → fileID, iOS 10+; earlier versions are Manifest.mbdb), Manifest.plist (backup metadata: IsEncrypted/BackupKeyBag/ManifestKey/device info), Info.plist (device info), Status.plist (backup state), files named by fileID (fileID = SHA1(domain + "-" + relativePath), derived from the path and unrelated to the content; see the parsing pitfall in [[gotchas]])
   - The first connection needs trust on the device side (Settings > General > device management / trust this computer) — when it is not trusted, idevice_id prints nothing
   - Encrypted-backup judgment: read the `IsEncrypted` key in Manifest.plist (under an encrypted backup, Manifest.plist is still readable in the clear, and the key material BackupKeyBag/ManifestKey is in it); what is encrypted is Manifest.db and each file's contents — decrypt with the backup password (with no password, mark it not extractable)
   - Keychain data is in keychain-backup.plist and also needs the backup password to decrypt (the key is derived from the password, tools differ a lot, and you follow the actual tool's docs)
   - App-data paths: Library/Preferences (plist preferences), Documents (user data), Caches (cache), Library/Application Support (a common place for databases) — understanding app structure is in [[re-mobile]]
   - Extraction priority: database > preferences > cache (the cache may contain residue of deleted content)
   - Backup integrity check: check item by item against the Manifest.db index — the fileID file for each domain/relative path actually exists. When the index and the files disagree, mark it
   - Choosing backup vs live extraction: prefer a backup (it does not touch the device, and evidence integrity is better); when the latest state is needed, extract live and record the operation time
   - When a local backup already exists, parse the default directory directly: `~/Library/Application Support/MobileSync/Backup` (each device has its own subdirectory; check the UDID so devices are not mixed)

3. **Deleted recovery and timeline**:
   - SQLite deleted records: freelist pages / WAL pages not checkpointed / unallocated-page residue — confirm journal_mode first (WAL/delete/journal) and then pick the recovery path. The method is the database file format in [[re-disk-forensics]]
   - Data carving: foremost recovers unallocated space by file signature (images/archives/database pages); the default covers common signatures (jpg/png/zip), and a custom type uses a config file (`-c`); verify recovered objects with magic/readability (the [[re-triage]] survey)
   - Encrypted-device note: under Android FBE/full-disk encryption, unallocated pages are ciphertext and carving does nothing — prefer the already-decrypted file path inside the backup/image (see pitfall 8)
   - Timeline rebuild: file timestamps + database record times (normalize to UTC first, and mark the device timezone — pitfall 4) + the Status.plist backup moment (corroboration)
   - Cross-check recovered data: when the same record appears in several databases (for example a chat database + an index database), cross-compare them to raise confidence
   - Output: a timeline table (time/action/source) + recovered data (archived by app/data type); timeline evidence grading is in [[decision-tree]]

4. **Evidence integration and delivery**:
   - Summary: the timeline table + the extract list (source / extraction method / confidence for each data class) + the method record
   - Deliver conclusions in the review format of [[re-analyze/analysis-contract]] (conclusion / evidence / confidence); deleted recovery carries the "partial recovery" qualifier

## Cross-domain

- [[re-forensics]] gateway: this skill belongs there
- [[re-disk-forensics]]: SQLite structure / WAL / deleted-recovery method
- [[re-mobile]]: understanding app structure (sandbox paths / data structures)
- [[re-frida]]: live dynamic extraction (this skill is the static/backup side; the two complement each other)
- [[re-triage]]: product survey (type/magic/hash)
- [[re-mem-forensics]]: handoff for device memory-dump analysis (a rooted device can dump memory)
- [[re-analyze/analysis-contract]]: conclusion delivery format

## Common pitfalls

- **An encrypted backup with no key**: symptom — the backup cannot be parsed; cause — AES encryption; fix — with no password, mark it not extractable. Do not brute-force it (authorization boundary)
- **ADB backup permission limits**: symptom — the backup is empty; cause — the app did not declare `allowBackup`, or targetSDK≥31 (Android 12+); fix — switch to root/image extraction and mark the path limit
- **iOS hash-path confusion**: symptom — the file cannot be found; cause — backup files are organized in a two-level directory by fileID (a SHA1 derived from the path, not a content hash) (the first two characters of the fileID / the full fileID), not the original name; fix — parse the Manifest.db domain/relative-path ↔ fileID mapping first, then locate the file
- **Timeline timezone**: symptom — times are shifted; cause — the device timezone and the forensics timezone disagree; fix — record in UTC uniformly and mark the device timezone
- **Sandbox boundary**: symptom — the target data cannot be obtained; cause — no root / not jailbroken; fix — deliver within the extractable scope (qualify the conclusion). Do not go past the authorization
- **The device is online and remotely wiped**: symptom — during extraction the data disappears/changes; cause — the device being online triggered a remote wipe / sync overwrite; fix — isolate first (airplane mode / disconnect), then plug in power so it does not shut off automatically
- **A backup damaged mid-way**: symptom — the backup file is incomplete / parsing errors; cause — the operation was interrupted (cable / lock screen / not enough space); fix — before retrying, confirm space and a stable connection, and archive the product sha256; a damaged backup is carved as unallocated data
- **Missing integrity check**: symptom — extracted data was tampered with / incomplete and nobody knew; cause — no check was done; fix — archive the product sha256, and for an image product check the partition digest (if there is no digest, mark that it cannot be checked)
- **FBE / full-disk encryption**: symptom — what carving recovers is ciphertext; cause — the device has file-level / full-disk encryption on (the modern Android default); fix — prefer the already-decrypted file path inside the backup/image, and mark the encryption limit
- **Lock screen / authorization state**: symptom — `adb devices` shows unauthorized/offline; cause — the lock screen is not unlocked / USB-debugging authorization expired; fix — unlock first (inside the authorized scope) and then connect, and record the authorization state
- **adb multi-device ambiguity**: symptom — the command errors / operates on the wrong device; cause — several devices are connected and no serial was specified; fix — `adb devices` confirms the serial, and the command adds `-s <serial>`
- **Misjudging deleted recovery**: symptom — a recovered "deleted" record is actually a redundant copy the app kept; cause — the app saves it in several places; fix — the deletion criterion is "not present in the backup + present in the image" (cross-check)
- **A forgotten backup password**: symptom — there is a passworded backup but the password is lost; cause — the password was not recorded with the backup; fix — record the password source immediately at extraction time (inside the authorized scope). When it cannot be recovered, mark it
- **Backup format version differences**: symptom — the parser reports a format error; cause — old and new Android/iOS backup formats differ; fix — use a toolchain that matches the system version, and mark the version
- Scenario branches and extraction-path selection: [[decision-tree]]. Boundaries and counterexamples: [[gotchas]]

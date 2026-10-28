# Mobile-forensics methodology pitfalls and boundaries

## Extraction pitfalls

- **adb backup version differences**: from Android 12, app data with targetSDK≥31 is no longer exported (officially deprecated); some Android 13+ devices have removed support — an "empty backup" checks the app targetSDK and the device version first, then switches to the root/image path (SKILL.md step 1)
- **allowBackup=false with no warning**: the backup command runs as usual but one app's data is missing, with no error at all — check the exported contents item by item against the app list. Do not assume the backup is complete
- **Encrypted backup**: an encrypted ab/iTunes backup cannot be parsed without the password (the password is not stored on the device/in the backup); do not brute-force it (authorization boundary). Mark it not extractable
- **A backup damaged mid-way**: a cable disconnect / lock screen / full disk all produce a damaged backup — when parsing errors, look at the product size and the log first. Before retrying, confirm the environment is stable
- **Keystore keys**: an Android hardware Keystore key is bound to the device chip. Neither a backup nor an image can export it — when the target involves a key, mark the limit directly

## Parsing pitfalls

- **iOS hash paths**: backup files are named by fileID (fileID = SHA1(domain + "-" + relativePath), derived from the path and unrelated to the content), in a two-level directory (first two characters / full fileID). Without the index it is a garbage directory — always parse the Manifest.db mapping before touching files
- **A damaged index**: when Manifest.db (the file index) is missing/damaged the backup files are still there, but the mapping is unusable — you can try to look them up backward by file features (plist/database header). That is weak evidence
- **SQLite state**: in WAL mode, deleted data may still be in WAL pages that were not checkpointed; in journal mode, freelist pages remain — before recovery, look at the database journal mode (the [[re-disk-forensics]] method)
- **Timezone and clock**: device timezone/clock skew misaligns the timeline — normalize to UTC first and mark the time source; when merging timelines across devices, align clocks first

## Evidence-preservation pitfalls

- **Remote wipe**: a device on the network may trigger a vendor remote wipe / sync overwrite (find-my lock / a management policy) — disconnect before extraction (airplane mode) and keep it that way the whole time
- **Unlock and operation contamination**: unlocking, installing tools, and restoring a backup all write the filesystem (overwriting deleted data) — image/backup first (read-only preferred), then do lower-priority operations
- **TRIM / automatic overwrite**: after modern flash deletes data it may be reclaimed by TRIM, and the recovery success rate is low — a deleted-recovery conclusion carries the "partial recovery" qualifier
- **Charging / automatic shutdown**: a dead battery shuts the device off and interrupts the work — plug in power / keep it warm, and keep the device state stable

## Usage notes

- Authorized devices only; confirm the authorization scope first; an over-privilege path (bypassing the lock screen and similar) is not done
- Archive products per the forensics flow (path + device state + sha256, see [[re-triage]]); deliver conclusions per [[re-analyze/analysis-contract]]
- Dynamic/runtime data (process memory, live messages) is not covered by this skill. Evaluate it with [[re-frida]] / [[re-mem-forensics]]
- Cloud-side data (iCloud/Google cloud backup) needs separate authorization and a flow. This skill handles only data local to the device

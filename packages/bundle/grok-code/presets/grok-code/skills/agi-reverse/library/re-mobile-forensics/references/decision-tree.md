# Mobile-forensics decision tree and evidence grading

The forensics path is decided by "device state × available access level", not by reaching for a tool first. Use this document with steps 1-3 of SKILL.md.

## Device × access-level decision tree

```
Mobile-device forensics
├─ Android
│  ├─ Unlocked + the app can be backed up → adb backup (targetSDK<31 or debuggable)
│  ├─ root available → partition image/dd + a direct read of /data
│  ├─ Lock screen only / no USB-debugging authorization → mark not extractable (do not bypass outside the authorization flow)
│  └─ Encrypted backup → parseable only with the backup password; otherwise mark it
├─ iOS
│  ├─ Unlocked + this computer is trusted → idevicebackup2 backup (encrypted/unencrypted)
│  ├─ A local backup already exists (MobileSync/Backup) → parse Manifest.db (file index) + Manifest.plist (metadata/encryption state)
│  └─ Not jailbroken and no backup → only limited information can be extracted. Mark the boundary
└─ Other (feature phone / custom system) → evaluate by vendor tools and interfaces. There is no general flow
```

## Target-data-type branches

```
Target data
├─ App database → locate the db file → sqlite3 query → deleted records go through freelist/WAL pages ([[re-disk-forensics]])
├─ Chat/media files → enumerate the app sandbox path → extract directly; already deleted → foremost carving
├─ Preferences/config → plist/SharedPreferences parsing
├─ Keychain/credentials → iOS needs the backup password; an Android Keystore hardware binding cannot be exported (mark it)
└─ Timeline → merge file timestamps + database timestamps → normalize to UTC
```

## Extraction-method grading table (evidence reliability)

| Level | Method | Notes |
|---|---|---|
| Strong | Device image / partition image | A raw bit-level copy. Best for deleted-data recovery and integrity checks |
| Medium | Official backup (ab / iTunes backup) | A full export of app data, but it went through packaging / may contain an encryption layer |
| Medium | Direct read of the app sandbox (run-as/root pull) | Single-app data, path-level extraction |
| Weak | Carving deleted data (foremost) | Fragmented, poor integrity, corroboration only |
| Marked | Cloud sync / server-side data | Outside this skill's scope. Needs separate authorization and a flow |

## Deleted-recovery branches

```
Deleted-recovery request
├─ SQLite database → freelist pages + WAL residue → page-level extraction (unallocated-page scan)
├─ Ordinary file → filesystem unallocated space → foremost/equivalent carving (by signature)
└─ No unallocated space (TRIM/overwrite already ran) → mark not recoverable (see [[gotchas]])
```

## Timeline evidence grading

| Level | Source | Notes |
|---|---|---|
| Strong | Database record time (carried in the content) | An in-app record, directly related to the user action |
| Medium | File timestamps (ctime/mtime/atime) | Can be rewritten. Watch timestamp forgery |
| Medium | Backup record time (the backup's own timeline) | Corroborates the extraction moment. It is not the user's activity time |
| Weak | Time on deleted/fragment-recovered data | Usually only a range, not an exact point |

## Lessons internalized

- Isolate first, then forensics: airplane mode / disconnect is the first action. A remote wipe is irreversible
- Choose the extraction path by "evidence reliability × availability": image > official backup > direct read > carving
- Every extraction records device state (unlock/encryption/network) and the product sha256. The chain is reviewable only when it is complete
- Say plainly that data you cannot get is "not extractable". Do not bypass the authorization boundary

## Usage notes

- Authorized devices only; confirm the authorization scope first (device / data class / time window)
- Deliver products and conclusions per [[re-analyze/analysis-contract]]; a deleted-recovery conclusion carries the "partial recovery" qualifier
- A judicial scenario watches chain-of-custody requirements. This skill's products are archived per the forensics flow

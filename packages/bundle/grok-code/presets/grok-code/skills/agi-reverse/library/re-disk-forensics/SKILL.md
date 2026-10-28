---
name: re-disk-forensics
description: >
  Disk / filesystem forensics: deleted-file recovery, timelines, and locating suspicious files.
  Triggers: `磁盘取证`, `文件系统`, `删除恢复`, `时间线`, ext4, NTFS
capabilities: [disk-forensics]
---

# Disk forensics and filesystem analysis

## When to use / when not to use

- Use: you have a disk image (dd / E01) or media and need forensics — deleted-file recovery, timeline reconstruction, locating suspicious files / residual data
- Use: incident response needs "what happened on the media" (what was deleted, when it was written, what traces remain)
- Use: partition-table rebuild and file salvage after a lost/damaged partition (testdisk)
- Do not use: memory forensics (that is [[re-mem-forensics]], the other forensics branch beside disk forensics)
- Do not use: ordinary filesystem mount-and-use (that wants a writable mount; forensics is always read-only; see pitfall 1)
- Do not use: an encrypted volume with no key — find the key first (see pitfall 2)

## Tool setup

Forensics rule: **read-only**. Every tool in this skill only reads the image file, does not mount writable, and writes nothing on the original media (see pitfall 1). Archive image-acquisition and suspicious-object extraction results with sha256 + path (forensics must be traceable; see [[re-analyze/platform-tips]]).

### sleuthkit — main forensics analysis (fls/icat/tsk_recover/mmls/fsstat/blkls)

- Debian/Ubuntu: `apt install sleuthkit`
- Fedora: `dnf install sleuthkit`
- Arch: `pacman -S sleuthkit` (extra repo)
- macOS: `brew install sleuthkit`
- Windows: prefer the Linux build inside WSL (see [[re-analyze/platform-tips]] WSL branch); GUI is Autopsy (`winget install SleuthKit.Autopsy`, which bundles the sleuthkit tools)
- Verify: `fls -h`; `mmls -h`; `tsk_recover -h`; `mactime -h`

### testdisk / photorec — partition repair and file carving (cgsecurity)

- Debian/Ubuntu: `apt install testdisk` (photorec is in the same package; official docs confirm there is no separate package)
- Fedora: `dnf install testdisk` (photorec CLI comes with the package; the GUI is the separate package `qphotorec`)
- Arch: `pacman -S testdisk` (extra; photorec comes with the package)
- openSUSE: `zypper install testdisk photorec` (on that distro photorec is a separate package)
- macOS: `brew install testdisk`
- Windows: Linux build inside WSL (the testdisk package on chocolatey is very old; not recommended)
- Verify: `testdisk /?`; `photorec /?`

### dd / ewf-tools — image acquisition

- dd: shipped with coreutils (available on Linux/macOS/WSL)
- ewf-tools (E01 evidence format, with checksum blocks): Debian/Ubuntu `apt install ewf-tools` / Fedora `dnf install ewf-tools` / Arch `pacman -S ewf-tools`; verify: `ewfacquire -V`
- Windows: read-only imaging tool FTK Imager (GUI, free edition from the exterro site) or the Linux build inside WSL

### Read-only mount — loop + ro (when you need to read file contents directly)

- mount is built in (util-linux); NTFS needs ntfs-3g: Debian/Ubuntu `apt install ntfs-3g` / Fedora `dnf install ntfs-3g` / Arch `pacman -S ntfs-3g`
- Verify: after `mount -o ro,loop,noload ...`, `findmnt` output contains `ro`

### autopsy — optional GUI (team / visualization)

- Debian/Ubuntu: `apt install autopsy`; Fedora: `dnf install autopsy`; Arch: `pacman -S autopsy` (AUR or extra); Windows: `winget install SleuthKit.Autopsy`; macOS: `brew install --cask autopsy`

## Procedure

Run in order. Archive each step's products (image / extracted files / timeline) with sha256 + path (for the [[re-ioc]] report).

1. **Read-only image acquisition (preserve evidence before touching anything)**:
    ```sh
    sha256sum /dev/sdX > evidence.sha256     # 原始介质哈希存证（分析前后复核）
    dd if=/dev/sdX of=evidence.dd bs=4M conv=noerror,sync status=progress
    sha256sum evidence.dd >> evidence.sha256 # 镜像哈希复核，与源哈希一致才继续
    ```
   - Prefer a write-blocker for a physical disk (USB write-blocker); software write-protect with `blockdev --setro /dev/sdX`
   - Partition image: `dd if=/dev/sdX1 ...` images only the target partition; a whole-disk image keeps the partition table and unallocated space (unallocated space often holds residual evidence; see step 5)
   - Evidence format: raw dd is the most portable; for long-term storage use E01 (`ewfacquire /dev/sdX`, built-in checksum and compression)
   - If you already have multiple images (a common incident-response setup), go straight to step 2; do not acquire again

2. **Identify partitions and filesystem (ext4 / NTFS / APFS)**:
    ```sh
    file evidence.dd                          # 常见文件系统魔数初判
    mmls evidence.dd                          # 分区表布局（含 start 扇区偏移）
    fsstat -o <分区start> evidence.dd         # 文件系统类型与元数据统计
    ```
   - sleuthkit's `-o` argument is a **sector offset**; fill it directly from the start column of mmls output; for a loop mount, convert to bytes with `offset=$((start*512))`
   - ext4: fsstat prints superblock/mgroup; NTFS: prints the $MFT location; APFS: mmls shows an Apple_APFS container partition (volumes inside APFS need apfs tools; sleuthkit's APFS support is limited; use native macOS tools when necessary)
   - No partition table (whole-disk filesystem / hidden partition / deleted partition table) → mmls prints nothing: run fsstat directly on the image; rebuild the partition table with testdisk (step 3)
   - Identification fails and entropy is high → encrypted volume (BitLocker/FileVault/LUKS); see pitfall 2

3. **Deleted-file recovery (metadata method + carving)**:
    ```sh
    # 元数据法（保留文件名/路径/时间）—— sleuthkit
    fls -r -o <分区start> evidence.dd                       # 全部文件，含 [DELETED]
    fls -o <分区start> evidence.dd <inode>                  # 指定目录 inode 下文件
    icat -o <分区start> evidence.dd <inode> > rec.bin       # 按 inode 提取（含删除文件）
    tsk_recover -o <分区start> evidence.dd out/             # 恢复已删除（未分配）文件——这是默认行为
    tsk_recover -e -o <分区start> evidence.dd out_all/      # -e = 已分配 + 未分配全部导出（-a 则只导已分配）
    ```
   - fls prints `r/r 12345-128-1: 文件名 [DELETED]` — the inode number at the start of the line is for icat; undeleted files can also be extracted precisely with icat (more controllable than a mount-and-copy)
   - Deleted recovery is not 100% (SSD TRIM / overwrite); see pitfall 5
   - **Lost/damaged partition, metadata method fails → testdisk / photorec (carving)**:
      ```sh
      testdisk evidence.dd          # 交互: 恢复丢失分区表 / Advanced → Undelete
      photorec /d <输出目录> evidence.dd   # 雕刻: 按文件签名扫描恢复（无文件名，见坑 6）
      ```
   - photorec recovery types can be filtered interactively (carve only the target extensions to shrink the result set); `/d` sets the output directory

4. **Timeline reconstruction (fls -m → mactime)**:
    ```sh
    fls -r -m / -o <分区start> evidence.dd > bodyfile      # -m 生成 body file（挂载点写 /）
    mactime -b bodyfile -d -z UTC > timeline.csv           # -d CSV、-z 指定时区
    ```
   - The timeline answers "when was it created/modified/deleted/accessed" — look for anomalous windows (bulk writes in the small hours, delete-plus-copy combinations, abnormal access times)
   - Timestamps can be forged (timestomp); see pitfall 4 — cross-check the timeline against other sources (USN Journal, system logs, the [[re-mem-forensics]] memory timeline)
   - Filter delete actions by MAC time in the CSV: `grep -i ',d,' timeline.csv` (delete records)

5. **Extract suspicious files (unallocated space / hidden partitions)**:
    ```sh
    # 未分配块（含删除文件残留、缓存、临时数据）
    blkls -o <分区start> evidence.dd > unallocated.bin
    strings -n 8 unallocated.bin | grep -iE 'key|password|flag|http' | head -50
    # 分区表空隙（slack space）/隐藏分区: 按 mmls 相邻分区起止手工截取
    dd if=evidence.dd of=gap.bin bs=512 skip=$((A_end+1)) count=$((B_start-A_end-1))   # mmls 的 End 是含端点的末扇区（Length=End-Start+1）；两分区之间的空白 = A_end+1 .. B_start-1。更省事：直接用 mmls 列出的 Unallocated 项 Start/Length
    ```
   - Unallocated space is the main battlefield of "deleted ≠ gone": credential/key/URL/document fragments often remain there
   - Deleted/hidden partitions: after testdisk scans and rebuilds partition-table entries, recover files from the rebuilt partition using the step 3 flow
   - Hash extracted objects (files/fragments) with sha256 before analysis; send suspicious binaries to [[re-binary-core]] for a deep dive, and sensitive strings into the [[re-ioc]] IOC list

## Database file formats

- **SQLite structure**: page header (page header fields), btree pages (interior/leaf types), record format (varint length encoding / type codes), overflow pages (large fields spanning pages)
- **WAL recovery**: WAL file frame parsing (transactions not yet checkpointed), checkpoint-boundary determination (recovery point)
- **Forensics use**: browser/app databases — deleted-record recovery (freelist page residue), uncommitted-transaction extraction (inside the WAL)
- **Tools**: `sqlite3` CLI read-only mode (`sqlite3 -readonly`), page-level parse scripts (python walks the page structure)

## Cross-domain joins

- [[re-forensics]]: this skill is that gateway's disk-side forensics branch (memory side is [[re-mem-forensics]]) — the gateway selection tree dispatches on "memory vs disk"
- [[re-mem-forensics]]: the parallel forensics branch — memory residue and disk evidence corroborate each other (process behavior ↔ file landing); a BitLocker key can be taken first from a memory-forensics plugin (then come back here to decrypt the volume)
- [[re-ti]]: intelligence lookup on extracted objects (hash/domain/IP)
- [[re-ioc]]: disk evidence (files/timeline/residual data) rolls up into IOCs and the report evidence section
- [[re-binary-core]]: deep dive on extracted suspicious binaries/scripts ([[re-ghidra]] / [[re-ida]])
- [[re-crypto-keys]] / [[re-crypto-decrypt]]: encrypted-volume key extraction (BitLocker/LUKS) and encrypted-file decryption
- [[re-firmware]]: firmware/embedded storage images are handled by the same "disk image" flow (binwalk unpack layer)
- [[re-memdump]]: a memory dump is upstream corroboration for disk forensics (keys/credentials/execution traces; prefer an existing dump)
- Cites the [[re-analyze/platform-tips]] WSL branch (Windows disk images use Linux forensics tools inside WSL) and the forensics evidence-chain requirement

## Common pitfalls

- **Writes contaminate evidence (must be read-only)**: Symptom — after analysis the image hash does not match, filesystem state differs before and after, and the report cannot prove itself; cause — `mount` is writable by default (an ext4/NTFS mount replays the journal and updates access times), or a recovery tool was run directly on the original device; fix — always `mount -o ro,loop,noexec,nodev,nosuid` the image; add `noload` for ext4, and use `ntfs-3g -o ro,recover=no` for NTFS to skip journal replay (see pitfall 3); archive sha256 before analysis and recheck after; use a write-blocker or `blockdev --setro` on a physical disk; prefer sleuthkit tools for read-only data (fsstat/fls/icat parse and do not write) over mounting
- **Encrypted volumes (BitLocker/FileVault/LUKS)**: Symptom — fsstat/testdisk reports "unrecognized filesystem", and sectors are all high-entropy; cause — full-volume encryption; without a key there is no content; fix — key paths: (1) take the key from a memory dump while the system is running ([[re-mem-forensics]] Bitlocker FVEK scan plugin → mount with `dislocker`) (2) user password / recovery key (BitLocker 48-digit recovery key, FileVault recovery key, LUKS passphrase) (3) the unencrypted boot partition (UEFI/Boot partition is not encrypted; the boot-chain evidence can be extracted); tools: dislocker (BitLocker), `cryptsetup luksOpen` (LUKS); if you cannot get a key, the image can only support non-content forensics (partition structure / boot chain), and the limitation must be stated honestly
- **Filesystem journal interference**: Symptom — the file state fls sees does not match the state at analysis time (files "roll back" to an old state), or the image hash changes after mount; cause — the ext4 jbd2 / NTFS journal is replayed on mount, and uncommitted transactions are written back; fix — a read-only mount must carry `noload` (ext4) / `recover=no` (ntfs-3g); keep two copies of the image (original + working copy), analyze the copy, and never mount the original image
- **Timestamp forgery (timestomp)**: Symptom — timestamps of a batch of files in the timeline are identical or obviously unreasonable (delete time earlier than create time, or everything changed to the same instant); cause — the attacker/sample used a timestomp-class technique to rewrite MFT/inode timestamps (a common closing move in [[re-malware]]); fix — cross-check: NTFS USN Journal (records the real change sequence), ext4 access time vs crtime, system logs, the [[re-mem-forensics]] memory timeline; the forgery itself is an important forensics finding — write it into the report instead of filtering it out as dirty data
- **Deleted ≠ recoverable (SSD TRIM / overwrite)**: Symptom — fls lists a pile of [DELETED] but icat reads all zeros or cannot fetch them; cause — SSD TRIM already erased the physical blocks, data was overwritten by later writes, or the file is NTFS-compressed/encrypted; fix — first confirm media type (HDD/SSD) and the deletion time window (the earlier you recover, the higher the odds); walk unallocated space with blkls to see if residue remains; if it is all zeros, report honestly that it "has been erased"
- **photorec carving false positives**: Symptom — a large number of "files" are recovered but will not open / contents do not match the extension; cause — signature carving only recognizes file headers; real files were fragmented or spliced into fake files after overwrite; fix — filter by file type in the interactive menu (recover only the target types), prefer to verify small files and critical types, spot-check recovered contents, and hash them with sha256 into the store ([[re-ioc]])

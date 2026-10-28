---
name: re-fw-rootfs
description: >
  Firmware filesystem analysis: rootfs, config, keys, and startup scripts.
  Triggers: rootfs, `文件系统分析`, squashfs, cramfs, `配置文件`
capabilities: [firmware-extraction]
---

# Firmware filesystem analysis (rootfs)

## When to use / when not to use

- Use: you already have an unpack product / filesystem image and need the startup entry, config, keys, and hardcoded passwords
- Use: you need to locate programs inside the firmware and their architecture (cross binaries)
- Do not use: you still have no unpack product (do [[re-fw-extract]] first)
- Do not use: you need to run a firmware program and observe behavior (go to [[re-fw-emulate]])
- Do not use: you need a physical board (go to [[re-hardware-io]])

## Tool setup

Verify every tool before use. This skill is pure static analysis and can skip the sandbox ([[re-analyze/platform-tips]] highest principle); when an extracted program must run, hand off to [[re-fw-emulate]].

### Unpack tools (prefer unblob / binwalk products)

- If already installed, use the unpack products from [[re-fw-extract]] directly; if not, install per that skill's "Tool setup"
- Verify: `unblob --version` / `binwalk --version`

### 7-Zip (7z) — generic container fallback

- Linux: `apt install p7zip-full` / `dnf install p7zip-plugins` / `pacman -S 7zip`
- macOS: `brew install p7zip`
- Windows: `choco install 7zip` (or the official installer from 7-zip.org)
- Verify: `7z i | head -5` (prints the version)

### squashfs-tools (unsquashfs)

- Linux: `apt install squashfs-tools` / `dnf install squashfs-tools` / `pacman -S squashfs-tools`
- macOS: `brew install squashfs`
- Windows/WSL: Linux build inside WSL
- Verify: `unsquashfs -version`

### cramfs unpack (cramfsck)

- Linux: `apt install cramfsprogs` (Debian/Ubuntu); other distros have no official package → fall back to unblob for cramfs
- macOS/Windows: unblob fallback
- Verify: `cramfsck -V`

### grep / ripgrep — config and key search

- Linux: `apt install ripgrep` / `dnf install ripgrep` / `pacman -S ripgrep` (grep ships with the distro)
- macOS: `brew install ripgrep`
- Windows: `choco install ripgrep` (or WSL)
- Verify: `rg --version` / `grep --version`

### Cross binutils (readelf / objdump across architectures)

- Linux: `apt install binutils-arm-linux-gnueabi binutils-arm-linux-gnueabihf binutils-mipsel-linux-gnu binutils-mips-linux-gnu` (Debian/Ubuntu; Fedora: `dnf install binutils-arm-linux-gnu binutils-mips-linux-gnu`)
- macOS: `brew install binutils` (`greadelf`) or `brew install llvm` (`llvm-readelf`)
- WSL: the Linux build works directly
- Verify: `arm-linux-gnueabi-readelf --version`; host readelf can also read a cross ELF header (`readelf -h`); attribute-level info uses the cross `readelf -A`

## Procedure

Run in order. Record each step.

1. **Mount / unpack the filesystem**:
    ```sh
    # squashfs（最常见）
    unsquashfs rootfs.squashfs -d rootfs_out
    # cpio initramfs
    mkdir rootfs_out && cd rootfs_out && cpio -idmv < ../initramfs.cpio
    # 通用兜底
    7z x rootfs.img
    # cramfs（Debian 系）
    cramfsck -x rootfs_out rootfs.cramfs
    # ext 类镜像（需 root，只读挂载）
    mkdir mnt && mount -o loop,ro rootfs.img mnt
    ```
   If [[re-fw-extract]] already unpacked it, skip this step and go to the next.

2. **Startup scripts to find the program entry**:
    ```sh
    ls etc/init.d/ etc/rc.d/ 2>/dev/null
    cat etc/inittab 2>/dev/null
    cat etc/init.d/rcS 2>/dev/null          # 常见主启动脚本
    ```
   Read the startup order: record services that start first and the firmware main program (httpd / the server main process), and start analysis there; rcS / rc scripts often hold version, vendor info, and debug switches.

3. **Mine config files for keys / passwords**:
    ```sh
    rg -i "password|passwd|secret|token|key|login|admin" rootfs_out -l
    cat etc/passwd etc/shadow 2>/dev/null
    ```
   Priority directories: /etc, /usr/share, web UI directories (firmware web config often stores passwords in plaintext), wpa_supplicant.conf, SSH private keys (`find rootfs_out \( -name "*id_rsa*" -o -name "*.pem" \)`).

4. **Locate cross-compiled binaries**:
    ```sh
    find rootfs_out -type f -exec file {} \; 2>/dev/null | grep ELF
    # 大镜像改用：
    find rootfs_out -type f -print0 | xargs -0 file | grep ELF
    arm-linux-gnueabi-readelf -h rootfs_out/usr/sbin/httpd   # Machine + Data 字段确认架构/字节序
    arm-linux-gnueabi-readelf -A rootfs_out/usr/sbin/httpd   # 交叉工具链细节（EABI 等）
    ```
   Priority directories: /bin, /usr/bin, /usr/sbin, /usr/lib; busybox is a symlink set (`ls -la bin/` and check link targets to confirm applets).

5. **Search for weak passwords / backdoor accounts**:
    ```sh
    cat etc/passwd
    rg -i "admin|root|debug|backdoor|telnet" rootfs_out/etc -l
    ```
   Common: root with an empty/weak password, telnetd always on, default admin/admin, debug accounts (debug/backdoor); hand discovered backdoors and suspicious programs to [[re-malware]] for assessment.

## Cross-domain joins

- [[re-firmware]]: workflow step 3 always calls this skill
- Deep dive on ELFs inside firmware → [[re-binary-core]] ([[re-format-elf]] / [[re-ghidra]])
- Need to run the firmware → [[re-fw-emulate]]; found a backdoor/malicious sample → [[re-malware]]; found communications → [[re-protocol]]
- This skill is called by the [[re-analyze]] triage path "analyze firmware / IoT device"

## Common pitfalls

- **Hardcoded keys/passwords in config are common**: Symptom — an SSH private key, WiFi password, or cloud API key is sitting in the firmware; cause — the IoT vendor hardcoded them to save cost; fix — systematically `rg` every config directory and the web directory; do not look only at /etc (step 3)
- **Startup scripts decide analysis order**: Symptom — dozens of executables and no idea where to start; cause — startup scripts were not read first, and a random binary was opened; fix — read rcS / inittab / init.d first, and locate the main program by startup order (step 2)
- **Cross-architecture binaries need the matching toolchain**: Symptom — host readelf info is incomplete / objdump disassembly fails; cause — the matching-architecture binutils is missing, or architecture/endianness was misidentified; fix — install cross binutils, confirm architecture and EABI with `readelf -A` (step 4), then pick emulation/decompiler tools
- **busybox is a symlink set**: Symptom — everything under bin/ is a same-name symlink, and `file` all points at one ELF; cause — busybox is one binary with many applets; fix — the symlink name is the applet function (ls/cat/httpd and similar); analyzing that single ELF covers every command

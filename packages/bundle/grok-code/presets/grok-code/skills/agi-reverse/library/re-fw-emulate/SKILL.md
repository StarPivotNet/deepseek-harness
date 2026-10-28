---
name: re-fw-emulate
description: >
  Firmware emulation: QEMU user-mode / full-system.
  Triggers: `仿真`, QEMU, firmadyne, `跑固件`
capabilities: [emulation]
---

# Firmware emulation (QEMU)

## When to use / when not to use

- Use: you need to run a program inside the firmware to observe behavior / verify a hypothesis (firmware web UI, server logic)
- Use: the rootfs is already extracted and you need a whole boot (full-system emulation)
- Do not use: static analysis is enough ([[re-fw-rootfs]] already covers it)
- Do not use: you have a physical board and must interact with real hardware (go to [[re-hardware-io]], hardware extraction / interface debugging)
- Do not use: the goal is only to unpack and look at contents (go to [[re-fw-extract]])

## Tool setup

Verify every tool before use. Emulation = dynamic execution; default sandbox + network isolation ([[re-analyze/platform-tips]] highest principle); prefer user-mode emulation (the lightest workable option).

### qemu-user — user-mode emulation (lightest)

- Linux: `apt install qemu-user` / `dnf install qemu-user` / `pacman -S qemu-user`
- macOS: `brew install qemu` (includes user-mode and system-mode)
- Windows/WSL: the Linux build inside WSL
- Verify: `qemu-arm --version`, `qemu-mips --version` (big-endian), `qemu-mipsel --version` (little-endian)

### qemu-system — full-system emulation

- Linux: `apt install qemu-system-arm qemu-system-mips` / `dnf install qemu-system-arm qemu-system-mips` / `pacman -S qemu-system-arm qemu-system-mips`
- macOS: `brew install qemu`
- Windows/WSL: the Linux build inside WSL
- Verify: `qemu-system-arm --version`

### binfmt_misc — execute a cross program directly

- Linux: `apt install binfmt-support qemu-user-static` (on Debian/Ubuntu, installing qemu-user-static automatically registers binfmt entries for each architecture; Fedora uses systemd binfmt config); manual register: `update-binfmts --enable qemu-arm` (or a config file under /etc/binfmt.d/)
- macOS/Windows: not supported; call `qemu-<arch>` explicitly
- Verify: `ls /proc/sys/fs/binfmt_misc/` shows a qemu-arm entry; after that you can execute `./rootfs_out/usr/sbin/httpd` directly

### gdb-multiarch + gdbserver — cross debugging

- Linux: `apt install gdb-multiarch` / `dnf install gdb-multiarch` / `pacman -S gdb-multiarch`; gdbserver: `apt install gdbserver` (or provided with the gdb package)
- macOS: `brew install gdb` (needs Developer Tools authorization; see the [[re-analyze/platform-tips]] macOS branch) or the Linux build inside WSL
- Windows/WSL: the Linux build inside WSL
- Verify: `gdb-multiarch --version`

### firmadyne — full-system automatic emulation framework (reference approach, optional install)

- Install: `git clone https://github.com/firmadyne/firmadyne`; depends on qemu-system-* and a prebuilt kernel (download under scripts/); the first setup is heavy
- Verify: `ls sources/` has scripts such as getArch.py; `which qemu-system-mips`
- Most single-program analysis does not need it — prefer user-mode (the [[re-analyze/platform-tips]] lightest-workable-option-first rule)

## Procedure

Run in order. Record each step.

1. **User-mode emulation (lightest, preferred)**:
    ```sh
    file rootfs_out/usr/sbin/httpd                    # 确认架构：ARM 32/64、MIPS(BE/EL)、RISC-V
    qemu-arm -L rootfs_out rootfs_out/usr/sbin/httpd  # -L 把 rootfs 当 sysroot（动态库/链接器从 rootfs 加载）
    # 大端 MIPS: qemu-mips -L rootfs_out ...
    # 小端 MIPS: qemu-mipsel -L rootfs_out ...
    ```
   Missing-library errors → cross `ldd` / `readelf -d` to see dependencies, and fill libraries from the rootfs; a web-service program can pass environment variables with `-E`.
   - `-strace` records the guest program's syscalls (the equivalent of strace inside emulation — use it directly to locate an mmap/ioctl crash)
   - `-0 <argv0>` forges argv[0] (when the program branches on the invocation name); `-cpu <model>` selects the CPU (for example `qemu-arm -cpu cortex-a9`)
   - If it will not run but static analysis is possible → back to [[re-fw-rootfs]] / [[re-binary-core]]; do not grind on emulation.

2. **Full-system emulation**:
    ```sh
    # ARM（vexpress 平台）+ 内核与 initramfs：
    qemu-system-arm -M vexpress-a9 -kernel vmlinuz -initrd initramfs.img -nographic \
      -append "console=ttyAMA0 root=/dev/ram rdinit=/sbin/init"
    # MIPS（malta 平台，大端示例）：
    qemu-system-mips -M malta -kernel vmlinuz -initrd initramfs.img -nographic \
      -append "console=ttyS0 rdinit=/sbin/init"
    ```
   Turn the rootfs into a disk image (ext2 mounted as root) or an initramfs (cpio-pack rootfs_out); firmadyne's scripts automate this flow.
   When the rootfs is already a disk image, attach the disk directly:
    ```sh
    qemu-system-arm -M vexpress-a9 -kernel vmlinuz -drive file=rootfs.ext2,format=raw \
      -nographic -append "console=ttyAMA0 root=/dev/mmcblk0 rdinit=/sbin/init"
    ```
   The root device name follows the platform disk controller (vexpress=mmcblk0, malta IDE=/dev/sda, and similar; follow the `-M` platform docs).

3. **Missing peripherals use a stub / loopback**:
   - User-mode: the program mmaps a fixed address (GPIO/UART registers) and crashes → `strace` locates the access, and `LD_PRELOAD` provides a stub library that returns fake register values
   - Full-system: `-device` attaches a virtual peripheral (e1000 / virtio and similar); a real-chip peripheral (wifi/baseband) cannot be emulated by QEMU → patch past initialization or stub that ioctl
   - First determine which init step crashes (serial output/log), then decide which part to stub

4. **Cross debugging (qemu -g + gdb-multiarch)**:
    ```sh
    qemu-arm -g 1234 -L rootfs_out rootfs_out/usr/sbin/httpd &   # -g 起 gdbstub
    gdb-multiarch rootfs_out/usr/sbin/httpd
    (gdb) target remote :1234
    ```
   Inside full-system: put gdbserver in the rootfs, `gdbserver :1234 /usr/sbin/httpd`, and on the host `target remote <qemu_ip>:1234`; debugging technique follows [[re-gdb]].

5. **Emulation under network isolation**:
   - User-mode: it is not a network sandbox (socket/connect is forwarded through syscalls to the host kernel); when you need a controlled network, switch to the full-system plan
   - Full-system: QEMU with no network arguments builds a NIC (e1000) + user backend by default — first pass explicit `-nic none` to confirm behavior, then add `-nic user,restrict=on` when you need a controlled network (user-mode NAT, simulated outbound only)
   - Isolate before analyzing callbacks/protocols ([[re-analyze/platform-tips]] highest principle); hand traffic capture and protocol reconstruction to [[re-protocol]]; firmadyne's default NIC also needs isolation first under this principle

## Cross-domain joins

- [[re-firmware]]: workflow step 4 always calls this skill
- Architecture identification and instruction-level deep dive: ARM (vector table/Thumb/MMIO peripheral cross-check) → [[re-arm]]; RISC-V (RV32/RV64/ecall) → [[re-riscv]] (compare before picking qemu-<arch>)
- Observe dynamic behavior inside emulation → [[re-tracing]] + [[re-gdb]] (default sandbox, [[re-analyze/platform-tips]] highest principle)
- Communications produced by running firmware → [[re-protocol]]; deep dive on an ELF inside emulation → [[re-binary-core]]
- A program that will not emulate falls back to static → [[re-fw-rootfs]]

## Common pitfalls

- **Peripheral-register access crashes**: Symptom — after the program mmaps a fixed address, reading GPIO/UART registers segfaults; cause — QEMU user-mode does not emulate peripherals, and the address is unmapped; fix — strace locates the access, and an LD_PRELOAD stub returns a simulated value (step 3)
- **Wrong architecture segfaults immediately**: Symptom — qemu-arm crashes a MIPS program instantly; cause — architecture and endianness were not confirmed with `file`/`readelf` first (big-endian mips ≠ mipsel); fix — confirm in step 1, and pick the right qemu-<arch>
- **NIC model mismatch → init hangs**: Symptom — the program hangs at NIC init and does not exit; cause — the firmware initializes a specific chip, the default e1000 does not match, and ioctl never returns; fix — add a virtual NIC such as `-device <model>` to match the firmware, or start with `-nic none` and see whether it can be skipped (step 5)
- **Timestamp / clock-function trap**: Symptom — the program reads time oddly (1970 / going backward), and behavior differs from a real device; cause — the QEMU virtual clock is not synced to the wall clock; fix — pin it with `-rtc base=utc`, or stub clock_gettime-related calls
- **Emulating without network isolation**: Symptom — the firmware really calls out (C2/update server); cause — QEMU builds a NIC + user backend by default (restrict=off), and skipping explicit isolation means it is online; fix — full-system emulation passes explicit `-nic none`; user-mode is also not a network sandbox (step 5); isolate per [[re-analyze/platform-tips]] before callback analysis
- The command-family cheat sheet and operation sequences are in [[commands]]; tool-specific pitfalls and version differences are in [[gotchas]]

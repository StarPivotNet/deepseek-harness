# QEMU emulation command cheat sheet and operation sequences (user-mode / full-system)

Division of labor: qemu-user (user-mode, lightest for a single program) → qemu-system (full-system, boot complete firmware) → binfmt_misc (execute a cross program directly) → gdb-multiarch (cross debugging). Parameters follow this machine's `qemu-<arch> --help` / `qemu-system-<arch> --help` (version differences are in [[gotchas]]).

## Command-family cheat sheet

### qemu-user — user-mode emulation

| Use | Command |
|---|---|
| Architecture mapping | `qemu-arm` (32-bit) / `qemu-aarch64` / `qemu-mips` (big-endian) / `qemu-mipsel` (little-endian) / `qemu-riscv64` and similar |
| Basic run | `qemu-arm -L <rootfs> <rootfs>/usr/sbin/httpd` |
| sysroot | `-L <path>` (dynamic libraries/linker load from the rootfs; missing `-L` reports ld-linux not found) |
| Environment variable | `-E VAR=value` (several allowed; a web service often passes `-E LD_LIBRARY_PATH=...`) |
| Forge argv[0] | `-0 <argv0>` (when the program branches on the invocation name) |
| Syscall log | `-strace` (the equivalent of strace inside emulation; locate an mmap/ioctl crash) |
| gdbstub | `-g <port>` (wait for gdb; pair with gdb-multiarch) |
| Select CPU | `-cpu <model>` (`-cpu help` lists all, such as cortex-a9) |
| Limit address space | `-B <size>` (guest address-space size; used when an old kernel has a small space) |
| Pause at start | besides `-g`, `-d in_asm` is a disassembly log (debug/forensics) |

### qemu-system — full-system emulation

| Use | Command |
|---|---|
| Platform choice | `-M vexpress-a9` (ARM) / `-M malta` (MIPS) / `-M virt` (generic) — `-M help` lists all |
| Kernel and initramfs | `-kernel vmlinuz -initrd initramfs.img` |
| Attach a disk image | `-drive file=rootfs.ext2,format=raw` |
| Serial to the terminal | `-nographic` (`-serial mon:stdio` variant) |
| Kernel arguments | `-append "console=ttyAMA0 root=/dev/ram rdinit=/sbin/init"` |
| Network (added explicitly) | `-netdev user,id=n0 -device e1000,netdev=n0` (user-mode NAT, outbound only) |
| Network shorthand | `-nic user,model=e1000` (recommended on new versions; the old `-net` syntax is marked deprecated) |
| Fully offline | explicit `-nic none` (or `-nodefaults`) — omitting network arguments builds a NIC + user backend by default |
| Virtual peripheral | `-device virtio-net-pci,netdev=n0` / `-device e1000` and similar (`-device help` lists all) |
| Fixed clock | `-rtc base=utc` (avoid weird time; see [[gotchas]]) |
| Memory | `-m 256` (by firmware need; commonly 64-256MB) |
| gdbstub | `-s` (port 1234) / `-S` (pause at start and wait for gdb) |

### binfmt_misc — execute a cross program directly

```sh
# Debian/Ubuntu：apt install binfmt-support qemu-user-static 后自动注册
# 手动注册：update-binfmts --enable qemu-arm（或 /etc/binfmt.d/ 配置文件）
ls /proc/sys/fs/binfmt_misc/        # 可见 qemu-arm 等条目
./rootfs_out/usr/sbin/httpd          # 之后可直接执行（等效 qemu-arm -L rootfs_out ...）
# 注意：binfmt 直接执行不带 -L sysroot，动态链接程序仍需设置 QEMU_LD_PREFIX 或先解出依赖
```

### gdb-multiarch + gdbserver — cross debugging

```sh
qemu-arm -g 1234 -L rootfs_out rootfs_out/usr/sbin/httpd &   # 用户态 gdbstub
gdb-multiarch rootfs_out/usr/sbin/httpd
(gdb) target remote :1234
# 全系统内：rootfs 里放 gdbserver，gdbserver :1234 /usr/sbin/httpd
# 宿主 (gdb) target remote <qemu_guest_ip>:1234
```

## Common operation sequences

### 1. Run a single firmware program in user-mode (lightest, preferred)

```
file confirms architecture and endianness → qemu-<arch> -L <rootfs> <program>
→ missing library: readelf -d to see dependencies, fill from the rootfs (or -E LD_LIBRARY_PATH)
→ crash: add -strace and look at syscalls; locate the mmap/ioctl access, then decide on a stub (sequence 4)
```

### 2. Full-system boot (initramfs and disk-image forms)

```
Form 1 (initramfs): cpio-pack rootfs_out → -kernel vmlinuz -initrd initramfs.img -append "rdinit=/sbin/init"
Form 2 (disk image): make rootfs.ext2 with dd/ext2 → -kernel vmlinuz -drive file=rootfs.ext2,format=raw -append "root=/dev/<device>"
→ if the serial port shows no output, first check that console= matches the -M platform (ttyAMA0 vs ttyS0 differs by platform)
```

### 3. Cross debugging inside emulation (user-mode / full-system)

```
User-mode: qemu-arm -g 1234 → gdb-multiarch target remote :1234
Full-system: put gdbserver in the rootfs → start gdbserver inside the firmware → host target remote <guest_ip>:1234
→ debugging technique (breakpoints/memory/single-step) follows [[re-gdb]]
```

### 4. Stub a missing peripheral (GPIO/UART register crash)

```
qemu-<arch> -strace locates the first crashing access (for example a read of [addr] after mmap of a fixed address)
→ LD_PRELOAD provides a stub library: that address returns a simulated value (user-mode)
→ Full-system: -device attaches a virtual peripheral (e1000/virtio); a real-chip peripheral is patched past initialization
→ First confirm which init step crashes (serial output/log), then decide the stub scope
```

### 5. Emulation under network isolation

```
Full-system starts with -nic none (omitting network arguments builds a NIC + user backend by default) to confirm behavior → add -nic user,model=e1000,restrict=on when a controlled network is needed
→ isolate per [[re-analyze/platform-tips]] before callback/protocol analysis; hand capture and protocol reconstruction to [[re-protocol]]
→ firmadyne ships a NIC by default; isolate first, then run, the same way
```

## Lessons internalized

- User-mode first: qemu-user is enough for 80% of single-program scenes; do not stand up full-system up front
- The typical symptom of a mismatched `-L` is an ld-linux error — point the sysroot correctly before anything else
- `-strace` is the first troubleshooting tool inside emulation: on a crash/hang, look at the syscall flow first
- If full-system serial has no output, first check that `console=` matches the `-M` platform (the console device name differs by platform/kernel)
- Emulation is a verification means, not the goal: if it will not run and static analysis is possible, fall back to static ([[re-fw-rootfs]] / [[re-binary-core]])

## Usage notes

- Emulation = dynamic execution; default sandbox + network isolation ([[re-analyze/platform-tips]] highest principle)
- Identify the architecture first (compare [[re-arm]] / [[re-riscv]] / [[re-mips]]); the wrong qemu-<arch> crashes immediately
- Archive products and logs with sha256 (the [[re-triage]] convention); write emulation conclusions into [[re-analyze/analysis-contract]]

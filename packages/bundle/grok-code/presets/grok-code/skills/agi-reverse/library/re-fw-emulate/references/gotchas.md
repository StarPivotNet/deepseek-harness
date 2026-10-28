# QEMU emulation tool-specific pitfalls and boundaries

## Architecture and boot

- **Wrong architecture/endianness crashes immediately**: big-endian MIPS (qemu-mips) and little-endian (qemu-mipsel) run against each other and fail with Invalid ELF/segfault — confirm with `file`/`readelf -h` first; ARM 32/64 (qemu-arm vs qemu-aarch64) is the same
- **-L sysroot mismatch**: missing `-L` or pointing at the wrong directory → ld-linux not found / loader version mismatch — the sysroot must contain the target architecture's `/lib`, `/usr/lib`, and dynamic linker
- **Kernel and rootfs mismatch**: a full-system kernel must support the rootfs filesystem and architecture (for example an ext2 kernel that was not built in → mount fails with Kernel panic) — change the kernel or the filesystem format
- **console argument does not match the platform**: `console=ttyAMA0` (vexpress) vs `console=ttyS0` (malta) — if the serial port has no output, check this first; do not assume the kernel is broken
- **-M platform is coupled to the device model**: the same kernel has a different device tree under different -M platforms (vexpress/virt) — changing platform means also changing -append/root device names

## Peripherals and memory

- **User-mode does not emulate peripherals**: accessing a fixed mmap address (GPIO/UART registers) segfaults immediately — locate the access with `-strace`, and have an LD_PRELOAD stub return a simulated value (see [[commands]] sequence 4)
- **NIC model does not match what the firmware expects, so init hangs**: when the firmware initializes a specific chip, ioctl never returns and the program sticks — the default e1000 may not match; add `-device <model>`/virtio to match the firmware; you can also start with `-nic none` to see whether network init can be skipped (see [[commands]] sequence 5)
- **Too little memory**: the firmware initializes against real memory (malloc ceiling / partition table); `-m 32` may fail to boot — commonly start at 64-256MB and try
- **Weird time/clock**: the QEMU virtual clock is not synced to the wall clock (time reads 1970 / goes backward) — pin it with `-rtc base=utc`, or stub clock_gettime-related calls

## qemu-user boundary

- **User-mode instructions only**: privileged instructions / kernel paths (a driver ioctl on a real device) do not work — a program that needs full kernel behavior must use full-system emulation
- **Process-model differences**: qemu-user supports fork/threads but with limits (older versions occasionally crash multi-threaded programs) — prefer full-system for multi-threaded targets
- **Shared memory / IPC is limited**: POSIX shm and cross-process communication are unreliable under user-mode emulation — multi-process firmware that depends on shared memory goes full-system
- **-strace output is huge**: a full syscall log can be gigabytes — pipe `-strace` into grep for the target calls (open/connect/mmap)

## Network and isolation

- **qemu-system has a network by default**: if you do not declare a network, QEMU automatically creates a default NIC (`e1000`) and a user-mode backend (`type=user,net=10.0.2.0,restrict=off`) — **untrusted firmware under analysis must explicitly pass `-nic none`** (or `-nodefaults`) to really have no network; for controlled outbound use `-nic user,restrict=on` or an isolated TAP / network namespace
- **qemu-user is not a network sandbox**: the guest's socket/connect is forwarded through syscalls to the host kernel and can directly reach the host loopback and network — an outbound connection from qemu-user does not mean isolation; callback analysis is also isolated per [[re-analyze/platform-tips]]
- **user mode is not isolation**: a guest outbound on `-nic user` goes straight to the host network stack — before callback analysis, still isolate per [[re-analyze/platform-tips]] (cut the internet / fake DNS); firmadyne's default NIC is isolated first the same way
- **The guest may need a fixed IP**: if user-mode NAT DHCP/address assignment does not match the firmware's assumption, program init fails — customize the subnet with `-nic user,net=192.168.x.0/24`

## Version differences

- **QEMU 8/9/10/11 generations**: network config prefers the `-nic`/`-netdev` shorthand (`-net` old syntax still works but is marked deprecated); `-device` supported peripheral models keep expanding; newer versions support ARM/MIPS platforms more completely (an old version may lack some -M platforms)
- **qemu-user and qemu-system are separate packages**: distros split qemu-user (per-architecture user-mode) + qemu-system-<arch> — installing only one produces "command not found"; on Debian, `apt install qemu-user qemu-system-arm qemu-system-mips` as needed
- **qemu-user-static**: Debian includes statically linked qemu-<arch>-static (for binfmt direct execution); ordinary qemu-user is the dynamically linked build and cannot be used for host binfmt
- **Kernel side**: under the same -M platform, device-tree/driver behavior differs across kernel versions — if the firmware's matching kernel is missing, try a nearby kernel of the same architecture

## Usage notes

- Emulation = dynamic execution; default sandbox + network isolation ([[re-analyze/platform-tips]] highest principle)
- If it will not run and static analysis is possible, fall back to static ([[re-fw-rootfs]] / [[re-binary-core]]); do not grind on emulation
- Emulation results differ from real hardware behavior (timing/peripherals/kernel drivers) — conclusions that involve hardware interaction are verified with [[re-hardware-io]]

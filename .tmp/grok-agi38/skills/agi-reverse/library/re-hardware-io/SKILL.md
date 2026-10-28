---
name: re-hardware-io
description: >
  Hardware interfaces: JTAG/UART/flash readout.
  Triggers: JTAG, UART, `串口`, `flash芯片`, `硬件提取`, `逻辑分析仪`
capabilities: [hardware-interface]
---

# Hardware interfaces (JTAG / UART / flash readout)

## When to use / when not to use

- Use: you have a physical board and need to extract firmware, capture boot logs, or debug in hardware
- Use: JTAG/SWD debug, UART serial, direct flash-chip reads, logic-analyzer signal capture
- Do not use: you only have a firmware file (go to [[re-fw-extract]]; hardware extraction is the last resort)
- Do not use: rootfs is already extracted and you only need static analysis (go to [[re-fw-rootfs]])
- Do not use: you need to run the firmware (try [[re-fw-emulate]] first; it is safer and cheaper)

## Tool setup

Verify every tool before use. Hardware work is high risk: measure levels with a multimeter, share ground, and check silkscreen before power-on (see pitfalls 3/4). Follow [[re-analyze/platform-tips]] and give the lightest workable path first: exhaust software means (file → unpack → emulate) before touching hardware.

### openocd — JTAG/SWD debug

- Linux: `apt install openocd` / `dnf install openocd` / `pacman -S openocd`
- macOS: `brew install openocd`
- Windows: `choco install openocd` (or the official Windows build)
- Verify: `openocd --version`

### picocom / minicom — serial terminal

- Linux: `apt install picocom` (or `apt install minicom`) / `dnf install picocom` / `pacman -S picocom`
- macOS: `brew install picocom`
- Windows: `choco install putty` (PuTTY supports serial) or the Linux build inside WSL
- Verify: `picocom --version`

### flashrom — flash-chip readout

- Linux: `apt install flashrom` / `dnf install flashrom` / `pacman -S flashrom`
- macOS: `brew install flashrom`
- Windows: official build or WSL (the ch341a programmer inside WSL uses `flashrom -p ch341a_spi`)
- Verify: `flashrom --version`

### Logic analyzer (sigrok-cli / pulseview)

- Linux: `apt install sigrok-cli pulseview` / `dnf install sigrok-cli pulseview` / `pacman -S sigrok-cli pulseview`
- macOS: `brew install sigrok-cli pulseview`
- Windows: the official sigrok Windows installer (sigrok.org)
- Verify: `sigrok-cli --version` / `pulseview --version`

### JTAGulator — pin-identification board (open hardware)

- Open-hardware project `git clone https://github.com/grandideastudio/JTAGulator` (firmware and docs); you must buy or fabricate a JTAGulator board yourself
- Verify: after a serial connection, sending `help` prints the command list
- Use it to enumerate UART/JTAG pins automatically on an unknown board (the workhorse for steps 1/2)

### Hardware buying guide (common options and levels)

- USB-UART adapters: CH340 / CP2102 / FTDI all work. Pick a 3.3V TTL model (a 3.3V/5V jumper is more general) — 5V TTL into a 3.3V board burns the port (see pitfall 3)
- Debuggers: ST-Link v2 (STM32 family; SWD and JTAG), J-Link (general; paid license), CMSIS-DAP/DAPLink (open-firmware option) — pick by the target vendor
- SPI flash programmers: ch341a (the cheapest SOIC8 option) plus a clip or test socket; for multi-protocol needs use an RT809H-class programmer
- Logic analyzers: pick sample rate from the signal rate — UART 115200 and slow SPI are fine on an 8-channel 24MHz-class device; fast SPI (tens of MHz) needs 100MHz+ sampling (rule of thumb: sample rate at least 4× the signal rate)
- Level translation: when mixing a 1.8V/2.5V board with 3.3V tools, use a bidirectional translator module such as TXS0108

## Procedure

Run in order. Record the result of each step.

1. **Board teardown and interface location**:
   - Open the case and inspect the PCB: silkscreen (TX/RX, VCC, GND, JTAG/SWD test points), headers, flash chip model (for example W25Q128, MX25L, GD25Q)
   - Multimeter: measure the supply level (3.3V is common; 5V and 1.8V also occur) and find GND; UART TX signature — a square wave pulled to logic high at the instant of power-on
   - Photograph for the archive: silkscreen, pin numbers, flash model, for later wiring checks
2. **UART serial debug (baud enumeration)**:
   ```sh
   picocom -b 115200 /dev/ttyUSB0        # try 115200 first
   # garbage → Ctrl+A Ctrl+X to exit, then try 9600 / 57600 / 38400 / 19200 / 230400
   # or minicom -D /dev/ttyUSB0
   ```
   - TX/RX must be crossed (board TX ↔ adapter RX); shared ground is mandatory
   - Capture the boot log at the instant of power-on — the fastest way to learn the system (see pitfall 4)
3. **JTAG/SWD connection (openocd)**:
   ```sh
   openocd -f interface/stlink.cfg -f target/stm32f1x.cfg   # ST-Link + SWD example
   # other adapters: pick the matching cfg under /usr/share/openocd/scripts/interface/
   ```
   - Confirm the interface type (JTAG 4/5-wire vs SWD 2-wire) and the level (a 1.8V board needs a level adapter)
   - Once attached, `halt` to pause, read registers, and dump flash (`flash read_bank 0 dump.bin`)
   - One-line command mode (scripted / non-interactive): `openocd -f interface/stlink.cfg -f target/stm32f1x.cfg -c "init; halt; flash read_bank 0 dump.bin; exit"`
4. **Flash-chip readout (flashrom / programmer)**:
   ```sh
   # on-board SPI flash (linux_spi needs kernel spidev):
   flashrom -p linux_spi:dev=/dev/spidev0.0 -r backup.bin
   # offline read (ch341a programmer + SOIC8 clip; power off first):
   flashrom -p ch341a_spi -r backup.bin
   ```
   - Check the chip model and package (SOIC8 clip / test socket). Do not reverse pin orientation
   - Hand the dumped image to [[re-fw-extract]] to unpack
5. **Boot-log capture**:
   - Serial is connected → power the board → capture the full log (`picocom` output through `tee log.txt`, or minicom capture)
   - The log contains bootloader, kernel boot, filesystem mounts, and service autostart; compare with startup scripts in [[re-fw-rootfs]] to locate them
   - No UART output → return to step 1 and recheck wiring/baud, or capture the TX pin with a logic analyzer

## Cross-domain

- [[re-firmware]]: workflow step 5 (when hardware is required) calls this skill
- Extracted flash image → [[re-fw-extract]] unpack → [[re-fw-rootfs]] analysis; if it must run → [[re-fw-emulate]]
- Communications/protocols captured on the hardware → [[re-protocol]]
- Hardware extraction is the last resort of firmware analysis: use it only after software means (file → unpack → emulate) are exhausted
- Physical-layer chip/PCB analysis (decap / die / trojan detection) → [[re-hw-chip]]

## Common pitfalls

- **Wrong baud → garbage**: symptom — serial output is all garbage or silent; cause — baud/data bits do not match, or TX/RX are swapped; fix — enumerate 9600 / 115200 first (57600 / 38400 / 230400 as fallback), verify the TX waveform with a logic analyzer, and shared ground is mandatory
- **JTAG fused or locked**: symptom — openocd will not connect, IDCODE is all 0 or times out; cause — the production board fused JTAG, or read protection (RDP) is on; fix — try SWD, an unlock sequence such as `stm32f1x unlock`, or give up JTAG and switch to UART plus a direct flash read (step 4)
- **5V/3.3V level mixup burns the board**: symptom — after wiring, the board heats, smokes, or is permanently damaged; cause — level mismatch (5V TTL on a 3.3V board), wrong supply, or VCC/GND reversed; fix — measure level and GND with a multimeter before wiring; use a 3.3V adapter on a 3.3V system; never hot-plug
- **Read the boot log before touching anything**: symptom — blindly desoldering flash or attaching JTAG causes damage or data loss; cause — skipping cheap observation and going straight to hardware; fix — capture the boot log over UART first and learn the system (steps 2/5), then decide whether a hardware read is needed — this is [[re-analyze/platform-tips]] "lightest workable path first" applied to hardware
- **Intel DCI debugger toolchain compatibility pitfall**: symptom — Intel System Studio 2019 (System Debugger) fails to install or run on Win10/11, and the DCI cable will not attach to the CPU; cause — the software was built for Win7 and includes environment checks plus license validation: Win11 reports a missing Win7 security patch, and the public license file is invalid on the Windows build; fix — install in compatibility mode; run with `--noprereq` to skip the environment check; the license check lives in exported functions of `issa.dll` (three check functions) — patch them and replace the DLL; pick the DCI config by platform (for example KBL=Kaby Lake, SPT=200-series boards, DBC=Debug Class cable). For CLI debug use `PythonConsole.cmd` in the DAL directory (Python 2.7 environment; commands such as `itp.cores` / `itp.halt()`); the ME side must be UTOK-unlocked before it answers debug commands (see [[re-fw-extract]])
- Command-family cheat sheet and operation sequences: [[commands]]. Tool-specific pitfalls and version differences: [[gotchas]]

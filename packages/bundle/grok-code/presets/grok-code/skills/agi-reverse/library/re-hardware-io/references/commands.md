# Hardware-interface command cheat sheet and operation sequences (UART / JTAG-SWD / Flash / logic analyzer)

Tool-family split: picocom/minicom (serial terminal) → openocd (JTAG/SWD debug and flash dump) → flashrom (direct SPI flash read) → sigrok-cli/pulseview (logic analyzer) → JTAGulator (pin enumeration on an unknown board). Before any hardware step: measure levels with a multimeter, share ground, and check silkscreen (see [[gotchas]] and the pitfalls in SKILL.md).

## Command-family cheat sheet

### Serial (picocom / minicom)

| Purpose | Command |
|---|---|
| Open the serial port | `picocom -b 115200 /dev/ttyUSB0` |
| Exit picocom | `Ctrl+A Ctrl+X` |
| No flow control | `picocom -b 115200 --nolock /dev/ttyUSB0` (pair with sudo when permissions are insufficient) |
| minicom variant | `minicom -D /dev/ttyUSB0` (`Ctrl+A Z` help, `Ctrl+A X` exit) |
| Confirm the serial device | `ls /dev/ttyUSB* /dev/ttyACM*`; `dmesg \| grep tty` (watch for a new node after plug/unplug) |
| Log to a file | `picocom ... \| tee log.txt` (or minicom's capture feature) |

### openocd — JTAG/SWD (Telnet interactive + command line)

| Purpose | Command |
|---|---|
| ST-Link + STM32F1 | `openocd -f interface/stlink.cfg -f target/stm32f1x.cfg` |
| Other adapters | `ls /usr/share/openocd/scripts/interface/` (pick jlink/swd and others by name) |
| One-line command mode | `openocd -f <if> -f <target> -c "init; halt; flash read_bank 0 dump.bin; exit"` |
| Interactive mode | After start, connect `telnet localhost 4444` (default port) |
| halt (pause) | `halt` |
| Read registers | `reg pc` / `reg sp` / `reg` (all) |
| Read memory | `mdw <addr> 16` (16 words, 32-bit) / `mdb` / `mwh` |
| Write memory | `mww <addr> <val>` (dangerous; read before write) |
| Dump flash | `flash read_bank 0 dump.bin` (bank number and image size come from `flash banks`) |
| Erase/write flash | `flash erase_sector 0 0 last` / `flash write_bank 0 firm.bin` (a write destroys the original; back up first) |
| Reset | `reset` / `reset halt` |
| Unlock (read protection) | commands of the `stm32f1x unlock 0` family (by target series; see [[gotchas]]) |

### flashrom — direct SPI flash read

| Purpose | Command |
|---|---|
| List chip models | `flashrom -p ch341a_spi` (identify first, without -r) |
| Read | `flashrom -p ch341a_spi -r backup.bin` |
| On-board SPI (spidev) | `flashrom -p linux_spi:dev=/dev/spidev0.0 -r backup.bin` |
| Verify | `flashrom -p ch341a_spi -v backup.bin` (read back and compare) |
| Write | `flashrom -p ch341a_spi -w new.bin` (destructive; read before write) |
| Force a model | `-c <chipname>` (when identification fails but the model is known, as in `flashrom -p ch341a_spi -c "W25Q128"`) |

### Logic analyzer (sigrok-cli)

| Purpose | Command |
|---|---|
| List devices | `sigrok-cli -L` / `sigrok-cli --scan` |
| Capture samples | `sigrok-cli -d <driver>:conn=<device> -c samplerate=1M -O <format> -o data.sr -t 10s` |
| UART decode | `sigrok-cli -d ... -A uart:rx=<channel>:baudrate=115200 -o out.txt` |
| SPI decode | `-A spi:clk=<pin>:mosi=<pin>:miso=<pin>:cs=<pin>` |
| Graphical view | `pulseview` (GUI; load a .sr and decode protocol by protocol) |

### JTAGulator — pin enumeration

```
Serial connection (for example /dev/ttyUSB0, 115200) → send help to list commands
UART enumeration: the uart command sweeps baud rate pin by pin
JTAG enumeration: the jtag command (power the target off/on as prompted)
```

## Common operation sequences

### 1. Capture UART boot logs (the lightest firmware intelligence)

```
Multimeter confirms VCC/GND/TX (TX is a square wave pulled high at power-on) → crossed wiring + shared ground
→ picocom -b 115200 → if garbled, Ctrl+A Ctrl+X and try 9600/57600/38400/19200/230400
→ power-cycle the board and capture the full boot log → archive with tee log.txt
→ log contains bootloader/kernel/filesystem/service autostart → compare with startup scripts in [[re-fw-rootfs]]
```

### 2. Direct SPI flash read (offline extraction)

```
Power off → clip the SOIC8 clip onto the flash (check pin-1 orientation) → programmer on USB
→ flashrom -p ch341a_spi (identify the model) → -r backup.bin → power off and remove
→ hand the image to [[re-fw-extract]] to unpack; keep the original bin and sha256
```

### 3. Attach JTAG/SWD and dump flash (on-board, live)

```
Use silkscreen to find JTAG/SWD test points (VCC/GND/TMS-TCK-TDO-TDI or SWDIO/SWCLK) → attach the debugger
→ openocd -f interface/stlink.cfg -f target/stm32f1x.cfg → halt
→ flash banks for the bank list → flash read_bank 0 dump.bin
→ on failure (IDCODE all 0 / timeout) → check fuse / read protection (see [[gotchas]])
```

### 4. Logic analyzer captures UART to verify baud rate

```
Board TX to an analyzer channel (shared ground) → sigrok-cli -c samplerate=1M sample
→ -A uart:baudrate=115200 decode → if garbled, retry 9600/57600
→ waveform confirms TX idle level and frame format (8N1) → infer the real baud rate
```

## Lessons internalized

- Hardware steps are highly irreversible: observe first (multimeter / logic analyzer / boot log), then act (solder / write)
- Photograph and note every wiring change or jumper: silkscreen, pin numbers, levels, wire colors — rework depends on that
- Before any flash write, read a backup and verify (`-v`) — a bad write cannot be undone
- If one tool fails, switch path: locked JTAG → UART plus a direct flash read; a bad flash solder joint → an in-circuit read; always keep the lightest option
- Archive extraction products (dump.bin + sha256 + board type / chip model) for [[re-fw-extract]] / [[re-fw-rootfs]]

## Usage notes

- Wire with power off; hot-plugging is the leading cause of burned boards (see [[gotchas]])
- Archive sha256 of extracted images and logs; write hardware notes (time / steps / photos) into the analysis notes ([[re-triage]] convention)
- Board provenance and authorization: analyze only hardware you own or are permitted to analyze

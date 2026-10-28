# Hardware-interface tool-specific pitfalls and boundaries

## Levels and power (high risk of burning the board)

- **A 5V signal on a 3.3V board burns it**: measure the board's logic level with a multimeter first (3.3V is common; 5V and 1.8V also occur) — if the adapter/analyzer level does not match, use a bidirectional translator such as TXS0108. Never force the connection
- **VCC/GND reversed**: wire ground first, then signal lines; before power-on, use the continuity range to confirm VCC-GND is not shorted
- **Hot-plugging**: the inrush when wiring a USB device (debugger / programmer / analyzer) can damage the port — the standard flow is wire with power off, then power on and verify
- **Bad clip contact**: a crooked or oxidized SOIC8 clip causes identification failure or shifted read data — verify with `-v`, read twice and compare; if contact is unstable, switch to a test socket

## Interface identification and connection

- **Silkscreen is unreliable**: TX/RX printed on the board may be the chip's view or the board's view — if the serial port is silent, swap TX/RX, then measure with a logic analyzer
- **Wrong baud guess**: garbage does not mean the port is dead — enumerate 9600/115200 first (57600/38400/230400 as fallback); a logic analyzer on TX that counts bit width is the most accurate
- **TTL levels are not RS-232 levels**: a DB9 serial port on old gear is ±12V RS-232. A USB-UART adapter cannot connect directly — it needs an RS-232 level translator (MAX232 class)
- **JTAG pins are multiplexed**: production boards often mux JTAG pins as GPIO or only bring out SWD — if silkscreen shows only 4 pins, try SWD first

## JTAG/SWD fuses and protection

- **IDCODE all 0 / timeout**: the production board fused JTAG off (or RDP read protection is on) — openocd failing to connect is normal; try the SWD interface and the unlock sequence for the target series (for example `stm32f1x unlock 0`; on some series unlock erases flash — back up and assess first)
- **Debugger power conflict**: ST-Link/J-Link supplies the target by default (3.3V). If the target already has its own supply, the two rails fight — turn off the debugger's power option, or wire signals only
- **Level mismatch will not connect**: a 1.8V target on a 3.3V debugger risks a burned port and also fails electrical specs — pick the adapter for the target level (newer ST-Link adapts across 1.65-3.6V; older ones do not)

## Flash read quality

- **Model not identified**: a new chip has no entry in an old flashrom — run `flashrom -p ch341a_spi` and read the output. If identification fails but the silkscreen model is clear, force it with `-c` (your risk; verify the ID first)
- **Read is all 0 or all FF**: the clip is not seated, the chip is write-protected, or the SPI voltage is wrong — compare the read-back size with the silkscreen model capacity. Empty data means check contact first
- **Read-protected chips**: some MCUs have built-in flash read protection (RDP/OTP) — flashrom cannot read them. Use the openocd unlock flow, or switch to a UART / firmware-update channel
- **Large-image verification**: a 64MB+ flash read takes a long time, and a mid-read disconnect corrupts the file — add `-v` and re-read on failure

## Logic-analyzer sampling

- **Sample rate too low → waveform artifacts**: below 4× the signal rate, edges are missed (rule of thumb) — UART 115200 needs ≥1MHz; SPI at tens of MHz needs a 100MHz+ device. Pick the device from the signal rate before capturing
- **Channel mix-up**: when capturing several channels, pin labels and physical positions get swapped — before capture, calibrate a channel with a known signal (for example TX idle-high)
- **Wrong decoder parameters**: a UART decoder with the wrong baud or data bits produces garbage — confirm bit width on the waveform, then change parameters

## Version differences

- **openocd**: 0.12.x is the latest formal release (2021); distro packages vary in age — script paths follow whatever is actually under `/usr/share/openocd/scripts/`; newer builds support more domestic MCUs (new cfg files under target/), and an old build may lack the matching target file
- **flashrom**: 1.4 (2024) is the mainstream line, and new chip entries keep landing — an old version will not identify a new SPI flash, so upgrade first; ch341a_spi support has been mature since 1.0
- **sigrok-cli/pulseview**: 0.7.x has been stable for a long time; decoders grow with the version, and old builds lack newer protocol decoders
- **JTAGulator**: the open-source firmware has had no formal new release for a long time; behavior follows the firmware burned on the board. Home-etched boards must match the official pinout

## Usage notes

- Wire with power off, measure before connecting, and shared ground is mandatory (walk SKILL.md pitfall 3 first)
- Archive extraction products (image + sha256 + board type / chip model) ([[re-triage]] convention) and hand them to [[re-fw-extract]] / [[re-fw-rootfs]]
- Operate only hardware you own or are authorized to use

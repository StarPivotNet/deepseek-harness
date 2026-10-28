---
name: re-sdr
type: atomic
description: >
  RF reversing: signal capture, spectrum analysis, demodulation, frame sync and protocol recovery, replay.
  Triggers: SDR, `射频`, `信号分析`, `解调`, RTL-SDR, HackRF, `无线协议`, `遥测`.
capabilities: [rf-analysis, sdr-analysis]
---

# RF signal reversing (SDR)

## When to use / when not to use

- Use: a wireless protocol / remote-control / telemetry signal (wireless IoT, a remote, a telemetry link), and signal-level protocol recovery
- Use: a quick identification of a 433/868/915MHz ISM sensor or remote (`rtl_433` ships decoders; see [[commands]])
- Use: a replay-attack check (authorized targets only — decode the frame first, then replay; do not replay blindly)
- Do not use: a wired protocol (switch to [[re-protocol]]); a wireless IoT protocol that is already encapsulated (switch to [[re-iot-proto]])
- Do not use: only an already-demodulated data stream or the application layer (go straight to [[re-proto-rev]] / [[re-crypto-decrypt]])
- Do not use: monitoring several channels at once (one RTL-SDR is one channel; several channels need several devices or a phase-coherent capture plan)

## Tool setup

### RTL-SDR / HackRF (receive hardware)

- Buying guide: RTL-SDR (receive, a cheap start) / HackRF (transmit and receive; replay needs it)
- Drivers: `apt install rtl-sdr` / `brew install rtl-sdr`; HackRF: `apt install hackrf` / `brew install hackrf`
- Check: after the hardware is plugged in, `rtl_test` or `hackrf_info` prints something
- Frequency calibration: `rtl_test -p` for a few minutes and read the stable ppm error. During capture, compensate with `rtl_sdr ... -e <ppm>` — frequency offset is the first cause of demodulated garbage
- Bandwidth difference: an RTL-SDR is stable at about 2.4MHz (the theoretical 3.2MHz is unstable). A HackRF goes up to 20MHz and is half-duplex — wideband capture and active transmit use a HackRF (see [[gotchas]])

### GNU Radio (signal processing)

- Linux: `apt install gnuradio` / `pacman -S gnuradio`; macOS: `brew install gnuradio`
- Windows: the official installer
- Check: `gnuradio-companion --version` or `grcc --version`
- Headless compile: `grcc flow.grc` compiles a flow graph into a runnable Python script — a file-managed demodulation chain is faster than dragging wires in the GUI for a batch or a repeat

### Gqrx (spectrum / receive GUI)

- Debian/Ubuntu: `apt install gqrx-sdr` (the package name has the `-sdr` suffix); Arch: `pacman -S gqrx`; Fedora: `dnf install gqrx`; macOS: `brew install --cask gqrx`
- Check: `gqrx --version` (or the GUI opens and shows the spectrum waterfall)
- Purpose: a live spectrum / waterfall to find an active signal and its center frequency faster than a command-line sweep

### inspectrum (spectrum / timing visualization)

- Linux: `apt install inspectrum` or a source build; macOS: `brew install inspectrum`
- Check: `inspectrum --version`
- Purpose: offline time-domain / spectrum analysis of a recorded IQ file (frame structure, symbol width)

### Universal Radio Hacker (URH) (demodulation and frame recovery)

- All platforms: `pip install urh`
- Check: `urh --version`
- Purpose: demodulation (modulation identification), bitstream analysis (sync word / coding inversion), and field splitting in one tool

### rtl_433 (ISM sensor decoding)

- Debian/Ubuntu: `apt install rtl-433`; Fedora: `dnf install rtl-433`; macOS: `brew install rtl_433` (underscore); Arch: `pacman -S rtl_433`
- Check: `rtl_433 -h` lists supported devices (for example 0: a generic protocol family, 1: a temperature/humidity meter…)
- Purpose: one-shot decoding of common 433/868MHz remote protocols (weather stations, temperature/humidity, garage doors)
- Continuous output: `rtl_433 -F json -f 433.9M` keeps printing decoded JSON — redirect the log for a long watch or for capturing several devices

## Steps

Run in order. Authorized testing only (the line: replay and interaction need authorization).

1. **Signal capture and spectrum analysis**:
   ```sh
   # 示例（工具可替换）：GNU Radio 或命令行采集
   rtl_sdr -f 433.9M -s 1M capture.iq
   ```
   - Sweep the band first (find the active signal) → fix the center frequency and bandwidth → capture IQ
   - Sweep: `rtl_power -f 400M:470M:250k -g 40 -i 10 scan.csv` (CSV output; gnuplot can plot it) or the Gqrx waterfall
   - Modulation identification: the spectrum shape (FSK twin peaks / a flat PSK / an AM carrier). Watch it live in Gqrx; inspect it offline in inspectrum
   - Capture flags: `rtl_sdr -f <frequency> -s <sample-rate> -g <gain> -n <sample-count> out.iq`; `-g 0` is automatic gain
   - Sample-rate rule: sample rate ≥ 2× signal bandwidth — a narrowband remote (tens of kHz) is fine at 250k–1M. Do not open the full 2.4M just to save effort; it only grows the file

2. **Demodulation**:
   - URH: load the IQ → automatic or manual modulation identification → demodulate to a bitstream
   - GNU Radio: build the demodulation chain from the identification (AM/FM/PSK/QAM/FSK)
   - A quick listen: `rtl_fm -f 433.9M -M fm -s 22050` (listen to FM voice / FSK audio; listening or recording helps identification)
   - Product: a demodulated bitstream (a 0/1 sequence)

3. **Frame sync and protocol recovery**:
   - Open the capture in URH → the bitstream view finds the sync word and tries a coding inversion (NRZ/Manchester)
   - Find the sync word (a repeated pattern / a fixed prefix) → fix the frame boundary → split fields (address / length / payload / CRC)
   - Compare several frames (repeated transmissions) → an unchanged field is a fixed header, a changing field is data or a sequence number
   - Bits to bytes: confirm bit order (MSB/LSB first) and length alignment (a multiple of 8) first — URH displays bits by default. Check before converting to bytes, or every field split is wrong
   - Product: a frame-structure table (field offset / length / meaning)
   - A known ISM device: run `rtl_433 -f 433.9M -A` first (`-A` analysis mode prints the recovered pulse train and a protocol guess) — a common protocol (weather station / garage door / tire pressure) hits directly and skips manual recovery

4. **Replay and interaction** (an authorized case):
   - HackRF replays a captured frame (a replay-attack check — authorized targets only):
     ```sh
     hackrf_transfer -r capture.iq          # 先采集（HackRF 口）
     hackrf_transfer -t capture.iq -f 433.9M -a 1 -s 2M   # 回放（-a 1 开放大器）
     ```
   - Interactive: change a field and resend (a rolling code or encryption must be analyzed first — switch to [[re-crypto-id]] / [[re-crypto-decrypt]])
   - Before replay, confirm the sample rate and gain match the capture — a mismatch means the target never receives the replay (see [[gotchas]])

5. **Evidence wrap-up**: file the IQ, the demodulated bitstream, the frame-structure table (field offset / length / meaning), and the replay record (time / parameters / result) against each other. Write the conclusion into [[re-analyze/analysis-contract]] — archive signal-level evidence (screenshots / waveforms) apart from protocol-level conclusions (the frame structure)

## Cross-domain handoff

- [[re-iot-proto]]: the wireless IoT protocol continues here (the MQTT/CoAP encapsulation layer and the rest)
- [[re-protocol]]: frame-structure state-machine recovery continues here
- [[re-crypto-id]] / [[re-crypto-decrypt]]: encrypted-payload analysis
- [[re-feedback]]: signal-case experience, after redaction

## Pitfalls

- **Frequency offset / wrong sample rate**: symptom — demodulation is all garbage; cause — the center frequency is off, or the sample rate does not match; fix — calibrate first with a known signal (an FM broadcast)
- **A wrong modulation**: symptom — FSK was demodulated as PSK; cause — the spectrum features look alike; fix — compare the time-domain waveform (inspectrum) before deciding
- **Replay needs authorization**: symptom — an unauthorized replay triggered a device action; cause — the operation crossed the line; fix — the line: authorized targets only
- **A missed coding inversion**: symptom — the bitstream is entirely inverted; cause — NRZ/Manchester was not identified; fix — try the inversion and coding-mode combinations
- **An incomplete capture**: symptom — the frame is truncated; cause — not enough bandwidth, or the trigger timing; fix — widen the bandwidth, capture longer, and trigger on the sync word
- **RTL-SDR image frequencies and the bandwidth limit**: symptom — the captured signal appears at the wrong frequency, or demodulation falls apart above 2.4MHz; cause — direct-sampling aliasing, or an unstable USB transfer; fix — bandwidth ≤2.4M, calibrate ppm with `rtl_test -p` first, then compensate with `-e` (details in [[gotchas]])
- **URH is weak on complex modulation**: symptom — URH cannot produce a stable bitstream for DSSS/OFDM/frequency hopping; cause — URH is built for simple modulation (ASK/FSK/PSK); fix — a spread-spectrum signal uses a full GNU Radio demodulation chain (despread / equalize). URH only does the later bitstream analysis
- Hardware differences and tool-specific pitfalls are in [[gotchas]]. The command lookup is in [[commands]]

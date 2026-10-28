# SDR tool pitfalls and limits

## Hardware (RTL-SDR / HackRF)

- **The bandwidth ceiling is not the advertised number**: an RTL-SDR is advertised at 3.2MHz, but above 2.4MHz the USB transfer is unstable (dropped samples / garbage) — ordinary capture stays ≤2.4M. Wideband needs a HackRF
- **Image frequencies (image aliasing)**: under direct sampling, energy outside center ± sample-rate/2 folds into the band — a "ghost signal" near a strong source is an image until proven otherwise. Check with a filter or a different frequency. Do not analyze it as a real signal
- **ppm frequency error**: an RTL-SDR crystal is off by tens of ppm, and the offset grows with frequency — `rtl_test -p` for the stable value, then `-e <ppm>` on the capture. A narrowband signal (a remote) is the most sensitive to frequency offset
- **HackRF is half-duplex**: a HackRF One can only receive or transmit at one time — "record and replay at the same time" is impossible. Record first, then play. Full duplex needs higher-end hardware
- **A bad gain**: `-g` too high clips (IQ values saturate at 255 and demodulation is entirely wrong); too low drowns in noise — adjust from the `rtl_sdr` output statistics or the waterfall. Automatic gain `-g 0` is a stable start
- **A mismatched sample rate (replay)**: replay parameters (sample rate / gain) that do not match the capture mean the target receives nothing or demodulates wrong — check the capture command's parameters before replay. Prefer the same device and the same parameters

## Signal analysis

- **A wrong modulation**: FSK and PSK spectra look alike (both look like a flat band) — tell them apart in the time domain (inspectrum): FSK has a clear symbol transition, PSK has a phase jump. Listen and look at the waterfall before picking a demodulator
- **Coding inversion / bit order**: the bitstream is entirely inverted (NRZ-I class) or the byte order is reversed — try inversion and coding combinations in URH. Confirm MSB/LSB before converting to bytes
- **Carrier offset**: the signal is not centered in the capture (it sits outside the filter passband) and demodulation quality drops — fine-tune the center frequency in Gqrx before capture, or add a frequency-offset correction in the demodulation chain (the GNU Radio `freq_xlating_fir_filter` idea)
- **A truncated frame**: a late trigger or not enough bandwidth cuts the frame short — lengthen the capture window, trigger on the sync word (a GNU Radio trigger block), and capture several stretches so a complete frame is in the set
- **URH is weak on complex modulation**: DSSS/OFDM/frequency hopping does not produce a stable bitstream — those signals use a full GNU Radio chain (despread / equalize). URH only post-processes the bitstream
- **Interference and harmonics**: a strong transmitter in a neighboring band (WiFi, an FM broadcast) puts harmonics or intermodulation into the target band — change frequency or add a bandpass filter (hardware) to rule it out

## Tools

- **The gqrx package name (Debian)**: the package is `gqrx-sdr`, not `gqrx` (`apt install gqrx` does not find a package). Arch/Fedora use `gqrx`
- **rtl_433 package names differ by platform**: Debian `rtl-433`, Fedora `rtl-433`, macOS `rtl_433` (underscore), Arch `rtl_433` — a cross-platform script cannot assume one package name
- **URH's release pace**: `pip install urh` installs the latest PyPI build, which lags the main repository — check the URH repository releases for new hardware or new modulation support. The GUI and CLI follow the installed version's help
- **inspectrum is read-only analysis**: inspectrum cannot demodulate or export a bitstream — it is a visualization check. Bitstream work still goes through URH/GNU Radio
- **Parsing rtl_power CSV**: rows are `date,time,Hz_start,Hz_step,samples,power1,power2,...` — a parser treats the power columns at the end of the row. Do not shift them

## The authorization line (independent of the tool)

- Receive-side capture is generally unrestricted (the law depends on the region). **Transmit, replay, and jamming are active interaction** — authorized targets and bands only, and confirm the local radio rules first
- Before a replay check, record the target's behavior baseline (inside the authorized scope). The result is only for the analysis conclusion. Do not spread it
- A rolling-code or encrypted device that ignores a replay is normal (an algorithm problem) — analyze the algorithm in [[re-crypto-id]] / [[re-crypto-decrypt]]. Do not keep replaying blindly

## Notes

- Run everything inside a sandbox or an authorized environment (the top rule in [[re-analyze/platform-tips]]). Transmit operations default to physical isolation of the sandbox
- Record the full capture parameters (frequency / sample rate / gain / time). Keep the original IQ copy (replay and re-analysis reuse it)

# SDR command lookup and operation sequences

The SDR chain groups tools as capture → spectrum → demodulation → bitstream/frame analysis → replay. Commands follow each tool's official docs (osmocom rtl-sdr, greatscottgadgets hackrf, the official rtl_433 README, the URH docs).

## Command families

### Hardware check

- `rtl_test [-s sample-rate]`: RTL-SDR self-test (it self-tests on open; `Successfully opened` means OK)
- `rtl_test -p`: measure the ppm frequency error (leave it for a few minutes and read the stable value; compensate with `-e <ppm>` during capture)
- `hackrf_info`: HackRF firmware / serial (OK when `board_id` / `serial_number` are visible)

### Capture

- `rtl_sdr -f <frequency> -s <sample-rate> -g <gain> -n <sample-count> out.iq`: RTL-SDR raw IQ (8-bit unsigned interleaved I/Q; `-g 0` is automatic gain; `-e` adds ppm compensation)
- `rtl_sdr -f 433.9M -s 1M capture.iq`: a basic capture (GNU Radio / inspectrum / URH can all read it)
- `hackrf_transfer -r capture.iq -f 433.9M -s 2M -a 1`: HackRF capture (`-a 1` enables the RX amplifier; the sample-rate ceiling is higher, so use it for wideband)
- `hackrf_transfer -t capture.iq -f 433.9M -s 2M -a 1`: HackRF replay transmit (a replay-attack check — authorized targets only)

### Spectrum / monitoring

- `rtl_power -f 400M:470M:250k -g 40 -i 10 scan.csv`: a sweep written as CSV (frequency / time / power); gnuplot/Excel draws the waterfall
- `gqrx`: a GUI spectrum plus a live waterfall; `rtl_fm`: a quick listen or record of AM/FM audio (`rtl_fm -f 433.9M -M fm -s 22050`)

### Demodulation

- URH (GUI): `urh` → open the IQ → the Signal view identifies modulation automatically or by hand → Demodulate → the bitstream view
- GNU Radio: `gnuradio-companion` builds the demodulation chain (RTL-SDR Source → filter → demodulator → bitstream); `grcc flow.grc` compiles it headless into a Python script
- `rtl_433 -f 433.9M -A`: one-shot ISM demodulation plus a protocol guess (`-A` prints the pulse train and the protocol hit); `-F json` is JSON output

### Frame / bitstream analysis

- `inspectrum capture.iq`: offline spectrum plus time domain (frame structure, symbol width, the sync word's time-domain feature)
- URH bitstream view: find the sync word, a coding inversion (NRZ/Manchester), and the field split
- `rtl_433 -R <protocol-number>`: decode one protocol family (the number is in the `-h` list)

### Signal generation (an authorized helper)

- GNU Radio waveform generation: build a transmit chain to replay or edit a field (HackRF Source output)
- `hackrf_transfer -t` replays raw IQ directly (the fastest path when nothing is edited)

## Common sequences

### 1. Full-band sweep → locate → capture

```
rtl_power -f 300M:500M:250k -g 40 -i 10 scan.csv   # 找活跃频点
# CSV 里找稳定高功率频点 → gqrx 对该频点确认
rtl_sdr -f <频点> -s 1M -g 40 -n 8000000 cap.iq    # 8M 采样 ≈ 8 秒（1M 采样率）
```

### 2. Recover an unknown remote protocol (capture → the full URH flow)

```
rtl_sdr -f 433.9M -s 1M -g 40 -n 8000000 cap.iq
urh → 打开 cap.iq → 调制识别（ASK/FSK）→ 解调 → 位流
找重复帧 → 标同步字 → 编码反转试验（NRZ/Manchester 组合）
多帧对照 → 字段划分（固定头/地址/长度/载荷/CRC）→ 帧结构表
```

### 3. Quick identification of a known ISM device (rtl_433 direct)

```
rtl_433 -f 433.9M -A            # 分析模式：看协议猜测与脉冲序列
rtl_433 -f 433.9M -F json       # 持续 JSON 输出（长时间监测）
# 命中协议 → 用 -R 限定 → 字段语义对照官方/社区解码器
```

### 4. Replay check (authorized targets only)

```
hackrf_transfer -r cap.iq -f 433.9M -s 2M -a 1     # 用 HackRF 重新采集（保证采样率匹配）
hackrf_transfer -t cap.iq -f 433.9M -s 2M -a 1     # 原样回放
# 观察目标动作；失败先查采样率/增益是否与采集一致
# 改字段重放: GNU Radio 解调→改 bit→重新调制→hackrf_transfer -t
```

### 5. Demodulated bitstream → protocol state-machine recovery (continues at [[re-proto-rev]])

```
URH 导出位流/字段 → 帧结构表（偏移/长度/语义）
多帧时序分析（重发/序号递增/ACK）→ 状态机假设 → 改字段重发验证
```

## Lessons (internalized)

- Compute the sample-rate and bandwidth relation first: sample rate ≥ 2× signal bandwidth. Do not open the full 2.4M for a narrowband signal (a large file, no benefit)
- Calibrate the frequency offset before capture: `rtl_test -p` for the ppm, `-e` to compensate — when demodulation is garbage, suspect the frequency before the modulation identification
- Coding inversion and bit order are the second bitstream pitfall: try NRZ/Manchester and MSB/LSB. Switching them in URH is cheap
- Comparing several frames is the core method for recovering a frame structure: press the same remote several times. An unchanged field is a fixed header; a changing field is data or a sequence number
- A known device runs `rtl_433 -A` first: common protocols (weather station / garage door / tire pressure) ship a decoder. Do not spend the time on manual recovery
- Name IQ files with frequency / sample rate / time (for example `cap_433.9M_1M_20260825.iq`) so a later session can reproduce them

## Notes

- Run everything inside a sandbox or an authorized environment (the top rule in [[re-analyze/platform-tips]]). The transmit / replay line: authorized targets only
- Capture and replay parameters (frequency / sample rate / gain) must be recorded and kept the same
- Write the conclusion into [[re-analyze/analysis-contract]]. Archive signal-level evidence (IQ / waveforms) apart from protocol-level conclusions (the frame structure)

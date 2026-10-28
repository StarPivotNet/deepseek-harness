---
name: re-hw-chip
type: atomic
description: >
  Physical-layer hardware reversing: decapsulation, die analysis, probing and FIB, PCB circuit analysis, hardware-trojan detection.
  Triggers: `芯片逆向`, `去封装`, decapping, PCB, `硬件木马`, `电路分析`, `裸片`, FIB, `侧信道`, SPA, DPA, `故障注入`, `时钟毛刺`, `电压毛刺`.
capabilities: [chip-analysis]
---

# Chip / PCB hardware reversing

## When to use / when not to use

- Use: physical chip / board-level analysis (physical layer after firmware extraction fails), chip decryption, hardware-trojan detection
- Do not use: firmware-level analysis (go to [[re-fw-extract]]); interface extraction (go to [[re-hardware-io]]); wireless signals (go to [[re-sdr]])

## Tool setup

### Microscope / probe station (observation and contact)

- Buying guide: stereo microscope (first look) → metallurgical microscope (die); grade the probe station by budget
- Verify: no software check — accept on image clarity

### Decapping equipment and consumables (decapsulation)

- Chemical decap: fuming nitric / sulfuric acid + hot plate (protection: fume hood / goggles); laser decap: a dedicated laser (high cost; outsourcing is an option)
- Verify: no software check — accept on how fully the die is exposed

### Logic analyzer (signal extraction)

- Multi-platform: Saleae-class (companion software on each platform) or an open-source option (sigrok/PulseView: `apt install sigrok-cli pulseview` / `brew install sigrok-cli pulseview` (sigrok has no PyPI package))
- Verify: `pulseview --version`

### Thermal imaging (power / timing anomalies, optional)

- Buying guide: pick by resolution and temperature range; verify: accept on the image

## Procedure

Run in order. Watch protection and destructive risk the whole way (step 1 is irreversible).

1. **Decapsulation (decapping)**:
   - Chemical: preheat the hot plate → drip fuming nitric acid to dissolve the epoxy → rinse (acetone) → check under the microscope
   - Laser: ablate layer by layer (higher precision, higher cost)
   - Risk control: fume hood, acid-resistant gloves / goggles, waste-liquid handling; practice on scrap dies first
   - Acceptance: metal layers are visible, with no over-etch (damage to the wafer)

2. **Die analysis**:
   - Microscope imaging (metallurgical / electron microscope) → observe metal-layer routing
   - ROM / fuse extraction: image → bitmap recovery (metal-layer / polysilicon patterns → binary)
   - Output: ROM bitmap → data (compare with the firmware from [[re-fw-extract]])

3. **Probing and signal extraction**:
   - Probe-station contact on test points (bus / clock / data lines)
   - FIB (focused ion beam): edit interconnects / expose internal nodes (high cost, outsource)
   - Signal sniffing: logic analyzer on the bus (timing against the datasheet)
   - Note: probe loading can change the signal (see pitfall 2)

4. **PCB circuit analysis**:
   - Trace recovery (multimeter continuity / imaging → netlist)
   - IC marking identification (silkscreen → part number → datasheet → pin function)
   - JTAG/SWD pin location (test points / trace features → debug-interface enumeration)

5. **Hardware-trojan detection**:
   - Redundant-logic features (flip-flops / counters on paths with no function)
   - Power / timing anomalies (thermal image + current curve against a baseline)
   - Trigger-condition analysis (a specific input combination / temperature / time condition)

## Side channels and fault injection

### Power side channel (SPA/DPA)

- SPA (simple power analysis): observe key-related operations directly on one or a few power traces (bit length of exponentiation, current difference of a conditional branch). Fits cases where the algorithm structure is known
- DPA (differential power analysis):
  - Acquisition principle: many encrypt/decrypt operations under the same key, one power trace recorded each time
  - Differential idea: split traces by a guessed key bit (for example group by whether one bit of a round's S-box output is 0 or 1), average within each group, then subtract; a clear spike under one guess means that intermediate value correlates with power
  - Correlation analysis: correlate intermediate-value bits with the trace point by point (the CPA idea). The spike location is when the operation happens, and can be used to check the guess backward
- Buying points for an acquisition device (chipwhisperer class):
  - Sample rate: several times the target clock at minimum (beyond the Nyquist requirement); a fast clock needs GHz-class sampling
  - Trigger sync: support an external trigger (align to the start of encrypt/decrypt). Trace-by-trace alignment is a precondition of differential analysis
  - SNR: a high-impedance differential probe, a short ground, and shielding cut noise; when noise is high, compensate by averaging more traces
  - Verify: no software check — acquire traces with a known key and confirm the differential spike appears

### Fault injection (clock glitch / voltage glitch)

- Principle: a clock glitch inserts an overly narrow clock cycle at the moment a target instruction executes, so fetch / decode / execute fails, producing effects such as a skipped branch or a corrupted intermediate; a voltage glitch gets a similar effect from a brief undervoltage
- Parameter-sweep flow:
  1. Coarse sweep: step width and phase (injection time) in large steps, and record parameter points that react
  2. Refine: shrink the step on the hit region and locate a stable window
  3. Retest: inject the same parameters many times and confirm the effect replays
- Result judgment: skipped branch (an authorization check passes outright), changed return value (the check function's return was corrupted), no effect or a crash (parameters out of range; back up and resweep)
- Tie-in with decapsulation: die probes can touch clock / bus nodes, so the glitch injection point and the power-observation point coincide, and a side-channel trace can cross-check a probe waveform; after decap there are more injection-point choices (see steps 1/3 above)

### Safety boundary

- Same boundary as the rest of the skill library: only your own equipment / lab samples inside an authorized scope. No specific attack target
- This section is methodology. It does not give operating guidance against a specific object

### Common pitfalls

- **Unsynchronized waveforms make DPA show no correlation**: symptom — the differential trace has no spike and correlation is near zero; cause — trace starts are not aligned (trigger missed, software-trigger delay jitter); fix — switch to a hardware trigger, or realign afterward on a fixed feature point
- **The glitch sweep never hits a window**: symptom — a full-range parameter sweep has no effect; cause — the width/phase step is larger than the hit window; fix — coarse-sweep to find the band, then shrink the step, and raise the repeat count if needed
- **The device locks up after fault injection**: symptom — after injection the device does not respond or enters an abnormal state; cause — the glitch corrupted runtime state or mis-wrote storage; fix — back up firmware before the experiment and prepare a reflash recovery flow; on a batch injection, reboot per batch
- **Acquisition bandwidth is too low**: symptom — traces distort at a high clock (edges slow down, high-frequency detail is lost); cause — acquisition bandwidth is below the signal's spectrum need; fix — pick a device with enough bandwidth for the target clock, or run the clock slower

## Cross-domain

- [[re-hardware-io]]: interface-extraction handoff (JTAG/UART is the software-side entry)
- [[re-fw-extract]]: firmware-side comparison (ROM extract vs firmware dump)
- [[re-sdr]]: wireless side (RF interface)
- [[re-triage]]: initial survey of extracts

## Common pitfalls

- **Decap is irreversible**: symptom — the package cannot be restored after it is destroyed; cause — physical destruction; fix — archive the firmware first ([[re-fw-extract]]) and only then do the physical work
- **Probe loading changes the signal**: symptom — timing goes wrong after the probe is attached; cause — capacitive load; fix — high-impedance probes, and record a baseline before and after attachment
- **FIB is expensive and easy to destroy**: symptom — a failed FIB edit scraps the wafer; cause — ion-beam damage; fix — image and plan first, and outsource to a specialist service
- **Trojan false positive**: symptom — normal redundant logic is called a trojan; cause — the vendor design includes test / repair logic; fix — compare with the datasheet and known circuit patterns. Do not publish at low confidence
- **Missing safety protection**: symptom — a chemical-decap accident; cause — no fume hood / protection; fix — the step 1 risk controls are mandatory and come first

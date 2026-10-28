---
name: re-automotive
description: >
  Automotive reversing: the CAN bus, ECU firmware, AUTOSAR Classic (RTE/runnable/BSW) and Adaptive (execution management/manifests).
  Triggers: `汽车`, CAN, ECU, `车载`, OBD, UDS, AUTOSAR, RTE, runnable, SWC, BSW, E_OS_ACCESS,
  Adaptive, ARA, Execution Management, Function Group, Machine State, Execution Manifest
capabilities: [automotive-analysis]
---

# Automotive reversing (CAN bus / ECU / AUTOSAR Classic)

## When to use / when not to use

- Precondition: you have ARXML or an in-vehicle software package but are not sure whether it is Classic or Adaptive → the in-vehicle section of [[re-analyze/system-fingerprints]]
- Use: you have vehicle CAN-bus traffic (a candump log / .asc / .blf) and need to parse messages and signals
- Use: reversing an in-vehicle device (a head unit, a T-Box, IVI, an ECU update package)
- Use: OBD-II / UDS diagnostic-session analysis (read DTCs, security access, calibration read/write)
- Use: ECU firmware extraction and the later unpack (paired with [[re-firmware]])
- Use: **AUTOSAR Classic software** (SWC/runnable/RTE/BSW) — the execution graph is decided by configuration and code generation, and cannot be understood with an ordinary call graph ([[autosar-classic]])
- Do not use: you only have an ECU firmware file and no bus access (go straight to [[re-fw-extract]])
- Do not use: you need to run the firmware and watch behavior ([[re-fw-emulate]])
- Do not use: you need JTAG/SWD to read flash ([[re-hardware-io]])
- Red line: test only a vehicle you own / are authorized to use, and a test bench (see step 5)

## Tool preparation

Verify every tool before use. A real-vehicle / real-bus test defaults to physical isolation — the [[re-analyze/platform-tips]] supreme rule: only a test vehicle/bench you own or are authorized to use may be connected; start in the lab on a vcan virtual bus, and do not connect a real vehicle.

### can-utils — the primary candump/cansend/cangen/canplayer tools

- Linux: `apt install can-utils` (Debian/Ubuntu) / `dnf install can-utils` (Fedora) / Arch: no official package → AUR (can-utils) or a source build (`git clone https://github.com/linux-can/can-utils && cd can-utils && ./autogen.sh && ./configure && make`)
- macOS/Windows: no official package (SocketCAN is a Linux kernel feature) → the Linux build inside WSL/a VM
- Verify: `candump --help`; `cansend --help`

### socketcan — the Linux kernel CAN stack (vcan virtual bus / can-isotp)

- Linux: kernel modules ship with it (a 5.10+ kernel includes can-isotp): `modprobe can vcan can-isotp`; `ip link` comes from iproute2 (present on a base system)
- macOS/Windows: not supported → WSL2/a VM (needs Linux 5.10+)
- Verify: `modprobe vcan && ip link add dev vcan0 type vcan && ip link set up vcan0 && ip -details link show vcan0`

### A USB-CAN adapter — the gs_usb family (canable/candlelight) is plug and play

- Linux: the kernel ships the gs_usb driver (drivers/net/can/usb/gs_usb.c); after plug-in, `dmesg` should register can0 (on some distros the CAN driver is in a modules-extra package; if `modprobe gs_usb` errors, install the matching extra package)
- macOS/Windows: use the vendor driver + vendor software, or pass it through a VM
- Verify: `modprobe gs_usb`; `ip -details link show can0`

### wireshark / tshark — CAN/ISO-TP/UDS parsing

- Install the same as [[re-netcap]] tool preparation (apt/dnf/pacman/brew/choco); the CAN (socketcan / Vector ASCII / BSLogger), ISO-TP, and UDS (ISO 14229) dissectors are built in
- Verify: `tshark --version`; a candump `-l` log can be opened directly with File → Open

### python-can — scripted parsing (cross-platform)

- All platforms: `pip install python-can`
- Linux: `apt install python3-can` (Debian/Ubuntu) / `dnf install python3-can` (Fedora) / `pacman -S python-can` (Arch extra)
- Verify: `python3 -c "import can; print(can.__version__)"`

### OBD-II / UDS diagnostic libraries

- python-obd (an ELM327 adapter, OBD-II standard services): no official package → `pip install obd`; verify `python3 -c "import obd"`
- udsoncan (a UDS ISO 14229 client): no official package → `pip install udsoncan isotp`; verify `python3 -c "import udsoncan, isotp"`
- Note: udsoncan's IsoTPSocketConnection needs the Linux can-isotp kernel module (5.10+) or socketcan; without the kernel module use PythonIsoTpConnection (goes through python-can, cross-platform but slightly worse timing)

### scapy — the automotive protocol layer (the automotive package, optional)

- All platforms: `pip install scapy` (includes `scapy.contrib.automotive` and `scapy.layers.can`)
- Verify: `python3 -c "from scapy.contrib.automotive.uds import UDS; from scapy.contrib.automotive.doip import DoIP; from scapy.layers.can import CAN; print('ok')"`

## Procedure

Run in order and record each step.

1. **Connect to CAN (USB-CAN / socketcan)**:
   - Start with no hardware (a vcan virtual bus):
     ```sh
     sudo modprobe can vcan can-isotp
     sudo ip link add dev vcan0 type vcan
     sudo ip link set up vcan0
     ```
   - USB-CAN (the gs_usb family):
     ```sh
     sudo modprobe gs_usb
     sudo ip link set can0 up type can bitrate 500000    # the classic 500 kbit/s baud rate
     ip -details link show can0                          # confirm bitrate / state UP
     ```
   - The baud rate must match the bus (the wrong baud rate = a flood of error frames; see pitfall 3)

2. **Capture with candump**:
   ```sh
   candump -t a can0                     # watch live (absolute timestamps)
   candump -l can0                       # write a log (the default file name includes a timestamp; no rotation — hand rotation to logrotate/an external script; Wireshark can open it directly)
   candump can0 -n 100                   # capture only 100 frames
   candump can0,7E0:7FF                  # ID filter: after the interface name, can_id:mask (comma-separated); mask 7FF = an exact match of 7E0, and a range filter uses 7F8 (matches 7E0~7E7); CAN has no address (see pitfall 1)
   candump -f can.log can0               # note that -f is "write the log to a file", not a filter argument
   ```

3. **Parse message ID / period / signals**:
   ```sh
   cansniffer can0                       # cluster by ID, and highlight the period and changing bytes
   candump can0 | awk '{print $2}' | sort | uniq -c   # count frames by ID (column 2 of the default output is the ID; note that -c is color mode, not a count)
   canbusload can0@500000                # bus load %
   ```
   - A periodic message (a fixed interval of 10/50/100ms is common) → a continuous signal such as RPM/vehicle speed; an event message (no regular interval) → a switch/button
   - Signal unpack: first fix the byte order (Intel little-endian vs Motorola big-endian; see pitfall 2) → watch byte changes one by one (cansniffer highlights changing bytes) → unpack by a DBC definition with cantools (`pip install cantools`)
   - Output an ID table: ID / period / length / suspected signal / byte order

4. **UDS / OBD diagnostics**:
   - A quick OBD-II checkup (the standard diagnostic pair 0x7E0/0x7E8, an ELM327 adapter):
     ```python
     import obd
     conn = obd.OBD()                     # auto-detect the adapter serial port
     conn.query(obd.commands.SPEED)       # vehicle speed
     conn.query(obd.commands.GET_DTC)     # fault codes
     ```
   - UDS (ISO 14229; a vendor diagnostic ID is not fixed; confirm it from a capture first):
     ```python
     import udsoncan, isotp
     from udsoncan.connections import IsoTPSocketConnection
     from udsoncan.client import Client, ClientConfig
     from udsoncan.services import DiagnosticSessionControl, DataIdentifier

     # The key point: how a DID payload is encoded/decoded is decided by config['data_identifiers'] —
     # when that DID is not in the map, udsoncan raises ConfigError **before** sending the request
     # ("contains no definition for data identifier 0xf190"); if it is in the map but the codec is not a
     # DidCodec instance, it raises ValueError ("is not a valid DidCodec").
     # The config only needs the keys you want to override: Client fills the rest from udsoncan.configs.default_client_config,
     # so besides data_identifiers you do not have to copy every default item.
     config = ClientConfig()
     config['data_identifiers'] = {
         0xF190: ...,      # the standard DID for VIN; codec = 17-byte ASCII (use a type that ships with the library, or a custom DidCodec subclass)
     }

     conn = IsoTPSocketConnection('can0', isotp.Address(isotp.AddressingMode.Normal_11bits, rxid=0x7E8, txid=0x7E0))
     with Client(conn, request_timeout=2, config=config) as client:
         client.change_session(DiagnosticSessionControl.Session.extendedDiagnosticSession)
         vin = client.read_data_by_identifier(DataIdentifier.VIN)
     ```
   - **Reading/writing a DID must configure a codec first**: `read_data_by_identifier` / `write_data_by_identifier` depend on `data_identifiers` in the client config (a DID → codec map) — **a response is only a byte string, and without a codec there is nothing to decode**, and udsoncan terminates with a configuration error rather than "returning the raw bytes". The official example is always written `Client(..., config=MyCar.config)` and notes that the VIN codec is configured in the client config. If you only want the raw payload, do not take the DID-decode path; use a lower-level interface that does not decode
   - Service cheat sheet: 0x10 session control / 0x22 read data identifier / 0x27 security access (seed-key) / 0x2E write data / 0x31 routine control / 0x3E tester present / 0x11 ECU reset / 0x34-0x36-0x37 the firmware download flow
   - Open a candump log in Wireshark → the ISO-TP/UDS dissector automatically decodes the diagnostic session

5. **ECU firmware**:
   - The UDS download flow: the standard transfer core is `0x34 RequestDownload → 0x36 TransferData × N → 0x37 RequestTransferExit`; real ECU programming usually first enters the `0x10` programming session as the OEM requires, runs `0x27` (security access) when a service is protected by a security level, and erase/integrity checks often go through an OEM-defined `0x31` (routine control); the process may need `0x3E` tester present, and the end may be an `0x11` reset — recover the concrete sequence from ECU behavior/ODX/firmware, and do not assume a fixed order. Or `0x23` reads memory to obtain the firmware → hand it to [[re-fw-extract]] to unpack (ECU/head-unit firmware follows the same flow as IoT firmware)
   - An update-package file you already have → [[re-fw-extract]]; a firmware ELF → [[re-binary-core]]; a hardware flash read → [[re-hardware-io]]

## IVI / T-Box / V2X paths

Split by target form (decision rules):

- **IVI (in-vehicle infotainment)**: it is essentially an Android/Linux system — the application layer goes to [[re-apk]], and the system image goes to [[re-firmware]]; watch the OEM customization layer (the launcher, the diagnostic interface, ADB/a debug port)
- **T-Box (telematics box)**: a cellular module (an AT-command interface), MCU firmware (extract and analyze with [[re-fw-extract]]), a remote-control protocol (vehicle-control commands — door lock/climate/start, go to [[re-protocol]])
- **V2X (vehicle-to-everything communication)**: a DSRC / C-V2X frame structure → the [[re-protocol]] / [[re-ics]] path (rebuild the protocol state machine, distinguish the PC5/Uu interfaces); physical-layer signal collection goes to [[re-sdr]]
- Decision rules: the application layer → the mobile/system path ([[re-apk]] / [[re-firmware]]); the communication layer → the protocol path ([[re-protocol]] / [[re-ics]]); the firmware layer → the firmware path ([[re-fw-extract]] / [[re-fw-rootfs]])

## Branches (references)

- [[autosar-classic]] — a **configuration-driven + code-generated** execution graph: a RunnableEntity is activated by an **RTEEvent** and mapped through RTE glue to an **OS Task or ISR2** (**the RTE has no independent scheduling capability**), and **a runnable with no caller is not dead code**; **implicit access** (`Rte_IRead_*`/`Rte_IWrite_*`) snapshots and writes back at the runnable boundary ("the consumer sees an old value" may be the semantics); `E_OS_ACCESS` comes from **OS-Application ownership/protection** (deny by default, and the grant comes from configuration), not a bad argument; a concurrency anomaly first checks the OS configuration (Task mapping, priority, preemption)
- [[autosar-adaptive]] — a **manifest-driven lifecycle**: a POSIX process + ARA functional clusters; **a Modelled Process ≠ an OS process** (do not compare them 1:1); **"the bin exists but the process does not" first checks the Function Group State / Machine State** (EM translates a state into a set of processes); an Execution Manifest can give the same executable a different configuration per state; on an EM switch, terminate first and then start by dependency

## Cross-domain joins

- [[re-firmware]]: this skill is its automotive branch (after ECU firmware extraction → unpack → rootfs → emulation)
- [[re-fw-extract]] / [[re-fw-rootfs]] / [[re-fw-emulate]]: ECU/head-unit firmware unpack, filesystem analysis, emulation
- [[re-hardware-io]]: capture on the OBD port (CAN/UART), JTAG/SWD flash reads
- [[re-protocol]]: rebuild an in-vehicle Ethernet protocol such as DoIP (UDS over Ethernet, port 13400); a private CAN protocol goes to [[re-proto-rev]]
- [[re-sandbox]]: isolate a virtual CAN / DoIP test bed; firmware emulation defaults to network isolation ([[re-analyze/platform-tips]] supreme rule)
- [[re-binary-core]]: deep static analysis of an ELF inside firmware
- [[re-crypto-id]] / [[re-crypto-decrypt]]: a seed-key algorithm, an encrypted CAN variant

## Common pitfalls

- **CAN has no address concept → filtering/attribution goes wrong**: symptom — you want to "filter by the target ECU" and either miss frames or capture everything; cause — a CAN frame has no source/destination address, only an 11/29-bit arbitration ID, and the ID is both the priority and the "identity" (a smaller ID has higher priority); fix — capture everything first (candump) and then cluster by ID (cansniffer, or pipe candump output through awk/sort/uniq to count), filter with `candump can0,ID:mask`, and do not assume a host concept
- **A signal bit-pack is wrong**: symptom — signal values are garbage (a negative/huge RPM, a multi-byte field misaligned); cause — a signal is packed across bytes and bits, Intel (little-endian) / Motorola (big-endian) order is mixed, and a signal does not have to be aligned to a byte boundary; fix — fix the byte order before unpacking, define the bit layout with a DBC + cantools, and cross-check against a real-vehicle reading / a known range
- **A baud-rate mismatch and bus load**: symptom — `candump` floods error frames, or under high load the period jitters and the captured period is not trustworthy; cause — the baud rate does not match the bus; at high load (>60-70%) there is arbitration delay and dropped frames; fix — confirm the baud rate before connecting (500 kbit/s is the most common, and canbusload shows the load), exclude high-load periods from a periodic analysis, and use a hardware timestamp when you need precise timing
- **seed-key security access is denied**: symptom — a UDS memory read / calibration write returns 0x7F 27 33 (SecurityAccessDenied); cause — 0x27 must be unlocked first: the server sends a seed (0x27 01/03), the client returns a key (0x27 02/04), and the algorithm is vendor-private (XOR/CRC/AES are common); fix — when you have a legal diagnostic tool, capture one normal unlock flow first, and recover the algorithm through [[re-crypto-id]] / [[re-crypto-decrypt]]; do it only on test equipment you own, and do not brute-force blindly
- **A firmware check/encryption layer**: symptom — firmware extracted into [[re-fw-extract]] unpacks as garbage, or flashing it back does not work; cause — ECU firmware has a signature/CRC check, the bootloader verifies a signature, or the whole image is encrypted; fix — during extraction, transfer the full 0x34/0x36 session and check it; during analysis, distinguish the encryption/signature layer before unpacking, and if it will not unpack go to [[re-crypto-id]] / [[re-crypto-decrypt]]; operate only on an authorized test bed/device
- **Treating an AUTOSAR runnable as dead code**: symptom — a business function has no caller and is judged leftover/unused code; cause — the runnable is called inside some OS Task by generated RTE glue from an RTEEvent, and **the call relationship is in the configuration, not in the source**; fix — find the `Rte_*` wrapper and the RTEEvent mapping, and confirm which OS Task it is mapped to ([[autosar-classic]])
- **Treating an implicit-access "old value" as a consistency problem**: symptom — the producer changed the data while running, and the consumer runnable keeps reading the old value the whole time it runs, so you suspect a cache or memory corruption; cause — implicit access snapshots and writes back at the runnable boundary; fix — distinguish `Rte_Read_*` (explicit) from `Rte_IRead_*` (implicit), and judge the communication form from the configuration ([[autosar-classic]])
- **Treating `E_OS_ACCESS` as a bad argument**: symptom — a service such as `ActivateTask` returns an access error, and you suspect the task ID was written wrong or the OS is corrupted; cause — OS-Application ownership/protection state: access was not granted at configuration time, or the object belongs to another application that is not accessible; fix — check which OS-Application the object belongs to, the application state, the trust level, and the current call context ([[autosar-classic]])

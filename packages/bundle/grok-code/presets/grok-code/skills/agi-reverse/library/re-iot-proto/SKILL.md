---
name: re-iot-proto
description: >
  IoT protocols: MQTT/CoAP/BLE/Zigbee; the BLE link layer (advertisement parsing/pairing encryption) and NFC/smart cards (ISO14443/APDU/MIFARE).
  Triggers: MQTT, CoAP, BLE, Zigbee, `物联网协议`, `IoT协议`, `BLE链路`, `BLE嗅探`, `广播解析`, `配对加密`, GATT, NFC, `智能卡`, MIFARE, APDU, ISO14443
capabilities: [protocol-recovery]
---

# IoT protocol reversing (MQTT / CoAP / BLE / Zigbee / NFC smart cards)

## When to use / when not to use

- Use: you have IoT device traffic (pcap / a live capture) and need to parse MQTT / CoAP semantics
- Use: interaction analysis of a BLE device (adv / GATT)
- Use: Zigbee (802.15.4) network capture and ZCL command analysis
- Use: you need to understand "device report / downlink control" semantics and tie it to firmware
- Do not use: a general custom protocol (go to [[re-proto-rev]])
- Do not use: ordinary network-traffic capture (go to [[re-netcap]])
- Do not use: encrypted traffic with no key — first [[re-crypto-id]] / [[re-crypto-keys]]

## Tool setup

Physical-device capture watches the authorization boundary (see step 5). Dynamic scenarios default to a sandbox / an isolated network (top principle in [[re-analyze/platform-tips]]). Verify every tool before use.

### wireshark / tshark — the primary parser (MQTT/CoAP/BLE/Zigbee dissectors are built in)

- Linux: `apt install wireshark tshark` / `dnf install wireshark-cli wireshark` / `pacman -S wireshark-cli wireshark-qt` (Arch has split into wireshark-cli + wireshark-qt; on Debian choose "allow non-root capture" at install, or `sudo dpkg-reconfigure wireshark-common` and add the user to the wireshark group)
- macOS: `brew install --cask wireshark` (includes the tshark CLI; or `brew install wireshark` for CLI only)
- Windows: `choco install wireshark`; inside WSL use the Linux build
- Verify: `tshark --version`; `tshark -G fields | grep -iE 'mqtt|coap|btatt|zbee'` lists field names (names shift slightly by version; trust that output)

### scapy — optional parse / build

- All platforms: `pip install scapy` (Python 3)
- Verify: `python3 -c "import scapy; print(scapy.__version__)"`

### MQTT — the mosquitto client (active subscribe/publish verification)

- Debian/Ubuntu: `apt install mosquitto-clients` (mosquitto_pub / mosquitto_sub)
- Fedora: `dnf install mosquitto`; Arch: `pacman -S mosquitto`; macOS: `brew install mosquitto`; Windows: `choco install mosquitto`
- Verify: `mosquitto_pub -h`; `mosquitto_sub -h`
- GUI alternative: MQTT Explorer (desktop, cross-platform)

### CoAP — coap-client / aiocoap

- Debian/Ubuntu: `apt install libcoap3-bin` (provides coap-client)
- Fedora: `dnf install libcoap libcoap-utils` (coap-client is in the libcoap-utils subpackage); Arch: `pacman -S libcoap` (extra); macOS: `brew install libcoap`
- If the distro package does not include the example program → `pip install aiocoap` (command `aiocoap-client`, Python 3)
- Verify: `coap-client -h` (or `aiocoap-client -h`)

### BLE — bluez + ubertooth

- bluez (btmon / hcitool): Debian/Ubuntu `apt install bluez`; Fedora `dnf install bluez`; Arch `pacman -S bluez bluez-utils`; verify `btmon --help`
- ubertooth (2.4GHz sniffing hardware): Debian/Ubuntu `apt install ubertooth` (firmware is a separate `ubertooth-firmware`); Fedora `dnf install ubertooth` (the Fedora 43/44 official repos have it); Arch has no official package → AUR; macOS `brew install ubertooth`; verify `ubertooth-btle -s`
- Android btsnoop (nothing to install): Developer options → check "Enable Bluetooth HCI snoop log" → reproduce the interaction → `adb bugreport` or pull `/sdcard/btsnoop_hci.log` (btsnoop format, opened directly in Wireshark)
- nRF Sniffer for BLE (Nordic, optional): needs an nRF-series dongle + a Wireshark extcap (mainly Windows/macOS)

### Zigbee — Wireshark + sniffer hardware + KillerBee

- The Wireshark zbee dissector is built in (zbee_nwk / zbee_aps / zbee_zcl); decryption is Preferences → Protocols → ZigBee → Security (check Decryption, fill Network Key / Link Key)
- Sniffer hardware (no distro package, a hardware option): a TI CC2531 USB stick (flash Sniffer firmware) or a Silicon Labs EFR32MG (flash a sniffer in Simplicity Studio + a Wireshark extcap)
- KillerBee (Python, ZCL capture / build / replay): Debian/Fedora/Arch official repos have no such package → `pip3 install killerbee` (PyPI; depends on libusb/libpcap — Debian/Ubuntu `apt install libusb-1.0-0-dev libpcap-dev`, Fedora `dnf install libusbx-devel libpcap-devel`, Arch `pacman -S libusb libpcap`); flash firmware with `sudo ./kb_install_firmware`; verify `kb --version`
- ZBOSS protocol-stack docs (the DSR Zigbee stack) are a reference for NWK/APS/ZCL structure
- Key-extraction handoff: [[re-firmware]] (read the key from firmware flash, together with zbgoodfind) / [[re-crypto-keys]]

## Procedure

Run in order. Archive each step's products (pcap / key / parser script + sha256).

1. **Identify the protocol**:
   ```sh
   tshark -r cap.pcap -q -z io,phs                                   # protocol hierarchy
   tshark -r cap.pcap -T fields -e tcp.dstport -e udp.dstport | sort | uniq -c | sort -rn
   ```
   - Port cheat sheet: MQTT 1883 (plaintext) / 8883 (TLS); CoAP 5683 (UDP) / 5684 (DTLS); BLE: advertisements and GATT (bthci_evt / bthci_acl / btatt layers, no port); Zigbee: 802.15.4 frames (no port, 2.4GHz channels 11-26)
   - A nonstandard port → Wireshark Decode As / `tshark -d tcp.port==9999,mqtt` forces it
   - Signature confirmation: the first MQTT byte is the control type (CONNECT 0x10 / PUBLISH 0x30 ...); the CoAP header Ver field is 2 bits (value 01); a BLE HCI event packet is 0x3e; the first 2 bytes of a Zigbee frame are the 802.15.4 frame-control field
2. **MQTT/CoAP parsing (topic / payload)**:
   ```sh
   tshark -r cap.pcap -Y mqtt -T fields -e mqtt.topic -e mqtt.msg
   tshark -r cap.pcap -Y 'mqtt.topic contains "ota"' -T fields -e mqtt.msg    # filter by topic
   tshark -r cap.pcap -Y coap -T fields -e coap.code -e coap.uri_path -e coap.opt.content_format
   ```
   - The topic is the control semantics: `device/<id>/sensor`, `ota/update`, `cmd/relay`, and similar — bucket by topic first (`-e mqtt.topic | sort | uniq -c`)
   - Payloads are commonly JSON / protobuf / custom binary → field meanings are cross-checked against the device app or firmware (step 5)
   - Active interaction verification (inside authorization): `mosquitto_sub -h <broker> -t '#' -v` (subscribe to everything), `mosquitto_pub -h <broker> -t <topic> -m '{"relay":1}'`; `coap-client -m get coap://<ip>/sensor`, `coap-client -m put -e '{"on":1}' coap://<ip>/relay`
   - Encryption (8883 / 5684): decrypt TLS with SSLKEYLOGFILE; an RSA private key applies only to old static-RSA key exchange (a TLS 1.3 and ECDHE session will not decrypt); a DTLS PSK is filled as a hex pre-shared key in the Wireshark dtls preferences (the key source is step 4 and [[re-crypto-keys]])
3. **BLE capture (adv / GATT)**:
   - Android btsnoop: turn on the snoop log in developer options → reproduce the app-to-device interaction → pull `btsnoop_hci.log` and open it in Wireshark (HCI is decoded automatically)
   - Linux: `btmon -w out.btsnoop` (together with the target connection process; the written btsnoop format opens directly in Wireshark)
   - ubertooth (when there is no host-side Bluetooth, sniff 2.4GHz): `ubertooth-btle -f -c 0` (follow mode observes advertisements / connection packets), `ubertooth-btle -s` (scan) — the live display is not written to disk, and analysis is on screen; to land it in Wireshark use btmon / Android btsnoop / nRF Sniffer (extcap)
   - GATT parsing:
     ```sh
     tshark -r ble.pcap -Y btatt -T fields -e btatt.opcode -e btatt.uuid -e btatt.value
     ```
   - Watch: advertisement packets (device name / manufacturer data / service UUID) and GATT read/write characteristics (sensor values, control commands, firmware version)
4. **Zigbee (802.15.4)**:
   - Hardware-sniffer capture (CC2531 / EFR32, pick the right channel) → Wireshark zbee parsing
   - Decrypt: Preferences → Protocols → ZigBee → Security: check Decryption, fill the Network Key (16-byte hex) and the Link Key (a common Zigbee 3.0 default TC link key is `ZigBeeAlliance09`)
   - Key-acquisition paths: (1) capture the network join (the Trust Center delivers the network key to a new node) (2) the default TC link key / install code (3) firmware flash extraction ([[re-firmware]] / [[re-hardware-io]], together with `zbgoodfind` looking for the key in firmware) (4) physical access to the coordinator to read the config
   - Layer structure: NWK (addressing/encryption) → APS (endpoint/cluster) → ZCL (commands: switch / read attribute / OTA) — `tshark -r zigbee.pcap -Y zbee_zcl -T fields -e zbee_zcl.cmd` shows commands (field names follow `tshark -G fields | grep -i zbee`)
   - KillerBee interaction (inside authorization): `zbdump` (capture), `zbstumbler` (scan the network), `zbreplay` (replay a ZCL command)
5. **Tie-in with device firmware (go through [[re-firmware]])**:
   - Unclear protocol semantics / a custom payload → firmware extraction (binwalk unpack) → look in the rootfs for the protocol implementation (strings / so), keys, and hardcoded topics → [[re-fw-emulate]] emulates the device and reproduces protocol behavior
   - Cross-check protocol constants with firmware strings (ports, magic, topic prefixes)
   - The OTA channel is also a protocol surface: the MQTT topic `ota/update` delivers firmware → the intercepted firmware image can go through [[re-firmware]] again

## BLE link layer

Outside the application layer, add the link-layer view: over-the-air sniffing, advertisement/connection frame structure, pairing-encryption negotiation, and key location. The capture-tool base is "BLE — bluez + ubertooth" above. This section focuses on link semantics and deep-dive points.

### Sniffing hardware and software (a generalized buying guide)

- The host side (btmon / Android btsnoop) only sees processes this host participates in; interaction between the device and a third-party device needs over-the-air sniffing
- An nRF-series dongle + Sniffer firmware + a Wireshark extcap (mainly desktop): buying watches whether the chip covers the Bluetooth core version (whether 4.2 / 5.x supports LE Secure Connections tracking), whether the firmware supports connection-event tracking (following frequency hopping), and the antenna form (on-board/external, which affects receive range)
- An ubertooth-class 2.4GHz sniffer: fits advertisements and link-layer data of an unencrypted connection; it does not join the connection, so encrypted connection contents are invisible
- A shared limit: over-the-air sniffing of an encrypted connection can only see timing and packet length. Decrypting the contents needs the LTK (below)

### Advertisement-packet parsing

- The PDU type distinguishes connection intent: ADV_IND (connectable undirected, the most common), ADV_SCAN_IND (scannable), ADV_NONCONN_IND (broadcast only), ADV_DIRECT_IND (directed)
- Frame structure: a 2-byte header (PDU type + length) + Payload (AdvA + AdvData); AdvData is a chain of AD structures (Length + AD Type + Data): 0x01 Flags, 0x03/0x07 service UUID, 0x09 complete local name, 0x0A Tx Power, 0xFF manufacturer data
- Parsing: `tshark -r ble.pcap -Y btle -T fields -e btle.advertising_address -e btle.advertising_header.pdu_type -e btle.advertising_data` (field names follow `tshark -G fields | grep -i btle`); the 0xFF manufacturer-data segment often contains a private protocol and a device id, and is worth a byte-by-byte comparison with firmware
- Advertisements only carry low-frequency status announcements (name/status/service discovery). Business data is generally on the GATT channel after connection

### Connection-event timing and channels 37/38/39

- The primary advertisement channels are fixed at 37/38/39 (2402/2426/2480 MHz), and advertisement events rotate across the three channels; scan request/response and CONNECT_IND are also on these three channels
- CONNECT_IND carries the access address, the hop increment, and connection parameters → from that, the later data-channel sequence (0-36) and the event rhythm can be estimated
- Connection parameters: connInterval (1.25ms steps), slaveLatency, supervisionTimeout, visible in the HCI-layer LE Connection Complete event; a connection event is counted from the anchor point and appears on the connInterval period
- Verification: the interval of connection data packets in the capture should be an integer multiple of connInterval; a messy interval or one side missing → hop tracking lost sync (see pitfall 3)

### Pairing / encryption negotiation

- Flow: Pairing Request/Response (SMP) → temporary-key derivation → LTK generation → (bonding) both sides store the LTK
- LE Legacy: an STK derived from a PIN/temporary value; LE Secure Connections: P-256 ECDH. The MITM bit of AuthReq decides whether man-in-the-middle is prevented (Just Works has no user check; Passkey / Numeric Comparison does)
- Where to look: the SMP exchange in Wireshark shows AuthReq (SC / MITM / Bonding bits; fields follow `tshark -G fields | grep -i smp`) — confirm the mode first, then decide whether to decrypt or only look at timing
- After bonding, a reconnect does not pair again. The LTK exchange appears only on the first pairing
- Key storage: the host side (system Bluetooth config / key-value storage) and the device side (flash / external EEPROM) → extract with [[re-firmware]] / [[re-crypto-keys]]; with the LTK, fill the Wireshark BLE preferences and the connection data decrypts

### GATT service and characteristic enumeration

- Passive: btmon / btsnoop captures service discovery (Discover All Primary Services / characteristic discovery). The btatt-layer UUID and handle map is directly visible
- Active (after connection): a gatttool-class tool (bluez) `primary` / `characteristics` lists handle ↔ UUID ↔ properties
- Read/write/notify points: a characteristic handle + CCCD (0x2902) turns notifications/indications on, and the value stream is in btatt.value; `tshark -r ble.pcap -Y btatt -T fields -e btatt.handle -e btatt.value`

### Pitfalls

- **Confusing advertisement data with connection data**: symptom — suspected business data in the advertisement manufacturer-data segment is parsed as report semantics, and it does not match app behavior; cause — advertisements only carry low-frequency announcements. The business flow is on the GATT channel after connection and may be encrypted; fix — split by frame type first: a btle advertising packet parses AdvData, and connection data looks at the btatt layer; decide which span to capture only after judging whether the target device has entered the connected state
- **Misjudging the pairing mode**: symptom — proceeding on "capturing the pairing process is enough to decrypt", and in practice the connection is either all ciphertext or plaintext with no check; cause — the AuthReq bits decide the mode: SC=0 and MITM=0 is LE Legacy Just Works — no user check, and it does not prevent impersonation on the eavesdropping side; SC=1 is LE Secure Connections (ECDH); fix — parse AuthReq of the SMP Pairing Request and confirm the mode first, then choose decrypt (needs the LTK) or timing only
- **The capture drops connection events**: symptom — advertisements and connection setup are both present, but connection events are intermittent or only one side's packets; cause — data-channel hopping was not tracked (missing the anchor loses sync), only one channel was listened to, or over-the-air interference dropped packets; fix — prefer host-side btmon / btsnoop (reliable on every channel); over-the-air sniffing uses firmware with connection-tracking capability, and tracking is verified from the CONNECT_IND access address + hop increment
- **The LTK is not in the capture**: symptom — after the SMP exchange there is no LTK-related packet, and decryption has no key; cause — after bonding, a reconnect uses the stored key directly and does not exchange again; fix — clear the pairing / factory-reset and recapture the first pairing, or extract it from device flash / app storage ([[re-firmware]] / [[re-crypto-keys]])

## NFC / smart cards

Contact / contactless smart cards: the ISO14443 link, APDU interaction, and common card-family weaknesses. Hardware uses a proxmark3-class general reader/writer (generalized buying). Confirm the authorization boundary before capture/analysis.

### ISO14443 frame structure and the anti-collision flow

- The ISO14443A flow: REQA (a 0x26 short frame) → ATQA → anti-collision (the UID is negotiated bit by bit across cascade levels CL1/CL2/CL3) → SELECT → SAK (the card-type identifier)
- Frame structure: SOF + data bytes (each byte carries a parity bit) + CRC_A (2 bytes) + EOF; a short frame is 7 bits (REQA/WUPA)
- SAK identification: the 0x08/0x88 class → the MIFARE Classic family (Crypto-1, sector/block structure); the 0x20/0x40 class → the DESFire family (a filesystem + AES/3DES) — identify the type first and then pick the path (see pitfall 1)
- Reader flow: an `hf 14a reader` class command (proxmark3-class general) prints ATQA / UID / SAK in one shot, and from that you enter the matching card-family tool

### APDU interaction

- ISO7816-4 APDU: CLA + INS + P1 + P2, after which Lc/data/Le appear in a case combination (Case1 has none of the three; Case2 has no Lc/data and may have Le; Case3 has Lc+data and no Le; Case4 has all of them) — judge the case before parsing the boundary; the response is SW1/SW2 (0x9000 success)
- Common commands: 0xA4 SELECT (select an application), 0xB0 READ BINARY, 0xB2 READ RECORD, 0x20 VERIFY (password verification), 0xD0 WRITE BINARY, 0xD6 UPDATE BINARY — but each card/application command set differs (see pitfall 2)
- Contact uses ISO7816 T=0/T=1; a contactless card often tunnels the APDU (for example DESFire ISO mode), and the capture point differs
- Location trick: capture a known-legitimate interaction (reader logs / phone NFC logs) and compare the command sequence. That is faster than guessing against the docs

### MIFARE Classic and Crypto-1 weaknesses (generalized)

- Crypto-1 is a 48-bit stream cipher. During authentication the reader sends a challenge and the card returns an encrypted response; the PRNG and the authentication protocol have known weaknesses, and key recovery can be based on samples of the unencrypted authentication response (replay / known-plaintext ideas)
- Prerequisite: the card answers an authentication request from any reader (it was not configured to refuse an unknown key); if the prerequisite is not met, that idea does not apply. Switch to key extraction ([[re-crypto-keys]] / [[re-firmware]]) or firmware analysis
- Boundary: only Crypto-1-class cards; an AES-class card (the DESFire family) has a different structure and does not apply

### A proxmark3-class device flow (generalized buying)

- Buying watches: 13.56MHz high-frequency support (required), whether the firmware is actively updated, whether field flashing is supported, antenna performance and the enclosure form
- Flow: power-on self-test → `hf 14a reader` identifies the type → pick the attack/read-write flow by card family → verify the result
- Authorization boundary: both read-only and writing/cloning a card need authorization. A lab environment confirms card ownership and purpose (top principle in [[re-analyze/platform-tips]])

### Pitfalls

- **Misjudging the card type (MIFARE vs DESFire structures differ)**: symptom — a card is parsed as Classic sector/block structure, and addresses and data do not line up at all; cause — Classic (Crypto-1, a sector-block structure, SAK 0x08/0x88 class) and DESFire (a filesystem, AES/3DES, SAK 0x20/0x40 class) have completely different internal structures; fix — look at SAK first (together with ATQA), identify the card family, and then pick the parse/attack path. Do not put one structure on every card
- **APDU command-set differences**: symptom — the same command succeeds on card A and card B returns an error of the 0x6A82 (file not found) / 0x6D00 (instruction not supported) class; cause — different cards/applications agree differently on the CLA prefix, INS, and P1/P2 (a proprietary CLA, extended instructions, different parameter meanings); fix — SELECT the target application first, capture a known-legitimate interaction and compare the command sequence, and calibrate command by command from the SW status
- **The Crypto-1 attack prerequisite**: symptom — the key-recovery flow will not start or the result is wrong; cause — the idea needs a sample of the card-side unencrypted authentication response first. If the card refuses authentication from an unknown reader, or the environment cannot insert a man in the middle, there is nowhere to start; fix — first verify whether the card answers an authentication request from any reader. If the prerequisite holds, follow the attack flow. Otherwise switch to key extraction / the firmware path ([[re-crypto-keys]] / [[re-firmware]])
- **Confusing the UID with a data block**: symptom — after writing/cloning the card, the target card behaves abnormally or reads/writes fail; cause — the UID and the manufacturer block (block 0) have a lock/check, some card families cannot change the UID, and changing it breaks access control; fix — before writing, read the manufacturer block and the sector trailer (access bits), and confirm writability and the authorization boundary

## Cross-domain

- [[re-protocol]]: this skill is its IoT branch (the choice-tree entry after workflow step 5)
- [[re-netcap]]: capture raw material (capture point / isolation)
- [[re-firmware]]: firmware tie-in (protocol implementation / keys / OTA image, together with [[re-fw-extract]] / [[re-fw-emulate]])
- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]: the encrypted-traffic chain (TLS / DTLS / PSK key extraction and decryption)
- [[re-proto-rev]]: state-machine recovery of a private IoT protocol
- [[re-hardware-io]]: serial / flash-chip key reads
- [[re-sandbox]]: device-test network isolation and the authorization boundary (top principle in [[re-analyze/platform-tips]])
- This skill is referenced by the "protocol analysis" path in [[re-analyze]] triage (re-protocol → re-iot-proto)
- RF signal-level reversing (capture/demodulation/frame recovery) → [[re-sdr]]
- [[re-javacard]]: applet logic above the NFC/smart-card link (CAP file parsing, process(APDU) dispatch recovery)

## Common pitfalls

- **A plaintext MQTT topic leaks control semantics**: symptom — topics in the pcap directly say `device/x/ota/update`, `cmd/relay`, the business intent is obvious, but the payload is encrypted or binary; cause — a device often encrypts only the payload, and the topic is plaintext (or the broker has no TLS); fix — the topic is a semantic gold mine: bucket first with `-e mqtt.topic | sort | uniq -c`, locate the key flow by topic, and then decode the payload; a binary payload is compared with firmware under a JSON/protobuf hypothesis (step 5)
- **DTLS/PSK encryption needs a key**: symptom — 5684 / 8883 traffic has high entropy and is all ciphertext, and the dissector only emits garbage; cause — a DTLS/TLS encryption layer (PSK/RSA); fix — extract the PSK from device firmware / the app side ([[re-crypto-keys]] → [[re-firmware]]), and fill a hex PSK in the Wireshark dtls preferences; TLS uses SSLKEYLOGFILE (an RSA private key works only for an old static-RSA session; modern ECDHE/TLS 1.3 will not decrypt); if the key cannot be obtained, that channel can only show timing. Mark the limit and switch to semantic inference
- **BLE allowlist / pairing bond**: symptom — after the connection request there is no later data, or the device does not advertise at all; cause — an allowlist filters unknown hosts, and an already-paired device connects directly from the bond info (skipping advertisement / pairing); fix — clear the device pairing / factory-reset and recapture the first connection and pairing; capture the advertisement-phase data in full first (adv packets, including device info and service UUIDs)
- **A Zigbee network key is hard to obtain**: symptom — zbee frames parse but APS / ZCL is all ciphertext (the payload is garbage); cause — the network key is not in hand, and the link/network layer is encrypted; fix — try the step 4 key paths one by one: capture during join → the default TC link key → firmware extraction (zbgoodfind scans firmware for the key); both layers, the TC link key and the network key, must be obtained
- **Capture hardware / channel mismatch**: symptom — BLE captures only scattered advertisements, and Zigbee captures not a single packet; cause — BLE hops across 40 channels (an ordinary adapter only sees advertisements or part of the connection packets), or the Zigbee channel is wrong (picking the wrong one of 11-26 is silence); fix — BLE uses btmon / btsnoop (host side, every channel) or ubertooth with follow; Zigbee uses a sniffer channel scan (zbstumbler) to confirm the working channel and then captures

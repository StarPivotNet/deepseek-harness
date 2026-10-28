---
name: re-ics
description: >
  Industrial-control protocol reversing: Modbus/DNP3/OPC UA.
  Triggers: `工控`, ICS, Modbus, DNP3, OPC UA, SCADA, PLC
capabilities: [protocol-recovery]
---

# Industrial-control protocol reversing (ICS/SCADA)

## When to use / when not to use

- Use: you have ICS/SCADA traffic (pcap / live capture) and need to parse Modbus / DNP3 / OPC UA semantics
- Use: rebuild a PLC/RTU point table from traffic (coil / register / object map)
- Use: firmware and communications analysis of ICS devices (PLC/HMI/RTU), together with [[re-firmware]]
- Use: ICS security testing inside an authorized scope (see the boundary in step 5)
- Do not use: the traffic is ciphertext / has an encryption layer (first [[re-crypto-id]] → [[re-crypto-keys]] → [[re-crypto-decrypt]])
- Do not use: a non-ICS custom protocol (that is [[re-proto-rev]])
- Do not use: you only need to capture packets (that is [[re-netcap]])

## Tool setup

Verify every tool before use. ICS-analysis red line: **test only authorized systems**, and default to an isolated network ([[re-analyze/platform-tips]] top principle) — a test environment must never be attached to a production OT network (see step 5).

### wireshark / tshark — primary ICS parsers (modbus/dnp3/opcua dissectors are built in)

- Linux: `apt install wireshark tshark` / `dnf install wireshark-cli wireshark` / `pacman -S wireshark-cli wireshark-qt` (Arch has split into wireshark-cli + wireshark-qt; on Debian choose "allow non-root capture" at install, or `sudo dpkg-reconfigure wireshark-common` and add the user to the wireshark group)
- macOS: `brew install --cask wireshark` (includes the tshark CLI; or `brew install wireshark` for CLI only)
- Windows: `choco install wireshark` (or the official installer); inside WSL use the Linux build
- Verify: `tshark --version`; `tshark -G fields | grep -iE 'modbus|dnp3|opcua'` lists ICS field names (names can shift slightly by version; trust that output)

### scapy — modbus-layer parse and build (contrib layer)

- All platforms: `pip install scapy` (Python 3, recommended)
- Linux: `apt install python3-scapy` (Debian family; includes the contrib layer)
- Verify: `python3 -c "from scapy.contrib.modbus import ModbusADURequest, ModbusADUResponse; print('ok')"`
- Note: the modbus layer is in `scapy.contrib.modbus` (not a default layer; import it explicitly, `ModbusADURequest` / `ModbusADUResponse` + the `ModbusPDU0X*Request/Response` function-code classes); **no scapy version has a DNP3 / OPC UA layer** → parse DNP3/OPC UA with Wireshark or write a custom parser (see step 4)
- Read a pcap with `rdpcap` (pure-Python parse, no libpcap required)

### python3 — parser-script runtime

- Install and verify via the tool setup in [[re-proto-rev]]

## Procedure

Run in order and record each step. Preconditions: traffic is already captured ([[re-netcap]]) and is plaintext (ciphertext goes through [[re-crypto-decrypt]] first).

1. **Protocol identification (port + signature)**:
   ```sh
   tshark -r cap.pcap -T fields -e tcp.dstport | sort | uniq -c | sort -rn   # port counts
   tshark -r cap.pcap -q -z io,phs                                          # protocol hierarchy (dissector hits)
   ```
   - Port cheat sheet: Modbus/TCP 502 (Modbus over TLS 802), DNP3 20000/TCP,UDP,SCTP (secure DNP3 dnp-sec 19999/TCP,UDP,SCTP), OPC UA binary 4840/TCP, S7comm 102, EtherNet/IP 44818, BACnet/IP 47808/UDP
   - Ports are only a first guess (ICS often uses nonstandard ports). Confirm with a signature: a Modbus/TCP transaction = transId(2) + protoId 0x0000(2) + len(2) + unitId(1) + function code(1); a DNP3 link frame starts with the fixed 2 bytes `05 64`; an OPC UA binary header is a 3-byte message type (HEL/ACK/OPN/CLO/MSG)

2. **Wireshark parse (dissector first)**:
   - GUI: open the pcap. Standard ports auto-hit the modbus/dnp3/opcua dissector; a nonstandard port → right-click Decode As and name the protocol (or on the command line `tshark -d tcp.port==5020,modbus`)
   - Filter and export:
     ```sh
     tshark -r cap.pcap -Y 'modbus' -T fields -e modbus.func_code -e mbtcp.unit_id   # the official unit-id field is on the mbtcp layer (modbus.unit_id is not official)
     tshark -r cap.pcap -Y 'dnp3' -T fields -e dnp3.ctl -e dnp3.dst -e dnp3.src       # control word dnp3.ctl (subfields dnp3.ctl.dir/prm/fcb/fcv/prifunc/secfunc); station addresses are top-level dnp3.dst/dnp3.src
     tshark -r cap.pcap -Y 'opcua' -T fields -e opcua.nodeid.numeric -e opcua.nodeid.string -e opcua.nodeid.guid   # nodeid has no top-level field; use the typed subfields
     ```
   - When a field name is uncertain, trust `tshark -G fields | grep -iE 'modbus|dnp3|opcua'`

3. **Function codes and the object point table**:
   - Modbus function-code cheat sheet: 01 read coils / 02 read discrete inputs / 03 read holding registers / 04 read input registers / 05 write single coil / 06 write single register / 0F write multiple coils / 10 write multiple registers; an exception response = 0x80 | function code
   - Building the point table: collect (unitId, function code, start address, quantity) from traffic, map register/coil addresses to tags against the engineering docs (temperature, pressure, valve position, …), and produce an "address → type → value → meaning" table
   - Value parsing: registers are 16-bit big-endian; for a 32-bit combination (IEEE754 float / int32) watch high/low word order (see pitfall 2)
   - DNP3 object point table: group-variation numbers. **Static and event quantities are paired but different groups** — group 1 binary input ↔ group 2 binary-input event; **group 3 double-bit binary input (Double-bit Binary Input, static) ↔ group 4 double-bit input event**; group 10 binary-output status ↔ group 11 binary-output event; group 30 analog input ↔ group 32 analog-input event. **Do not treat a static group as an event group** (group 3 is not an "event"). When recovering the point table, model static/event as pairs, or the event buffer and variation semantics will be judged backwards as a whole
   - OPC UA: NodeId (NamespaceIndex:Identifier) + BrowseName is the point identifier
   - Difference method: compare normal-run traffic with traffic that triggers an action. The differing messages are the key points

4. **scapy parser (modbus) + a custom DNP3 parser**:
   ```python
   from scapy.all import rdpcap
   from scapy.contrib.modbus import ModbusADURequest, ModbusADUResponse

   for p in rdpcap('cap.pcap'):
       if 'TCP' in p and p['TCP'].dport == 502 and len(p['TCP'].payload) >= 6:
           mb = ModbusADURequest(bytes(p['TCP'].payload))   # decode MBAP+PDU together
           mb.show()        # transId/protoId/len/unitId + PDU (function code and register fields)
   ```
   - DNP3 (scapy has no layer): the link-layer header layout is fixed (`05 64 | len | ctrl | dst(2) | src(2) | CRC(2)`; a mandatory header CRC follows the source address), so struct is enough; later data is blocked as 16 bytes plus a 2-byte CRC; the transport and application layers proceed in the IEEE 1815 group-variation format
   - Building a test frame (confirm authorization and isolation before sending it to a test-bed PLC; see step 5):
     ```python
     from scapy.contrib.modbus import ModbusPDU03ReadHoldingRegistersRequest
     req = ModbusADURequest() / ModbusPDU03ReadHoldingRegistersRequest(startAddr=0, quantity=10)   # the field name is camelCase startAddr (scapy's definition), not start_addr
     ```

5. **Authorized scope and security-test boundary**:
   - Test only authorized systems: your own / lab test bed (PLC/RTU/HMI simulator), vendor-authorized test equipment, targets inside a vulnerability-disclosure scope; **never** run unauthorized tests against production SCADA/DCS, grids / water plants / power plants, or other critical facilities (legal and public-safety exposure)
   - Physical / logical isolation: separate the test network from the production OT network (dedicated segment / VLAN, firewall). The capture and analysis machine attaches only to the test bed; default to the network-isolation idea in [[re-sandbox]]
   - Sending abnormal frames (fuzzing, illegal function codes, unauthorized writes) is test-bed only, with a full audit log; if unsure, fall back to passive analysis (capture and parse only)
   - Redact the report: do not expose production-site / personnel / network-topology detail; follow local ICS security-testing law and keep written authorization

## Cross-domain

- [[re-protocol]]: this skill is its ICS branch (the choice-tree entry after workflow step 5)
- [[re-netcap]]: where the capture raw material comes from (capture point / sandbox isolation)
- [[re-sandbox]]: security-test boundary — test-bed isolation, authorized systems only ([[re-analyze/platform-tips]] top principle)
- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]: prerequisites for encrypted variants (Modbus over TLS, OPC UA secure channel; DNP3 Secure Authentication is an authentication extension, not default encryption — confirm separately whether TLS/VPN is wrapped around it)
- [[re-firmware]]: PLC/RTU/ICS-device firmware analysis (extract → rootfs → emulate)
- [[re-proto-rev]]: state-machine recovery for nonstandard ICS protocols
- [[re-hardware-io]]: serial capture of Modbus RTU / fieldbus

## Common pitfalls

- **Function-code semantics mixed up**: symptom — treating 01 read-coils as 03 read-registers, so every value type is wrong (coil 1 bit vs register 16 bits); cause — the function code decides the data type and address space, and counts were not bucketed by function code; fix — count by function code first (`tshark -Y modbus.func_code`), and split the point table by function-code space (01/02 coil space, 03/04 register space)
- **Big-endian byte order**: symptom — register values are huge or garbage (for example temperature 0x0128=296 read little-endian as 0x2801=10241); cause — Modbus registers default to big-endian, and multi-register combinations (32-bit / float) also stack a vendor-defined high/low word order; fix — check against a known value (range / constant / whether the precision is plausible), try both endianness and both word orders, then lock the choice into the parser script
- **Protocol variants mixed up**: symptom — the dissector misses or the parse is shifted (a Modbus RTU frame decoded as TCP, DNP3 on a TLS port); cause — one protocol, many carriers: Modbus RTU/ASCII (serial) vs TCP (502) vs TLS (802); DNP3 serial / TCP 20000 (TLS often reuses 20000 or dnp-sec 19999); OPC UA binary (4840) vs an HTTP endpoint; fix — step 1 confirms with both port and signature, and Wireshark Decode As / `-d` forces the dissector
- **An encrypted variant decoded as plaintext**: symptom — traffic entropy is high, and the dissector emits only garbage or marks encryption; cause — Modbus over TLS / an OPC UA secure channel encrypts by default; DNP3 Secure Authentication is an authentication / integrity extension, not a confidentiality wrapper, so high entropy should first be checked for a separate TLS/VPN confidentiality layer; fix — judge with [[re-crypto-id]] first, extract keys from HMI/client process memory and certificates ([[re-crypto-keys]]), and run the decrypt path through [[re-crypto-decrypt]]
- **Point-table map shifted**: symptom — addresses do not line up and value meanings are wrong; cause — vendors number differently (0-based vs 1-based, separate address spaces for coils and registers, mirrored addresses); fix — cross-check several packets (repeated reads of the same address should be stable), use the engineering docs, and build the table with spaces separated
- **S7CommPlus authentication chain (S7-1200/1500)**: symptom — the S7 traffic version does not match, authentication data will not decode, and a flow captured from PLCSIM does not match a real PLC; cause — S7CommPlus is a layered authentication system, and V1(0x01) / V2(TLS,0x02) / V3(0x03) differ a lot; structure: an OpenSSL standard layer (AES-128-ECB/SHA-256/HMAC) + a BigInt layer (192-bit, 6-dword encoding) + the Monolith function family (1-11) + a key-derivation transform pipeline (8 transform classes: TPre/T7/T12/T13/KeyD/LutG/Csum/Seed) + encrypted authentication data (AES-ECB chain + Blob metadata header + AES-CTR/HarpoHash check); key constants: session key 24B, challenge 20B, real-PLC public key 40B vs PLCSIM 64B, authentication Blob 180 vs 216B; fix — confirm protocol version and target first (real PLC vs PLCSIM; both the flow and the key length differ), then recover by version line: plaintext structure → key-derivation pipeline → session-key rotation → packet digest

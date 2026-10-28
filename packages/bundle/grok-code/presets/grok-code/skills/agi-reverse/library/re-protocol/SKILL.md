---
name: re-protocol
type: gateway
description: >
  Protocol-reversing gateway. Orchestration: capture → crypto identification → keys → decrypt → state-machine recovery.
  Child skills: [[re-netcap]] [[re-crypto-id]] [[re-crypto-keys]] [[re-crypto-decrypt]] [[re-proto-rev]] [[re-ics]] [[re-iot-proto]] [[re-whitebox]] [[re-tls]].
  Triggers: `协议逆向`, `抓包`, `流量分析`, `解密流量`, `C2协议`, `自定义协议`, protocol analysis.
capabilities: [network-capture, protocol-recovery, crypto-identification, crypto-decryption, key-extraction, tls-analysis]
---

# Protocol reversing

## Full workflow

Run in order. Record an evidence path + sha256 for every step's product (pcap / key / decrypt script / parser script) so the report can cite it (see [[re-ioc]] (capability: `threat-intel`)).

1. **Capture: [[re-netcap]] (capability: `network-capture`)** — fix the capture point first (host / gateway / man-in-the-middle). Capture inside the sandbox first ([[re-sandbox]] (capability: `sandbox-setup`) network isolation: INetSim / fake DNS / cut the network, to prevent a real outbound connection; see the top rule in [[re-analyze/platform-tips]]). A tcpdump filter keeps only the target flow before the file is written. For HTTPS/TLS, prepare the mitmproxy CA in advance
2. **Crypto identification: [[re-crypto-id]] (capability: `crypto-identification`)** — decide whether the traffic is plaintext or ciphertext: entropy >7.0 / no structure / no ASCII → ciphertext. Then constant-table fingerprints (an AES S-box / a CRC table), single-byte XOR/ROL/ROR patterns, and the flow features of common algorithms
3. **Keys: [[re-crypto-keys]] (capability: `key-extraction`)** — static first (strings / xrefs for a hardcoded key, a resource file, near an imported Crypt*). If static finds nothing, go dynamic ([[re-memdump]] (capability: `memory-dump`) dumps by default and then searches 16/32-byte entropy blocks and printable passphrases). A PBKDF class is recovered from the derivation function
4. **Decrypt: [[re-crypto-decrypt]] (capability: `crypto-decryption`)** — locate the decrypt function (xref the ciphertext input) → decompile and recover the algorithm → rewrite it as a standalone python script → check it with known plaintext or a known header → turn the captured ciphertext stream into a plaintext traffic stream
5. **State-machine recovery: [[re-proto-rev]] (capability: `protocol-recovery`)** — do this step only on plaintext traffic: group statistics and clustering (length / direction / timing) → locate the fixed header (magic / a length field) → infer fields (type / length / CRC) → write a Scapy parser → infer the state machine (handshake / heartbeat / end)

**Prerequisite check**: do not enter state-machine recovery while the ciphertext is still encrypted (garbage would be treated as structure). Plaintext traffic skips steps 2-4.

## When to use which atomic skill (selection tree)

Branch on the input feature or the goal:

- **There is traffic (a pcap / a live capture)** → [[re-netcap]] (capability: `network-capture`; capture) → see whether it is ciphertext:
  - Ciphertext (high entropy / no structure) → [[re-crypto-id]] (capability: `crypto-identification`) → [[re-crypto-keys]] (capability: `key-extraction`) → [[re-crypto-decrypt]] (capability: `crypto-decryption`) → after plaintext, [[re-proto-rev]] (capability: `protocol-recovery`)
  - Plaintext → [[re-proto-rev]] (capability: `protocol-recovery`) rebuilds the state machine directly
- **An industrial-control / SCADA protocol (Modbus/DNP3/OPC UA, ports 502/20000/4840)** → [[re-ics]] (capability: `protocol-recovery`; industrial-control traffic parsing and the point table; the safety-test boundary is in [[re-sandbox]] (capability: `sandbox-setup`))
- **An IoT device protocol (MQTT/CoAP/BLE/Zigbee, 1883/5683/the 2.4GHz band)** → [[re-iot-proto]] (capability: `protocol-recovery`; device-semantics parsing plus firmware together with [[re-firmware]] (capabilities: `firmware-extraction`, `emulation`, `rtos-analysis`, `hardware-interface`, `uefi-analysis`))
- **Only a binary sample, no traffic** ("what is the protocol implementation logic") → find the crypto implementation statically [[re-crypto-id]] (capability: `crypto-identification`) → [[re-crypto-keys]] (capability: `key-extraction`) → [[re-crypto-decrypt]] (capability: `crypto-decryption`). A deep look at the logic switches to [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`; [[re-ghidra]] (capabilities: `decompilation`, `debugging`) / [[re-ida]] (capabilities: `decompilation`, `debugging`) / [[re-radare2]] (capability: `decompilation`))
- **The interaction semantics are the question** ("how do the client and the server talk" / "the handshake") → [[re-proto-rev]] (capability: `protocol-recovery`)
- **Only one blob of a known algorithm needs decrypting** (the algorithm and the key are known) → [[re-crypto-decrypt]] (capability: `crypto-decryption`) directly
- **Only a key is needed** ("does the sample have a hardcoded key") → [[re-crypto-keys]] (capability: `key-extraction`; static first, the static-first idea of the top rule in [[re-analyze/platform-tips]])
- **White-box crypto** (a long stretch of table-lookup code, no standard-library call, the key hidden in the tables) → [[re-whitebox]] (capabilities: `crypto-identification`, `key-extraction`; identify → extract tables → recover the key, continuing the crypto trio)
- **The capture environment is not ready** → [[re-sandbox]] (capability: `sandbox-setup`) network isolation first (INetSim / fake DNS), then come back to [[re-netcap]] (capability: `network-capture`)
- **Deep standard TLS / encrypted traffic** (a ClientHello fingerprint, SSLKEYLOG decryption, TLS 1.2/1.3) → [[re-tls]] (capabilities: `tls-analysis`, `crypto-identification`; a standard TLS stack; a home-grown cipher switches to the crypto trio)

## Cross-domain handoff

- **C2 communication analysis ([[re-malware]])**: this gateway is step 4 of the re-malware workflow (capture the callback traffic → rebuild the protocol → identify and decrypt the communication crypto). The crypto trio (crypto-id / crypto-keys / crypto-decrypt) is cited directly by the C2 decrypt path. Capture depends on the INetSim / fake-DNS network isolation in [[re-sandbox]]
- **Firmware communication analysis ([[re-firmware]])**: this gateway is step 6 of the re-firmware workflow (firmware callback / a custom protocol / encrypted communication). [[re-netcap]] captures on the virtual NIC of the emulation environment. Protocol clues extracted by binwalk are input for [[re-proto-rev]]
- **Behavior-analysis handoff ([[re-behavior]])**: after behavior analysis records a network connection (callback domain / IP / port), it switches to this gateway for protocol-layer analysis
- **IOC output ([[re-ioc]])**: C2 domains / IPs / ports, protocol fingerprints, and decrypted config plaintext go into the IOC list and YARA signatures
- **A deep binary look ([[re-binary-core]])**: decompiling a crypto implementation or a decrypt function goes through [[re-ghidra]] / [[re-ida]] / [[re-radare2]]. A key in memory goes through [[re-memdump]]
- **White-box crypto ([[re-whitebox]])**: when the crypto-identification or key path hits a white-box implementation (a long table-lookup cipher with no explicit key), switch here — the branch where the ordinary [[re-crypto-keys]] path fails
- **TLS specialty ([[re-tls]])**: deep analysis of standard TLS traffic — JA3/JA4 fingerprints, SSLKEYLOG decryption (TLS 1.2/1.3), certificate-chain analysis. Plaintext traffic after decryption continues at [[re-proto-rev]]
- **Entry dispatch**: this gateway is called by the "analyze network traffic / an unknown protocol" path in triage.md of [[re-analyze]] (re-protocol → netcap → crypto-* → proto-rev)

## Pitfalls

- **Capturing before the sandbox network is isolated → a real outbound connection**: symptom — the sample really reached an external C2, and the captured traffic cannot separate a malicious callback from a normal outbound connection; cause — [[re-sandbox]] network isolation (INetSim / fake DNS / cut the network) was skipped and the sample ran on the network; fix — isolate the network before any sample run (the top rule in [[re-analyze/platform-tips]]). Put the capture point inside the isolated environment
- **Ciphertext treated as plaintext, and the state machine rebuilt directly**: symptom — proto-rev clustering and field inference are entirely wrong, and the "structure" the parser produces is random bytes; cause — the traffic has an encryption layer (entropy >7.0) that was not identified first; fix — step 2, [[re-crypto-id]] confirms ciphertext first, then the decrypt chain, then [[re-proto-rev]]
- **A decrypt script is written hard without extracting the key**: symptom — the decrypt script does not produce plaintext for the captured traffic, or it decrypts only half; cause — the key is generated dynamically or changes per session, so a hardcoded assumption fails; fix — follow [[re-crypto-keys]] and take the real key from a memory dump ([[re-memdump]]) or from the key-derivation site. Leave the key as a parameter in the script
- **A decrypt result is treated as the conclusion without a check**: symptom — the "plaintext" in the report is actually a wrong decrypt (padding misaligned / a wrong IV); cause — there was no known-plaintext comparison (a protocol-header magic, a readable string, a known field value); fix — step 4 must check against known plaintext or a header, and the recovered plaintext gets one more readability check
- **A capture with no filter → a huge file that cannot be analyzed**: symptom — a pcap of tens of GB, and tshark statistics hang; cause — the capture point was not filtered (every interface, every protocol); fix — step 2 of [[re-netcap]] writes the filter expression first (host / port / protocol). Filter, then save
- **C2 over DoH blinds both network isolation and content analysis**: symptom — INetSim has no DNS query record at all, and the pcap only has ciphertext to dns.google / cloudflare-dns.com on 443, so protocol recovery has no raw material; cause — the sample ships its own DNS client and connects straight to an external resolver over DoH, bypassing the system resolver — fake DNS / INetSim are both blind, and DoH traffic cannot be separated from normal browser behavior by content (the DoHdoor backdoor encodes C2 commands into the DoH query string); fix — identify the signals "443 → a known DoH endpoint / a TLS handshake with no SNI (a hardcoded-IP direct connect) / the process side has a connection but no DNS event (Sysmon 3 without 22)", switch to the behavior side (beacon interval, which process started it) to locate the C2, and redirect the DoH endpoint IP or man-in-the-middle 443 (see the pitfall in [[re-netcap]])

### The general protocol-recovery path

- **A declarative definition first, a capture as the fallback**: symptom — protocol recovery starts from a capture or from watching behavior and takes the long way; cause — the client often embeds a declarative definition (proto / schema / an interface-description file), and it can be extracted as plaintext or half-plaintext; fix — when unpacking, search for a declarative definition first (`syntax = "proto3"`, `.fbs`, an interface description, and the rest). **Recovery priority: a declarative definition > decompiling the pack/unpack implementation > a capture**
- **Probe an official interface that is still in operation**: symptom — guessing the response format statically, and retrying by trial and error; fix — while the official service is still operating, hit the real interface directly with the client's request parameters (read-only class, low rate). The envelope (`{code,msg,data}`) and the error-code meanings (401 a bad parameter / 404 a bad id / 406 a bad op) come back in one shot, and then the client's parse code confirms the fields. That is an order of magnitude faster than a pure static recovery
- **Confirm "not implemented" encryption with a full search**: symptom — a protocol flag bit `0x40000000=Encrypt` is assumed to mean there is an encryption layer; cause — the flag bit is infrastructure, and the feature may never have been enabled; fix — search the whole sample for an algorithm implementation (AES/RC4/XXTEA and the rest) and for call sites. Only after both the C# layer and the native layer have nothing is the conclusion "not encrypted" (a common case: the encryption bit is reserved, and the compression bit is the one actually used)

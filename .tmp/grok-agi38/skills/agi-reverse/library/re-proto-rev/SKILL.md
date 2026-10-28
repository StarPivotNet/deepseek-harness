---
name: re-proto-rev
description: >
  Protocol state-machine recovery: Scapy parsing and message structure.
  Triggers: `协议逆向`, `状态机`, scapy, `自定义协议`
capabilities: [protocol-recovery]
---

# Protocol state-machine recovery

## When to use / when not to use

- Use: plaintext traffic is in hand (a pcap or a live stream) and the question is "what does a message look like, and how do the two sides talk"
- Use: inferring the field structure of a custom, private, or unknown protocol
- Use: inferring the interaction pattern of a C2 protocol or a firmware communication protocol (handshake / heartbeat / end)
- Do not use: the traffic is ciphertext (do [[re-crypto-id]] → [[re-crypto-keys]] → [[re-crypto-decrypt]] first, and come back after plaintext)
- Do not use: a standard protocol (HTTP/TLS/DNS) — use the Wireshark dissector directly (see step 3 of [[re-netcap]])
- Do not use: only the traffic needs to be captured (that is [[re-netcap]])

## Tool setup

Verify every tool before use. This skill only handles data and parser scripts. It does not run the sample, so it may skip the sandbox (the top rule in [[re-analyze/platform-tips]]). Capturing traffic happens inside [[re-netcap]].

### python3 — the parser-script runtime

- Linux: `apt install python3 python3-pip` / `dnf install python3 python3-pip` / `pacman -S python python-pip` (usually already present)
- macOS: `brew install python` (or shipped with the Xcode CLT)
- Windows: the python.org installer (check Add to PATH); the Linux build inside WSL
- Check: `python3 --version`

### scapy — the pcap-parsing and protocol-construction workhorse

- All platforms: `pip install scapy` (Python 3, preferred)
- Linux: some distros have a package (`apt install python3-scapy`)
- Check: `python3 -c "import scapy; print(scapy.__version__)"`
- Reading a pcap: `rdpcap` is enough, and it is a pure-Python parse (libpcap is not required; libpcap is needed only for a live `sniff()`. Force a pure-Python parse with `conf.use_pcap = False`)
- Check (cross-platform; write a temporary pcap and read it back; do not depend on /dev/null): `python3 -c "import tempfile,os; from scapy.all import rdpcap, wrpcap, IP, TCP, Raw; f=os.path.join(tempfile.gettempdir(),'t.pcap'); wrpcap(f,[IP()/TCP()/Raw(b'test')]); print(len(rdpcap(f)))"` — printing `1` means it is fine

### tshark — group statistics and a first look at fields (install is in [[re-netcap]])

- `tshark -r out.pcap -q -z conv,tcp` is session statistics, and `-z io,stat,1` is the time series — used by the clustering in step 1
- Check: `tshark --version`

### binwalk — a known-format clue (when a blob is embedded in the pcap)

- Install and check as in the tool setup of [[re-fw-extract]]
- Purpose: when a parsed field looks like an embedded file or image (gzip/zip/PNG and the rest), `binwalk blob.bin` confirms the format

## Steps

Run in order and record each result. Prerequisite: **the traffic must be plaintext** (ciphertext goes through [[re-crypto-decrypt]] first).

1. **Group statistics and clustering (length / direction / timing)**:
   ```sh
   tshark -r out.pcap -T fields -e tcp.len -e ip.src -e ip.dst | awk '{print $1}' | sort -n | uniq -c   # 长度分布
   tshark -r out.pcap -q -z conv,tcp          # 会话列表：谁和谁、包数、字节数
   tshark -r out.pcap -q -z io,stat,1         # 每秒流量：找规律性心跳
   ```
   - The clustering goal: group by direction (A→B / B→A) and look at the length distribution. A small number of fixed lengths → a fixed-length message (there may be no length field). Lengths that vary continuously → a variable-length message (some framing is usually required; candidates: an embedded length field, a delimiter, a fixed grammar, chunked blocks, connection close)
   - A packet at a regular interval (a small fixed-length packet every 30s) → a heartbeat message (see pitfall 3)

2. **TCP stream reassembly → application-layer framing (a required prerequisite; do not skip it)**:
   - TCP is a byte stream and does not preserve application-layer message boundaries (RFC 9293 §3.7) — one segment may be 0, 1, or several messages, and one message may also span several segments (an MSS split). Treating `bytes(p[TCP].payload)` packet by packet as a message is systematically wrong: consecutive `send()` calls with no gap are often merged into one chunk, and a large payload or a slow link is cut apart. "One write is exactly one segment" is only a timing coincidence
   - Reassemble **per connection and per direction** (normalize the `(src,sport,dst,dport)` 4-tuple, then split A→B / B→A): sort by TCP SEQ, drop duplicates (retransmits / overlapping segments), fill out-of-order holes, and record capture gaps (byte ranges missing because of packet loss) — drop a candidate message that crosses a gap. Do not force-join the wrong bytes
   - Infer framing only after the **one-way byte stream** is reassembled: magic+length / a delimiter / a fixed length / TLV / framing by connection close. Do not infer fields before framing is settled
   - The Scapy route: a `TCPSession` plus a `tcp_reassemble()` hook (it can handle duplicates and overlaps). Without writing code, `tshark -r out.pcap -q -z follow,tcp,raw,<stream-number>` takes the one-way byte stream for a manual look
   - **A datagram transport such as UDP does not use this model**: a datagram keeps the message boundary, and one datagram is one message (or contains a whole message). It can still be several messages concatenated, or fragmented again at the application layer. Only do length and boundary statistics. Do not reassemble by SEQ

3. **Locate the fixed header (magic / a length field)**:
   ```python
   # 对重组后的单向字节流扫描候选 magic 前缀（不是逐包取前 8 字节）
   from collections import Counter
   stream = b""  # 步骤 2 按 (四元组, 方向) 重组出的单向字节流
   cnt = Counter()
   for off in range(max(0, len(stream) - 8)):
       cnt[stream[off:off + 8]] += 1
   for k, v in cnt.most_common(10):
       print(v, k.hex())
   ```
   - A high-frequency prefix → a magic candidate (for example `0xAA55`, `\xDE\xAD\xBE\xEF`, an ASCII brand name). Bytes 2-4 change inside the same stream while the prefix stays fixed → a variable-length message, and the changing place is the length field
   - **A candidate magic counts only after it passes the length constraint**: let the magic sit at offset `m`, and let bytes 2-4 after it be the length field `L`. The next magic should land at `m + header length + L`. Only a candidate whose majority of occurrences satisfy that recurrence is a real magic (this excludes a byte pair that happens to appear in the data)
   - A hand check: hexdump a few representative positions (`tshark -r out.pcap -q -z follow,tcp,raw,<stream-number>`) and confirm the byte order of the magic and the length field (see pitfall 1)

4. **Infer fields (type / length / CRC)**:
   - The length field: plot or sort the value at a fixed offset against **the distance between neighboring frame starts in that direction**. Try byte order by whether the value is reasonable (try big-endian and little-endian; see pitfall 1)
   - The type field: a fixed set of first bytes inside the same length family (for example 0x01/0x02/0x03) → a message type. Together with the timing, see whether the type sequence looks like a request-response pair
   - CRC/checksum: the last 2-4 bytes are sensitive to payload changes → a checksum (identify it first; do not parse it as data — see pitfall 2). Try common CRC16/CRC32 polynomials with `crcmod` (`pip install crcmod`), or XOR against the payload and see whether it is a simple XOR checksum
   - When the structure is uncertain, use a differential: two packets that differ by a single byte, XOR them byte by byte → the bytes that change are the "key field" positions

5. **Write a Scapy parser (a custom protocol class)**:
   ```python
   from scapy.all import Packet, ByteField, ShortField, XByteField, StrFixedLenField
   class C2(Packet):
       name = "C2"
       fields_desc = [
           XShortField("magic", 0xAA55),
           ByteField("type", 0),
           ShortField("len", 0),
           StrFixedLenField("payload", b"", 64),
       ]
   # 测试解析（hex 与 fields_desc 对齐：aa55 | 01 | 000a | 54657374696e672e2e2e，len=0x000a=10 = "Testing..." 的 10 字节）
   pkt = C2(bytes.fromhex("aa5501000a" + "54657374696e672e2e2e" + "00" * 54))   # aa55 | 01 | 000a | "Testing..."（10B）+ 54B 零填充，凑满 64B payload
   pkt.show()
   ```
   - Field order and width follow the inference in steps 3 and 4. A parser that can show each field (`show()`) has confirmed the field layout
   - Batch processing: **run a continuous buffer parser on the one-way byte stream reassembled in step 2** (not `C2(load)` packet by packet) — loop, parse one message from the current offset, and advance by the parsed length, until the remaining bytes are not enough for a complete message. The parser must handle **0 messages / 1 message / N messages corresponding to one segment**. On a gap or a parse failure, stop at that position and record it. Do not skip the bad bytes and keep aligning (a misalignment then spreads silently). On the Scapy side, `TCPSession` can instantiate the `C2` class on the reassembled stream
   - Compare with Wireshark's raw bytes: pick a few frame start and end offsets, and confirm the bytes match in `follow,tcp,raw`

6. **Infer the state machine (handshake / heartbeat / end)**:
   - Draw the "who sends which message" sequence in time order: client → the server's first message (connection setup / a handshake request) → the response → later business → a periodic heartbeat → disconnect. The unit of the sequence is **the reassembled message** (steps 2/5), not a TCP packet
   - For each message class, record: direction, the type value, the fields, and the trigger condition (what must be received before this is sent)
   - Check the inference: go back to the reassembled stream and look for a counterexample — a message that did not follow the "state machine", a half message reset mid-connection, a missing frame caused by a capture gap (if there is one, add the state or the transition condition, or explain the exceptional branch). The final product is a state diagram (text or mermaid) plus a message-format table, written into the report for [[re-ioc]] to cite

## Cross-domain handoff

- [[re-protocol]]: this skill is step 5 of that workflow (state-machine recovery) — the final product stage for plaintext traffic
- [[re-malware]]: C2 protocol recovery — step 4 of re-malware (netcap → proto-rev → crypto-*). The recovered protocol semantics (handshake / heartbeat / command) are the basis of the behavior judgment and the IOCs
- [[re-firmware]]: firmware communication-protocol recovery — step 6 of re-firmware (firmware callback / a custom protocol)
- [[re-netcap]]: the raw-material source (a plaintext pcap and tshark statistics)
- [[re-crypto-id]] / [[re-crypto-decrypt]]: the prerequisite — when the traffic is ciphertext, decrypt first and then enter this skill
- The product (the message-format table / the state diagram) goes back to [[re-ioc]] for the report and YARA signatures

## Pitfalls

- **The wrong length-field byte order makes the whole parse wrong**: symptom — the parser reads the length as little-endian, the length value is huge or absurd, and every later field is misaligned; cause — the protocol's length field is big-endian (network order) and was read as host-order little-endian; fix — step 4 tries both endiannesses for the length field, and decides by "whether the length is reasonable (≤ the frame's actual span in the reassembled stream)". The parser uses an explicit network-order `!H` / `!I`
- **Identify the CRC/checksum before parsing**: symptom — the checksum at the end of the packet is parsed as business data, fields are misaligned, and messages do not match; cause — in an unknown protocol a checksum and data cannot be told apart by name; fix — if the last 2-4 bytes change sensitively with the payload, assume a checksum first, identify it with crcmod or XOR, and skip it in the parser or give it its own field
- **A heartbeat message is confused with business traffic**: symptom — a periodic heartbeat is treated as a business message, the state machine grows a fake "one extra send" branch, and the command sequence is scrambled; cause — the heartbeat and the business message share a structure (the same magic and the same type prefix), and only the timing is regular; fix — the `io,stat` of step 1 finds the fixed-period small packet, marks it as a heartbeat, and handles it separately. The state machine treats it as its own state transition
- **Direction is confused (a C2 interaction pattern)**: symptom — the server→client direction is read backwards, a command message is treated as a response, and pushed data is treated as a reply; cause — in C2 the client polls actively (the request carries the command) or the server pushes actively (there is traffic with no request), and the two are mixed; fix — assign A/B roles from IP:port first, do the statistics per direction (step 1), and use the timing to confirm who is the active side. Mark the direction of every transition on the state diagram
- **A built-in Scapy layer binding hijacks a custom payload**: symptom — a custom protocol payload is automatically decoded by Scapy as DNS or another built-in layer, and the fields are entirely wrong (for example a UDP 53 payload always decodes to the default values); cause — the default `bind_layers()` binding (UDP/53→DNS and the rest) hits first inside `guess_payload_class()`; fix — `split_layers()` removes the default binding, the custom protocol class overrides `guess_payload_class()` and dispatches explicitly, or the parser script forces construction with the custom class on every packet
- **A short packet or a fixed-length field silently degrades to Raw**: symptom — the parser prints Raw or misaligned fields for some packets with no error, and the error hides once there are many packets; cause — when a packet is shorter than the fields' minimum length, Scapy silently treats the whole packet as Raw (there is no Wireshark-style malformed mark), and `StrFixedLenField` interacting with the packet cache also builds inconsistently; fix — before parsing, explicitly check that the payload length ≥ the sum of the fields. Record a short packet separately and do not force a parse. Round-trip each custom class (`bytes(pkt)` and parse it back, and compare with the on-the-wire bytes) before a batch run
- **After reinjection the peer reports a bad FCS or a wrong frame length**: symptom — after a captured frame is reinjected, the peer's Wireshark reports "ETHERNET FRAME CHECK SEQUENCE INCORRECT" or the frame length does not match the expectation; cause — **look at two lengths separately**: the Ethernet **FCS is 4 bytes**, and a **typical Ethernet header is 14 bytes** (6 destination MAC + 6 source MAC + 2 type) — **"14 bytes short" points at a header or link-layer encapsulation problem, not the FCS**. A capture library's frame abstraction (padding handling, whether the FCS field is parsed, whether a trailer is present) differs by version and configuration, and **cannot be summarized as "the tail is not kept"**; fix — measure **how many bytes are actually missing** before locating the cause: 4 bytes missing means check whether the FCS was stripped; 14 bytes missing means check whether the Ethernet header was dropped or duplicated, or whether the inject landed on the wrong layer. Prefer **raw bytes** for reinjection rather than a packet after a round trip, or inject at L3 on the local loopback (lo) and avoid the Ethernet layer

- **Reading only the serialize function confirms the layout from one side**: symptom — the field order inferred from serialize does not match real traffic; cause — pack and unpack may be asymmetric (conditional fields, a version branch); fix — **read the serialize and deserialize functions against each other** (serialize vs parse). The layout is real only when both directions agree. A protocol library usually contains both the pack and the unpack function
- **A protocol behavior anchor was missed**: symptom — a special command (heartbeat / time correction) takes its own assembly path, and parsing it as the generic frame structure is entirely wrong; cause — a hardcoded special-case string or command inside the protocol library is a behavior anchor; fix — grep the native library and the config for command strings (heartbeat/correcttime class). Locate the special path first, then parse the generic structure
- **A Java client ignores the JNI contract**: symptom — reversing the native library finds no entry; cause — the Java layer calls native code through JNI. A statically registered method stays in the dynamic export table as `Java_package_class_method` (strip does not delete .dynsym) and can serve as the interface document. A library registered dynamically with `RegisterNatives` has **no** `Java_*` export; fix — `nm -D` lists the JNI exports. If they exist, the function names give the contract directly (the encode/parse/setKey split) and reversing starts from the exported functions. If they do not, locate the entry from a `JNI_OnLoad` / `RegisterNatives` call site, a JNI function-table xref, strings, and a runtime hook ([[re-frida]])
- **An IRC/text protocol is fragmented in the middle of a word**: symptom — a protocol message extracted from a capture contains "half a word" (for example "giant s", "undead eye"), and parsing materials or fields by the message boundary misaligns them; cause — an IRC server (InspIRCd) hard-cuts a long message at about 400 bytes (it does not respect word boundaries), and the client **concatenates every fragment and then splits again on the delimiter**; fix — follow the client: concatenate neighboring messages (`Join(msgs, "")`) → split again on the delimiter (`,` and the rest), rather than parsing each message boundary on its own. TSHARK follow's ascii mode truncates the display at about 451 bytes. Long data must be extracted in raw (hex) mode
- **A message-accumulation trigger**: symptom — the protocol client handles a long message in fragments and triggers the full handling only under a specific condition; cause — the client accumulates messages by an "end marker" (for example it handles the whole stretch only when it ends in `.` / `?`), and the middle fragments are only a buffer; fix — decompile the client's message handler and find the accumulation condition (it contains its own name plus an end character, and so on). When replaying, build the message in that format, or the message is dropped silently
- **A fake server replays and checks the protocol**: symptom — the protocol logic is complex and static reversing is slow; cause — the client program's logic (a bot / a C2 beacon) triggers during interaction; fix — fake the server (a fake IRC/HTTP plus a DNS hook to local) and replay the real pcap sequence. Watch the client behavior (messages sent / the call chain) and check the protocol understanding quickly
- **A web captcha / a modern JS protocol: work backwards from the Verify interface**: symptom — reversing the captcha cipher directly has no starting point, or the check still fails after a recovery; cause — the data the captcha actually submits is entirely wrapped in a single field (for example captchaBody), and the algorithm is only the last step; fix — the pipeline: capture the Verify request → locate the core field → instrument the JS and find the plaintext `plain` before the SDK encrypts it → analyze each plain field's source one by one (an interface return needs no computation / a gap recognition: download the image + OpenCV finds the gap and computes the drag distance / browser-environment collection is generated in the SDK's format / trajectory coordinates) → once the plaintext matches completely, encryption is the easiest step (follow the SDK call chain and run the same encryption flow as the browser). The core principle is **identical inputs, not an equivalent algorithm**
- **An extra signature layer is computed at the same time as the protocol**: symptom — the core field (captchaBody) was recovered correctly and Verify is still rejected; cause — besides Verify there is a request-protection signature that the page SDK generates automatically (it was left out when the protocol was implemented); fix — confirm every automatically generated parameter from the page SDK's full call chain and include them all. In the same kind of case, list every "non-hand-written field the request contains" before implementing
- **A private protocol has no parser**: symptom — Wireshark shows only Data; cause — a private protocol has no dissector; fix — write a Lua dissector (under 100 lines) or analyze it offline in Python
- **Data with no pattern → assume encryption first**: symptom — every frame is different; cause — a compression or encryption layer; fix — entropy analysis (>7.5 → a candidate for encryption / compression / high randomness, supported by the frame-length pattern and the entropy distribution; high entropy is not the verdict). An encryption layer looks for a nonce/IV field. When the length field will not parse, set up equations for "the length may be little/big-endian, and may or may not include itself" and solve the meaning
- **A replay is rejected**: symptom — the data is correct but the server does not respond; cause — the protocol has an incrementing seq/nonce; fix — work out how seq is computed (a hash of the previous frame, or an incrementing counter), and advance it correctly when reproducing
- **A closed-loop check**: symptom — there is no criterion for whether the protocol recovery holds; cause — static analysis cannot prove the recovery is correct by itself; fix — write a client from the recovered frame structure and send one frame. It holds only when the server's response matches
- (source: reverse-skill field-journal, MIT)

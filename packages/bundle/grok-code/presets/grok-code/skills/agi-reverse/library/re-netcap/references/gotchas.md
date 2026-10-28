# tcpdump / tshark / mitmproxy pitfalls and limits

## Capture layer: permissions, drops, and rotation

- **An unprivileged user captures nothing**: CAP_NET_RAW is required — add `sudo`, or on Debian add the user to the wireshark group (`sudo usermod -aG wireshark $USER`, then log in again); WSL1 cannot capture natively, WSL2 can
- **The capture point is not on the path the traffic must take**: a switch port or a wireless NIC does not guarantee that traffic is mirrored to this host — a local capture only sees what this host sends and receives; for a target on another host, capture on the gateway or the virtual NIC (virbr0/vboxnet0); a physical tap or a switch mirror port is the bypass
- **Rotation splits a session across files**: `-C`/`-G` rotation cuts only by size or time and does not know session boundaries — after a long capture a session may be cut in half; check the duration with capinfos before drawing a conclusion
- **The wrong interface is silent**: common on a bridged VM or a multi-NIC host — start with `tcpdump -i any` and see which interface actually has the traffic

## Filter layer: syntax and field names

- **Capture filter ≠ display filter**: `host`/`port`/`net` are BPF syntax, valid only for `tcpdump -i` and `tshark -f`; `-Y` and the Wireshark filter box use field syntax (`ip.addr == ...` / `tcp.port == ...`) — mixing them raises a filter error or returns nothing with no other sign
- **Three easy field-name mistakes**: `tcp.dport` does not exist (legal names are `tcp.dstport` / `tcp.srcport` / `tcp.port`; `tshark -e tcp.dport` errors immediately); `ip.addr` matches either source or destination, and one side uses `ip.src` / `ip.dst`; from Wireshark 3.x the protocol name `ssl` is entirely `tls` (`tls.handshake.*`, not `ssl.*`)
- **The shell eats BPF parentheses**: `( )` starts a subshell — quote the whole filter expression
- **Filter syntax differs by version**: from 4.0, AND has higher precedence than OR (old expressions need parentheses); whitespace-only separation (for example `ip.addr 10.0.0.1`) is a syntax error; set members must be comma-separated; `ip.addr==1.2.3.4` with no spaces is still legal on 3.x

## Man-in-the-middle layer: TLS decryption limits

- **An untrusted certificate means no plaintext**: a client with certificate pinning, its own CA, or a built-in trust store cannot be opened by mitmproxy — first judge how hard the target checks certificates ([[re-tls]]); when the certificate is pinned, drop the man-in-the-middle and capture SNI and metadata instead
- **A transparent proxy only covers the ports it matches**: a REDIRECT rule matches by dport, and traffic on a missed port connects straight through; QUIC/HTTP3 (UDP 443) is outside TCP REDIRECT and needs a QUIC-specific man-in-the-middle or a downgraded target
- **TLS 1.3 ECH hides SNI**: an encrypted ClientHello makes an SNI filter useless (DoH/DoT are the same; see the pitfall in SKILL.md) — recover the clue from the endpoint IP and the beacon interval
- **NFQUEUE and a transparent proxy interfere with each other**: NFQUEUE needs a userspace handler that returns a verdict per packet (with no handler, traffic stalls); mitmproxy transparent mode uses nat REDIRECT and does not consume NFQUEUE — behavior is unpredictable when both rule sets are present, so keep only the set you need

## pcap analysis layer: data quality

- **A truncated packet has no payload**: when snaplen is too small the length field is present but the payload is missing, and field export comes back empty — check capinfos first and compare "Capture length" with the packet length
- **Timestamp drift**: a capture host with a wrong clock distorts session timing — when correlating across sources (INetSim / system logs), check each time base
- **A huge pcap freezes**: opening tens of GB in the GUI will hang — capinfos → statistics → subset, three steps (see sequence 3 in [[commands]])
- **A capture that starts mid-flow is missing the handshake**: TLS decryption and session reassembly both need the full handshake — the capture point must be on the same side as the client and must start from the beginning

## Version differences

- **Wireshark/tshark 4.x**: display-filter whitespace rules are tighter (whitespace-only separation is a syntax error from 4.0, and was deprecated from 3.6); AND has higher precedence than OR (old expressions need parentheses); the protocol name `ssl` was renamed `tls` in 3.x, and 4.x no longer accepts the old name; 4.2+ keeps adding fields and export formats
- **tcpdump/libpcap**: the default snaplen is 262144 (since 1.x); `-C` is in MB and `-G` is in seconds — the wrong unit writes too many or too few rotation files
- **mitmproxy**: recent builds require an explicit `--mode regular|transparent` (the old standalone `--transparent` flag was removed; trust `mitmproxy --help` on this machine); the CA lives in `~/.mitmproxy/`, older releases used different CA file names, so `ls ~/.mitmproxy/` before importing into the trust store
- **Field names drift across versions**: after a Wireshark upgrade, old filters and export scripts break; run `tshark -G fields` once before using them

## Notes

- Run everything inside the sandbox (the top rule in [[re-analyze/platform-tips]])
- File the capture product's sha256 and path; record filter and statistics conclusions in the analysis notes ([[re-triage]] / [[re-analyze/analysis-contract]])

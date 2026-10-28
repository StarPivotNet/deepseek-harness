---
name: re-tls
description: >
  TLS/encrypted-traffic depth: fingerprints, key export, TLS 1.3.
  Triggers: TLS, SSL, ClientHello, `指纹`, SSLKEYLOG, `证书分析`
capabilities: [tls-analysis, crypto-identification]
---

# TLS / encrypted-traffic deep analysis

## When to use / when not to use

- Use: TLS/HTTPS traffic that must be "decrypted to plaintext" (you have a keylog or a man-in-the-middle) — C2 communication, firmware callbacks, encrypted application protocols
- Use: a ciphertext-only pcap still needs depth — ClientHello/certificate fingerprint clustering, abnormal TLS feature determination
- Use: certificate-chain verification / certificate content analysis (openssl x509)
- Do not use: capture only, no depth (that is [[re-netcap]])
- Do not use: traffic is already decrypted and there is no TLS layer (go straight to [[re-proto-rev]] and rebuild the state machine)
- Do not use: custom encryption that is not standard TLS (use [[re-crypto-id]] → [[re-crypto-keys]] → [[re-crypto-decrypt]])
- Note: this skill handles traffic and key files and does not run the sample, so a sandbox is not required by default. Capture follows [[re-netcap]] in an isolated environment (top rule in [[re-analyze/platform-tips]])

## Tool setup

Verify every tool before use.

### tshark / wireshark — parse, fingerprint, and decrypt (install in [[re-netcap]])

- Linux: `apt install wireshark tshark` / `dnf install wireshark-cli wireshark` / `pacman -S wireshark-cli wireshark-qt`
- macOS: `brew install --cask wireshark` (includes the tshark CLI); Windows: `choco install wireshark`
- Verify: `tshark --version`; `tshark -r out.pcap -Y 'tls.handshake.type == 1' | head -1` can parse a ClientHello
- JA3 field (built into Wireshark 3.6+) and JA4 field (native in Wireshark 4.2+, client side only): verify `tshark -r out.pcap -T fields -e tls.handshake.ja4 | head -1` produces output. Whether the fields exist on this machine follows `tshark -G fields | grep -iE 'ja3|ja4'`

### openssl — certificate parse and TLS interaction (cross-OS)

- Linux: `apt install openssl` / `dnf install openssl` / `pacman -S openssl` (usually preinstalled)
- macOS: `brew install openssl` (keg-only; add `/opt/homebrew/opt/openssl@3/bin` (Apple Silicon) or `/usr/local/opt/openssl@3/bin` (Intel) to PATH)
- Windows: `choco install openssl.light` (PATH must be added by hand; see the package notes) or Git for Windows includes `openssl.exe`
- Verify: `openssl version`

### python3 — fingerprint clustering / batch analysis scripts (optional)

- Install and verify are in [[re-proto-rev]] Tool setup (python3)

### SSLKEYLOG environment — Chrome/Firefox key export (not a standalone tool)

- Chrome: set `SSLKEYLOGFILE=/tmp/keys.log` before launch (Linux/macOS) or `set SSLKEYLOGFILE=C:\keys.log` (Windows)
- Firefox: the same environment variable (restart the browser after setting it)
- Wireshark: Edit → Preferences → Protocols → TLS → (Pre)-Master-Secret log filename points at that file. On the tshark side use `-o tls.keylog_file:...`
- Verify: after setting it, visit an HTTPS site. keys.log shows lines such as `CLIENT_HANDSHAKE_TRAFFIC_SECRET` (TLS 1.3) or `CLIENT_RANDOM` (TLS 1.2)

### mitmproxy — man-in-the-middle decrypt (optional; install in [[re-netcap]])

- Scene: a third-party program with no keylog permission (a self-implemented TLS stack; certificate pinning is pitfall 4)
- Verify: `mitmdump --version`

## Steps

Run in order. Archive each step's products (fingerprint table / certificates / decrypted traffic) with sha256 + path ([[re-ioc]] evidence-chain requirement).

1. **ClientHello fingerprints (JA3/JA4)**:
   ```sh
   # JA3 (hash of ClientHello negotiation parameters; built into Wireshark 3.6+)
   tshark -r out.pcap -Y 'tls.handshake.type == 1' -T fields \
     -e tls.handshake.ja3 -e ip.src -e tls.handshake.extensions_server_name \
     | sort | uniq -c | sort -rn
   # JA4 (native in Wireshark 4.2+, client side; includes protocol/version/SNI/cipher-suite count/ALPN)
   tshark -r out.pcap -Y 'tls.handshake.type == 1' -T fields -e tls.handshake.ja4 \
     | sort | uniq -c | sort -rn
   ```
   - Use: cluster by "client fingerprint" — the same fingerprint = the same client stack (browser/library/malicious tool); a new cluster = a suspicious client
   - Compare: match public JA3/JA4 intelligence sources for known malicious clients. A miss = a weak signal and needs the step 5 synthesis (pitfall 3)
   - Field note: cluster SNI (`tls.handshake.extensions_server_name`) together with IP — the same fingerprint connecting to different targets is also a signal

2. **Certificate-chain analysis (openssl x509 parse)**:
   ```sh
   # One Certificate message often holds several certificates. The field is a comma-separated hex string (hex with colons) — split lines on commas, then convert each line to DER
   # Chain order is send order. The first line is the leaf (server) certificate. To keep only the leaf, add | head -1 after the line split (before tr -d ':')
   tshark -r out.pcap -Y 'tls.handshake.type == 11' -T fields -e tls.handshake.certificate \
     | head -1 | tr ',' '\n' | tr -d ':' | xxd -r -p > cert_chain.der
   openssl x509 -in cert_chain.der -inform DER -text -noout | head -60
   # Export each certificate separately (cert_1.der, cert_2.der, ...) with a loop or csplit on lines.
   # Do not xxd the whole chain into one file in one shot — concatenated DERs are not one legal DER object. openssl reads only the first and may error
   # Live capture (known host)
   openssl s_client -connect <host>:443 -servername <host> -showcerts </dev/null 2>/dev/null \
     | openssl x509 -noout -text
   # Certificate-chain verify result
   openssl s_client -connect <host>:443 -servername <host> -verify_return_error </dev/null 2>&1 \
     | grep -i 'verify return'
   ```
   - Analysis points: issuer/subject (CN/SAN), validity (odd dates / expired), self-signed vs trusted CA, SPKI/fingerprint (`openssl x509 -noout -fingerprint -sha256`), certificate reuse (the same certificate on several C2 domains = bulk issuance)
   - Note: the TLS 1.3 Certificate message (type 11) is inside the encrypted handshake, so `-Y 'tls.handshake.type == 11'` will not match. TLS 1.3 traffic must be decrypted first per step 3 (SSLKEYLOG), or captured live with openssl s_client
   - Platform note: `</dev/null` is POSIX syntax and does not apply to Windows cmd. On Windows use `echo | openssl s_client ...` or drop `</dev/null` and exit interactively
   - Malicious features: self-signed + newly registered domain + short validity (90 days to 1 year is common for bulk automated issuance)

3. **SSLKEYLOG decrypt (TLS 1.2/1.3 key export)**:
   ```sh
   # Decrypt on the tshark side (keylog file + reparse)
   tshark -r enc.pcapng -o tls.keylog_file:keys.log -Y 'http' \
     -T fields -e http.host -e http.request.uri
   # or GUI: Preferences → Protocols → TLS → (Pre)-Master-Secret log filename
   ```
   - TLS 1.2: the keylog records `CLIENT_RANDOM <hex> <master secret>` — the master secret decrypts every record in this session
   - TLS 1.3: the keylog records per-stage traffic secrets (`CLIENT_HANDSHAKE_TRAFFIC_SECRET` / `SERVER_HANDSHAKE_TRAFFIC_SECRET` / `CLIENT_TRAFFIC_SECRET_0` / `SERVER_TRAFFIC_SECRET_0` / `EXPORTER_SECRET`) — there is no 1.2 master secret. Manual derivation uses HKDF-Expand(-Label) from each traffic secret to derive record keys (Extract is an earlier-stage operation; see pitfall 1). Wireshark/tshark reading the keylog file handles both protocol generations automatically
   - Verify decrypt succeeded: after decrypt you can see plaintext HTTP/application-protocol fields (the raw material for semantic recovery in step 4). If decrypt fails, first check whether keys.log has a CLIENT_RANDOM or traffic-secret entry for that session (pitfall 2)
   - Live-capture scene: set SSLKEYLOGFILE, then start Chrome/Firefox (Tool setup). The capture and the keylog are produced together

4. **Encrypted-traffic semantic recovery (application-layer protocol restore)**:
   ```sh
   # After decrypt, restore by application-layer protocol (TLS is only the carrier; semantics are in ALPN / the upper protocol)
   tshark -r decrypted.pcapng -Y 'http' -T fields -e http.request.method -e http.host -e http.request.uri
   tshark -r decrypted.pcapng -Y 'tls.handshake.extensions_alpn_str' -T fields -e tls.handshake.extensions_alpn_str | sort | uniq -c   # ALPN application protocol: ClientHello holds the client candidate list (offered); the final result (negotiated) is in ServerHello for TLS ≤1.2 and in EncryptedExtensions for TLS 1.3
   ```
   - Flow: decrypt (step 3) → identify the upper protocol (ALPN: http/1.1, h2, custom; or by port/features) → reassemble the session → extract semantics (C2 commands / config / plaintext credentials)
   - Separate offered and negotiated: `tls.handshake.extensions_alpn_str` hits both the ClientHello (client candidate list) and the handshake message that carries the final result. Counting them together treats candidates as the conclusion. The TLS 1.3 ALPN result is not in ServerHello — ServerHello only returns extension types, and the real ALPN extension is in EncryptedExtensions (visible only after handshake-key / keylog decrypt). Before decrypt, that field only shows ClientHello candidates. Judge the final protocol from the negotiated side, or look directly at the decrypted application-layer record type
   - Custom protocol: after plaintext is recovered, hand off to [[re-proto-rev]] for state-machine rebuild ([[re-protocol]] workflow step 5)
   - Boundary: TLS decrypt only opens traffic from a "standard TLS stack". A self-implemented / modified TLS (no ClientHello structure, no matching keylog entry) fails to decrypt and can only go to feature analysis (step 5)

5. **Malicious TLS features (fingerprint clustering / abnormal certificates)**:
   - Feature list: (1) fingerprint clustering — a new JA3/JA4 cluster, or a hit on a known malicious library (the native curl/python requests stack is also a common signal) (2) abnormal certificate — self-signed / short validity / SNI does not match IP / certificate CN is an IP (3) beacon rhythm — short connections at a fixed interval (align with the [[re-behavior]] timeline) (4) abnormal SNI — random subdomains / high-entropy SNI / no SNI (hard-coded IP direct connect; same family as the [[re-netcap]] DoH pitfall) (5) mixed protocol — non-TLS on 443
   - Clustering method: layer the step 1 fingerprint table with session stats (connection duration / packet size / direction ratio). Compare against a normal-browser baseline (capture a baseline inside the sandbox first)
   - Conclusion discipline: fingerprints and certificates are both "weak signals" and can be forged (pitfall 3) — a final call needs the behavior side (process ownership / beacon / download behavior) as a cross-check. When entering an IOC, mark the signal type
   - Product: malicious TLS session list (time/IP/fingerprint/certificate/SNI) + features into [[re-ioc]] YARA (certificate bytes / fingerprint pattern)

## Related skills

- [[re-netcap]]: capture and filter (input material for this skill; capture strategy for the DoH/encrypted-traffic blind spot is in its pitfalls)
- [[re-proto-rev]]: state-machine rebuild on decrypted plaintext (downstream of step 4)
- [[re-protocol]]: this skill is the TLS specialty of that gateway — the deep-analysis branch for standard TLS traffic. Custom encryption goes to the crypto trio
- [[re-crypto-id]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]: non-standard / self-implemented crypto chain (the handoff when a TLS fingerprint or decrypt fails)
- [[re-malware]]: TLS feature determination for malicious C2 (the step-4 refinement of callback-traffic analysis)
- [[re-frida]]: certificate-pinning bypass (pitfall 4) — hook the verify function together with mitmproxy
- [[re-sandbox]]: capture-environment isolation and baseline traffic collection (top rule in [[re-analyze/platform-tips]])
- Cite the static-first approach and the sandbox network-isolation branch in [[re-analyze/platform-tips]]

## Pitfalls

- **TLS 1.3 key export is not the same as 1.2**: symptom — manually decrypting 1.3 traffic with the 1.2 "CLIENT_RANDOM → master secret" idea fails, and keys.log has no master-secret entry; cause — TLS 1.3 forward secrecy plus per-session independent derivation. The keylog records traffic secrets (CLIENT_HANDSHAKE_TRAFFIC_SECRET and similar), not a master secret / RSA premaster; fix — hand the keylog file straight to Wireshark/tshark (`-o tls.keylog_file:...`) and let it handle both generations. For manual derivation, use HKDF-Expand(-Label) from each traffic secret to derive that stage's record keys (handshake-stage and application-stage keys differ)
- **Forward secrecy (no keylog means no decrypt)**: symptom — you have only a pcap and no keys, and plaintext will not come out; cause — the ECDHE session key exists only in memory at the two ends of the session, not at a static location; fix — accept that it cannot be decrypted and switch to fingerprint/metadata analysis (SNI/certificate/length/timing, step 5). Prepare two paths in advance: set SSLKEYLOGFILE before capture (a client you control) or mitmproxy man-in-the-middle (a third-party program, paired with the pitfall 4 certificate-pinning bypass)
- **Fingerprints can be forged**: symptom — JA3/JA4 clustering puts a malicious client in the "normal browser" cluster, or two unrelated clients share a fingerprint; cause — a fingerprint only reflects ClientHello negotiation parameters. curl/requests/malicious code can imitate them (fingerprint spoofing is routine C2 infrastructure); fix — treat the fingerprint as a weak signal for clustering and correlation, not as an identity determination. Hits and misses both need certificate, SNI, and the behavior side (process ownership / beacon) as a cross-check. State evidence strength in the conclusion
- **Certificate-pinning bypass needs a man-in-the-middle**: symptom — after mitmproxy is in the middle the target refuses the connection / certificate error, and plaintext is unavailable; cause — the application embeds a public key / SPKI fingerprint for certificate pinning and does not trust the system CA; fix — [[re-frida]] hooks the verify function (SSL_CTX_set_verify / X509_verify_cert / a self-implemented pin check) to return success, or patch the program to skip the check, then use mitmproxy for plaintext. Operate inside a sandbox ([[re-sandbox]]), and note the bypass method and version in the conclusion
- **ECH (extension 65037 encrypted ClientHello) and delay-based proxy detection**: symptom — the JA3/JA4 fingerprint looks normal but the request is still rejected, or the fingerprint can be imitated but a proxy is identified as soon as it is attached; cause — anti-bot upgrades: (1) ECH (Encrypted Client Hello, extension 65037) encrypts SNI/extensions into the ClientHello, so fingerprint analysis cannot see SNI (from 2025 onward it already appears in anti-bot detection chains at verify=3); (2) proxy detection does not use allow/deny lists, reputation scores, or behavior analysis. It **measures request delay** (server round-trip time difference) to identify VPN/proxy — a proxy/tunnel necessarily adds delay. A fingerprint can be forged, but the delay cannot be removed. Read the metric carefully: under ordinary conditions single-connection classification can reach 99% precision/recall, and the combined **F1 is about 92%** (F1 is the harmonic mean of precision and recall; it is not "detection rate" and not "accuracy"). Simple traffic-scheduling evasion can push traditional RTT-detection recall from 99% down to 8% — that is why delay-class detection needs a more robust method; fix — analysis side: the capture tool / man-in-the-middle must support ECH decrypt (the key is in the server and browser ECH key configuration). Evasion side: delay-class detection cannot be bypassed by forging a fingerprint; only a direct connection or a low-delay tunnel changes it. During analysis, first confirm whether the target uses fingerprints or delay detection

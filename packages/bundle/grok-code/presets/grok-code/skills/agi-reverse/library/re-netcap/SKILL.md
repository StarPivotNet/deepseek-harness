---
name: re-netcap
description: >
  Network traffic capture: tcpdump/Wireshark/packet capture.
  Triggers: `抓包`, tcpdump, wireshark, `流量分析`, pcap
capabilities: [network-capture]
---

# Network traffic capture

## When to use / when not to use

- Use: any task that needs network traffic — watching a malware sample call home, firmware communication analysis, or collecting raw material for protocol reversing
- Use: an existing pcap that needs export, statistics, or filtering (the tshark stage)
- Use: HTTPS/TLS traffic that must be decrypted to plaintext (mitmproxy man-in-the-middle)
- Do not use: traffic is already decrypted, or it is unencrypted and only the protocol semantics are needed (go straight to [[re-proto-rev]])
- Do not use: the sample does not use the network (do static analysis first with [[re-triage]])
- Do not use: a quick look at a handful of packets (`tcpdump -i any -c N` is enough; do not stand up the full flow)

## Tool setup

Verify every tool before use. Capturing while a sample runs stays inside the sandbox by default ([[re-sandbox]] network isolation, the top rule in [[re-analyze/platform-tips]]) — the capture environment and the isolation environment must both be ready.

### tcpdump — command-line capture workhorse

- Linux: `apt install tcpdump` / `dnf install tcpdump` / `pacman -S tcpdump`
- macOS: `brew install tcpdump` (or the version shipped with the system)
- Windows/WSL: the Linux build inside WSL; on native Windows use Wireshark or dumpcap shipped with Npcap
- Check: `tcpdump --version`; `tcpdump -D` lists interfaces

### wireshark / tshark — GUI + CLI analysis (tshark for export and statistics)

- Linux: `apt install wireshark tshark` / `dnf install wireshark-cli wireshark` / `pacman -S wireshark-cli wireshark-qt` (Arch is already split into wireshark-cli + wireshark-qt; on Debian choose "allow non-root capture" at install time, or run `sudo dpkg-reconfigure wireshark-common` and add the user to the wireshark group)
- macOS: `brew install --cask wireshark` (includes the tshark CLI; or `brew install wireshark` for CLI only)
- Windows: `choco install wireshark` (or the official installer); inside WSL use the Linux build
- Check: `tshark --version`; `tshark -D` lists interfaces; `dumpcap -D`
- Sibling CLIs: `capinfos` (pcap metadata: packet count / duration / truncation), `mergecap` (merge), `editcap` (split / dedupe / rewrite timestamps), installed with Wireshark

### mitmproxy — HTTPS/TLS man-in-the-middle decryption

- All platforms: `pip install mitmproxy` (**current 12.x requires Python >=3.12**; pin a matching older release on an older Python)
- macOS: `brew install mitmproxy`
- Windows: the pip build is enough (or the official installer); the pip build inside WSL
- Check: `mitmproxy --version`; `mitmdump --version`

### nfqueue — kernel traffic redirect / man-in-the-middle capture point (Linux)

- Linux: `apt install iptables libnetfilter-queue1 python3-netfilterqueue` / `dnf install iptables libnetfilter_queue-devel python3-netfilterqueue` / `pacman -S iptables libnetfilter_queue python-netfilterqueue`; or `pip install NetfilterQueue` (needs kernel nfnetlink_queue support)
- macOS/Windows: not supported (use a WSL2 kernel or a Linux VM as the redirect point)
- Check: `python3 -c "from netfilterqueue import NetfilterQueue"`; `iptables -L -n | grep -i NFQUEUE` shows the rules

## Steps

Run in order and record each result. Archive the capture product (pcap path + sha256) for [[re-proto-rev]] / [[re-crypto-decrypt]].

1. **Choose the capture point (host / gateway / man-in-the-middle)**:
   - Host: the target program runs on this machine → `tcpdump -i eth0 host <target-ip>` (or pick the interface in Wireshark and capture directly)
   - Gateway / forward point: the target is in a sandbox VM or on another host → capture on the gateway host or the VM virtual NIC (virbr0 / vboxnet0), `tcpdump -i virbr0`
   - Man-in-the-middle: HTTPS plaintext is required → a mitmproxy transparent proxy forces the target traffic onto this machine (see steps 4 and 5); use an nfqueue handler only for packet-level intercept that does not tear open TLS
   - Sandbox: the capture point is the sandbox virtual NIC plus the INetSim / fake-DNS sink from [[re-sandbox]] (see step 5)
   - Decision record: write down the capture point and why (why this point sees both the request and the response)

2. **tcpdump filter syntax (filter first, then write to disk)**:
   ```sh
   sudo tcpdump -i eth0 -w out.pcap            # 全量（先别这么干，见坑 4）
   # 常用过滤：
   sudo tcpdump -i eth0 host 1.2.3.4 -w out.pcap          # 按 IP
   sudo tcpdump -i eth0 port 443 -w out.pcap              # 按端口
   sudo tcpdump -i eth0 host 1.2.3.4 and tcp port 8080    # 组合，先屏显验证再存
   sudo tcpdump -i eth0 -c 500 -w out.pcap                # 限包数
   ```
   - BPF essentials: `and/or/not`, `host/port/proto`, parentheses for grouping; omit `-w` first and confirm on screen that the filter hits the target before writing the file
   - Combine conditions with parentheses: `tcpdump -i eth0 '(host 1.2.3.4 or host 5.6.7.8) and not port 53' -w out.pcap`
   - Capture-time options: `-n` disables reverse DNS (avoids lookup delay and result pollution); `-s 200` limits the capture length (the default is the full 262144-byte snaplen); for a long capture add `-C 100 -W 10` to rotate at 100MB and keep 10 files so the disk does not fill

3. **tshark export and statistics (pull the key flows out of an existing pcap)**:
   ```sh
   tshark -r out.pcap -T fields -e ip.src -e ip.dst -e tcp.dstport | sort | uniq -c | sort -rn   # 会话统计（目标端口字段名是 tcp.dstport / tcp.port，不存在 tcp.dport 字段）
   tshark -r out.pcap -Y 'http.request' -T fields -e http.host -e http.request.uri             # 只看 HTTP 请求
   tshark -r out.pcap -Y 'tls.handshake.type == 1' -T fields -e tls.handshake.extensions_server_name   # SNI
   tshark -r out.pcap -q -z conv,tcp -z io,phs                                                  # 会话表 + 协议层级统计（-q 静默，只出统计）
   tshark -r out.pcap -T json -e ip.src -e dns.qry.name -Y dns | jq .                          # JSON 输出（脚本后续处理）
   tshark -r out.pcap -w filtered.pcap -Y 'ip.addr == 1.2.3.4'                                 # 按显示过滤导出子集（display filter 语法，`host` 是 BPF 捕获语法不适用）
   capinfos out.pcap                                                                           # pcap 元信息：包数/时长/是否截断
   ```
   - Field names are whatever `tshark -G fields | grep <keyword>` confirms — a wrong name makes tshark report "Some fields aren't valid" immediately; it does not fail silently
   - Record the statistics (session count, protocol mix, unusual connections) in the analysis notes; they are the input to step 1 of [[re-proto-rev]]
   - For interactive work (Follow TCP Stream, jumping through protocol decodes) open the same pcap in the Wireshark GUI

4. **HTTPS decryption setup (mitmproxy CA)**:
   ```sh
   mitmproxy -p 8080 --mode transparent        # 透明模式（配合步骤 5 的 nat REDIRECT 引流）
   # 或
   mitmproxy --set console_eventlog_verbosity=error --listen-port 8080 --mode regular   # 常规代理模式
   ```
   - The first run writes the CA to `~/.mitmproxy/mitmproxy-ca-cert.pem`; install that CA into the target system or process trust store (inside the sandbox: `cp mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/ && update-ca-certificates`)
   - Check: the target process visits an HTTPS site and the mitmproxy UI shows a plaintext request (if it does not, the certificate is untrusted or the traffic was never redirected — see pitfall 2)
   - When the target process needs a proxy: set the `HTTP_PROXY` / `HTTPS_PROXY` environment variables or the system proxy; processes that ignore proxies use transparent mode

5. **Isolated capture inside the sandbox ([[re-sandbox]] network isolation)**:
   - Prerequisite: follow step 2 of [[re-sandbox]] and apply **default-deny egress** — allow only the analysis infrastructure (INetSim / proxy / capture host) on a whitelist, and drop every other outbound flow. **Do not use the mental model of "pick one of cut the network / fake DNS / INetSim"**; the three do not solve the same problem:
     - **Network fully cut** (Host-only / `--net=none`): the sample cannot call home at all — **a pure cut cannot capture C2**
     - **fake DNS** (/etc/hosts or dnsmasq): only affects name resolution, **and does not stop C2 that uses a hardcoded IP**
     - **INetSim**: simulates services, but if it is not "default deny + allow only this", the sample can still connect straight to the real network
     - Correct shape: **default deny + whitelist to INetSim** (adjust the example to the real subnets):
       ```sh
       sudo iptables -P FORWARD DROP                        # 默认拒绝转发（或等价的路由/防火墙策略）
       sudo iptables -A FORWARD -d <INetSim_IP> -j ACCEPT   # 只放行到分析基础设施
       sudo iptables -A FORWARD -s <INetSim_IP> -j ACCEPT
       ```
   - Capture point: capture everything on the INetSim host side (`tcpdump -i eth0 -w c2.pcap`) so both the sample request and the simulated response are present — the standard C2-analysis setup
   - Check: **verify the three paths independently, and `ping fails` is not evidence for any of them** (ICMP and TCP/UDP are different paths; allowing or blocking them separately is normal):
     - **TCP egress**: from inside the sandbox, `nc -zv <external-ip> 443` must fail
     - **UDP egress**: from inside the sandbox, `nc -zuv <external-ip> 53` must fail (UDP is the path most often left untested)
     - **Hardcoded-IP direct connect**: connect to an external IP with no DNS involved; it must still fail (this is the case "fake DNS does not stop hardcoded C2")
   - Also confirm: the sample's callback inside the sandbox is logged by INetSim, and the pcap contains the matching traffic (the top rule in [[re-analyze/platform-tips]])
   - When a transparent proxy (mitmproxy) is required, steer traffic to its listen port with nat REDIRECT (mitmproxy does not consume the NFQUEUE queue):
     ```sh
     sudo sysctl -w net.ipv4.ip_forward=1
     # 明文 HTTP 与 TLS 两条都要引——只写 80 是最常见的失误：目标访问 443 时根本不会进入 mitmproxy
     sudo iptables -t nat -I PREROUTING -p tcp -m multiport --dports 80,443 -j REDIRECT --to-port 8080   # 网关入口
     sudo iptables -t nat -I OUTPUT     -p tcp -m multiport --dports 80,443 -j REDIRECT --to-port 8080   # 本机出站（按需）
     # 样本可能使用非标准 TLS 端口（8443 等）或纯明文的其它端口——按实际观测补齐，或直接对全部 TCP 引流
     ```
     mitmproxy listens on 8080 in transparent mode and takes the redirected flow; after analysis, remove the nat rules and restore ip_forward
   - NFQUEUE is only for a userspace handler that explicitly binds it (for example python `netfilterqueue` returning a verdict per packet); with no handler the traffic stalls:
     ```sh
     sudo iptables -I FORWARD -j NFQUEUE --queue-num 1      # 转发链
     sudo iptables -I OUTPUT -j NFQUEUE --queue-num 1       # 本机出站（按需）
     ```
     After analysis, delete both the FORWARD rule and the OUTPUT rule

## Cross-domain handoff

- [[re-protocol]]: this skill is step 1 of that workflow (capture) — the raw-material entry for every protocol analysis
- [[re-malware]]: C2 callback capture — the capture stage of step 4 in the re-malware workflow, together with the [[re-sandbox]] INetSim / fake-DNS environment
- [[re-firmware]]: firmware communication capture — capture on the virtual NIC of the emulation environment (after [[re-fw-emulate]] starts, capture on this host)
- [[re-sandbox]]: network isolation is the prerequisite for capture (INetSim / fake DNS / cut the network), to prevent a real outbound connection (the top rule in [[re-analyze/platform-tips]])
- Capture products are consumed by [[re-proto-rev]] (plaintext) and [[re-crypto-decrypt]] (ciphertext)

## Pitfalls

- **Sandbox network is not isolated → a real outbound connection**: symptom — the sample really reached an external C2, so both the behavior and the traffic are untrustworthy; cause — [[re-sandbox]] network isolation was skipped and the sample ran on the network (NAT allows egress by default), **or only one of "cut the network / fake DNS / INetSim" was done and treated as finished isolation** (the three are not equivalent: a pure cut cannot capture C2, and fake DNS does not stop a hardcoded IP); fix — before capture, put **default-deny egress + a whitelist to the analysis infrastructure** in place, and verify **separately** that TCP, UDP, and a hardcoded-IP direct connect all fail — **testing only `ping` is not a conclusion** (ICMP and TCP/UDP are different paths)
- **TLS/HTTPS capture shows only ciphertext**: symptom — the pcap is nothing but TLS handshakes and encrypted records, with no plaintext protocol content; cause — there is no man-in-the-middle, so both ends of the TLS session are encrypted; fix — step 4, put mitmproxy in transparent or regular proxy mode, make the target trust the mitmproxy CA, then capture again; the UI should show plaintext
- **A bad filter expression drops the key flow**: symptom — after a long capture the pcap has no target traffic (for example filtered only by IP and not by port, or `and`/`or` precedence was wrong); cause — the BPF combination is wrong and was never checked on screen first; fix — omit `-w` and run for a few seconds on screen until the hit matches the target (IP, port, and direction all correct), then write the file
- **A huge capture file freezes analysis**: symptom — a full-capture pcap is tens of GB and tshark statistics or export hang; cause — the file was written without filtering first (step 2 is filter, then save); fix — BPF filter + `-c` to cap the packet count + `-s` to cap the capture length, shrink the scope with session statistics, then export a subset (step 3)
- **DoH/DoT callbacks hide the query contents**: symptom — fake DNS / INetSim logs show zero queries, and the pcap only has ciphertext flows to dns.google / cloudflare-dns.com on 443 (DoH) or 853 (DoT/DoQ), so the callback domain clue is gone; cause — the sample implements its own DNS client and talks straight to an encrypted resolver, bypassing the system resolver — DNS-layer monitoring never sees the query, and the contents are TLS-encrypted; fix — treat "a known DoH endpoint + a TLS handshake with no SNI + a non-browser process connecting straight to a DoH resolver" as a C2 signal to capture (DoT/DoQ on port 853 can be cut directly by the firewall; DoH can only be handled by redirecting the endpoint IP or by a mitmproxy man-in-the-middle on 443), and fill the missing content with beacon-interval analysis. Locating the callback from "query contents" alone does not hold in this case
- Command-family lookup and operation sequences are in [[commands]]; tool-specific pitfalls and version differences are in [[gotchas]]

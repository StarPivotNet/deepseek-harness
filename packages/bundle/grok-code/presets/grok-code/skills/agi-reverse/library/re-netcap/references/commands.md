# tcpdump / tshark / mitmproxy command lookup and operation sequences

Tool split: tcpdump (capture + BPF capture filter) → tshark/capinfos (pcap analysis and export) → mitmproxy (TLS man-in-the-middle). Always confirm field names with `tshark -G fields | grep <keyword>`; display-filter syntax moves with the version (4.x changes are in [[gotchas]]).

## Command families

### tcpdump — capture (BPF capture filter, applied in the kernel)

| Purpose | Command |
|---|---|
| List interfaces | `tcpdump -D` / `dumpcap -D` |
| Capture by IP | `sudo tcpdump -i eth0 host 1.2.3.4 -w out.pcap` |
| Capture by port | `sudo tcpdump -i eth0 port 443 -w out.pcap` |
| Combine and exclude | `sudo tcpdump -i eth0 '(host A or host B) and not port 53'` (quote the parentheses in the shell) |
| Cap the packet count | `-c 500` |
| Disable reverse lookup | `-n` (`-nn` also skips port service names) |
| Limit capture length | `-s 200` (default snaplen is 262144, the full packet) |
| Rotate files | `-C 100 -W 10` (100MB × 10 files); `-G 60 -w out-%H%M%S.pcap` (split by seconds) |
| Read offline | `tcpdump -r out.pcap -n -c 20` |
| Capture loopback | `-i lo` (local self-connections must pass here) |
| Capture every interface | `-i any` (use this first when several NICs are in play) |

### tshark — analysis / export (display filter, applied in userspace)

| Purpose | Command |
|---|---|
| Export fields | `tshark -r f.pcap -T fields -e ip.src -e ip.dst -e tcp.dstport` |
| Display filter | `-Y '<filter>'` (for example `ip.addr == 1.2.3.4`, `tcp.port == 8080`, `dns.qry.name contains "evil"`) |
| Session statistics | `-q -z conv,tcp` (`conv,ip` groups by IP pair) |
| Protocol hierarchy | `-q -z io,phs` |
| HTTP request list | `-Y 'http.request' -T fields -e http.host -e http.request.uri` |
| SNI list | `-Y 'tls.handshake.type == 1' -T fields -e tls.handshake.extensions_server_name` |
| DNS query names | `-Y dns -T fields -e dns.qry.name` |
| JSON output | `-T json -e ip.src -e dns.qry.name -Y dns \| jq .` (for a script to consume) |
| Export a subset pcap | `-w sub.pcap -Y '<display filter>'` |
| Confirm a field name | `tshark -G fields \| grep -P '\t<field-name>\t'` |

### capinfos / mergecap / editcap — pcap management (same family)

| Purpose | Command |
|---|---|
| pcap metadata | `capinfos f.pcap` (packet count / duration / timestamp range / truncation flag) |
| Merge | `mergecap -w all.pcap a.pcap b.pcap` |
| Split | `editcap -c 100000 big.pcap split` (one file per 100,000 packets) |
| Rewrite timestamps | `editcap -t +2 f.pcap out.pcap` (drift correction) |

### mitmproxy — TLS man-in-the-middle

| Purpose | Command |
|---|---|
| Regular proxy | `mitmproxy --listen-port 8080 --mode regular` |
| Transparent proxy | `mitmproxy -p 8080 --mode transparent` (pair with nat REDIRECT steering) |
| Scripted | `mitmdump -s script.py` (Python addon: log or rewrite requests) |
| Browser UI | `mitmweb` (watch the live flow in a browser) |

### NFQUEUE — kernel packet intercept / forward point

```sh
sudo iptables -I FORWARD -j NFQUEUE --queue-num 1     # 转发链
sudo iptables -I OUTPUT -j NFQUEUE --queue-num 1      # 本机出站（按需）
# 用户态 handler（python NetfilterQueue）逐包 verdict；无 handler 时流量阻塞
# 用完必须同时删除两条规则；TLS 中间人走 nat REDIRECT，不经 NFQUEUE（两套规则会互相干扰）
```

## Common sequences

### 1. C2 callback capture inside the sandbox (isolate → capture → check)

```
[[re-sandbox]] 网络隔离（INetSim / fake DNS / 断网）就绪
→ 抓包点：INetSim 主机或沙箱虚拟网卡，tcpdump -i eth0 -w c2.pcap
→ 运行样本（沙箱内）→ 验证 ping 8.8.8.8 不通、INetSim 有查询日志、pcap 有流量
→ tshark -q -z conv,tcp -z io,phs 出会话与协议分布 → 记入分析笔记
```

### 2. HTTPS plaintext decryption (mitmproxy CA + transparent steering)

```
mitmproxy -p 8080 --mode transparent（首次生成 ~/.mitmproxy/mitmproxy-ca-cert.pem）
→ 沙箱内把 CA 装入信任库（cp ... && update-ca-certificates）
→ sysctl net.ipv4.ip_forward=1 + iptables -t nat PREROUTING/OUTPUT REDIRECT --to-port 8080
→ 运行目标 → 界面出现明文请求；未出现 = 证书未信任或流量没引过来
→ 分析完清理 nat 规则并还原 ip_forward
```

### 3. Large-pcap triage (statistics first, then a subset)

```
capinfos 看规模 → tshark -q -z conv,tcp 会话表 → -q -z io,phs 协议分布
→ 按目标会话导出子集：tshark -w sub.pcap -Y 'ip.addr == X'
→ 子集上 -T fields 提取 URL/SNI/长度 → 喂给 [[re-proto-rev]]
```

### 4. Protocol-reversing raw export (fields → structured)

```
tshark -r f.pcap -Y '<协议过滤>' -T fields -e <字段> -E header=y -E separator=, > flows.csv
# 自定义协议逐层确认字段名（-G fields 查证），或 -T json 全量输出给 jq 提取
```

## Lessons (internalized)

- A capture filter (`-f`/BPF) drops non-matching packets in the kernel; a missed packet cannot be recovered. A display filter (`-Y`) leaves the pcap intact — capture wide, analyze narrow
- Field names are a hard constraint: a wrong name reports "Some fields aren't valid" or returns no value — look them up with `-G fields`, do not trust memory
- Statistics conclusions come straight from `-q -z`; do not hand-aggregate `-T fields`
- A man-in-the-middle changes traffic features (TLS fingerprint / certificate / timing). A target that checks the TLS fingerprint will notice (see [[re-tls]])
- Screen first, then write the file: before `-w`, run a few seconds without `-w` and confirm the filter hits

## Notes

- Run everything inside the sandbox (the top rule in [[re-analyze/platform-tips]]); confirm network isolation is ready before capture
- File the products (pcap path + sha256) (the [[re-triage]] habit); write conclusions into [[re-analyze/analysis-contract]]
- Version-specific behavior (display-filter syntax, field names) follows the Wireshark version on this machine (see [[gotchas]])

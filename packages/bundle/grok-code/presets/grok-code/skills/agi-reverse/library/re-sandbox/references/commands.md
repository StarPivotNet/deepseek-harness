# Sandbox setup command lookup and operation sequences

Tools are grouped by isolation level: firejail (lightweight userspace), docker (container), VirtualBox/VMware (virtual machine + snapshot), INetSim (network simulation). Commands and flags follow the official docs (firejail man, docker docs, the VBoxManage manual, the INetSim manual).

## Command families

### firejail (lightweight userspace isolation)

- `firejail <program>` runs in the default sandbox; `firejail --private <program>` uses a temporary home/root (discarded on exit)
- `firejail --net=none <program>` cuts the network (loopback only); `firejail --dns=127.0.0.1 <program>` points DNS at this machine
- `firejail --private-etc=hosts,resolv.conf <program>` brings only the named /etc files into the sandbox
- `firejail --list` lists active sandboxes (`PID:USER:Name:Command`); `firejail --tree` is the tree view
- `firejail --shutdown=<name|pid>` shuts down one sandbox — there is no `--clean` option (0.9.80 measured: invalid option)
- `firejail --version` to check; `--help` for the full flag list

### docker (container isolation)

- `docker pull ubuntu:22.04` / `docker run --rm -it ubuntu:22.04 bash` for a one-shot container
- `docker run --rm -d --network none --name sand <image>` for a background container with no network (`--network none` has no NIC)
- `docker cp <sample> sand:/tmp/` copies in; `docker cp sand:/out/ ./out/` copies products out
- `docker commit <container> sandbox-image:v1` commits a running container as an image (a snapshot stand-in)
- `docker rm -f <container>` destroys the container; `docker images` / `docker ps -a` lists them
- Check: `docker --version`; `docker run --rm hello-world` completes

### VirtualBox (VM + snapshot)

- `VBoxManage list vms` lists VMs; `VBoxManage startvm <vm> --type headless` starts headless
- `VBoxManage snapshot <vm> take clean` takes a snapshot; `VBoxManage snapshot <vm> restore clean` restores it
- `VBoxManage snapshot <vm> list` lists snapshots; `VBoxManage modifyvm <vm> --nic1 hostonly` switches NIC 1 to Host-only
- `VBoxManage guestcontrol <vm> run --exe /bin/ls --username <u> --password <p>` runs inside the guest (needs Guest Additions)
- `VBoxManage sharedfolder add <vm> --name in --hostpath <path> --readonly` is a read-only share (the inbound channel)
- Check: `VBoxManage --version`

### VMware Workstation (vmrun)

- `vmrun start <vmx> nogui`; `vmrun snapshot <vx path> clean` takes a snapshot
- `vmrun revertToSnapshot <vx> clean` restores; `vmrun list` lists running VMs
- Check: `vmrun list`

### INetSim (network simulation)

- `inetsim` starts with the default config (HTTP/SMTP/DNS/FTP and the rest, all simulated); `inetsim --session <name>` names the session
- `inetsim --version` to check; logs are in `/var/log/inetsim/` (reports in `/var/log/inetsim/report/`)
- Config: `/etc/inetsim/inetsim.conf` (bind address, which services start)

### Network-isolation checks

- `ping 8.8.8.8` (a cut network must fail); `curl http://example.com` (must hit the INetSim simulated response)
- `dig @127.0.0.1 example.com` (fake-DNS answer); `ss -tlnp` shows listeners inside the sandbox

## Common sequences

### 1. VM snapshot analysis loop (snapshot → isolate → copy the sample → run → restore)

```
VBoxManage snapshot <vm> take clean                 # 干净基线
VBoxManage startvm <vm> --type headless
# 网络隔离（Host-only + INetSim）→ 只读共享传入样本（sha256 先存证）
# 沙箱内运行样本、观察行为、导出产物到专用输出目录
VBoxManage snapshot <vm> restore clean              # 分析完恢复
VBoxManage snapshot <vm> list                       # 确认回到 clean
```

### 2. firejail quick isolation (lightweight case)

```
firejail --private --net=none --dns=127.0.0.1 ./sample
# 断网 + 临时 home；退出后临时目录自动清理
firejail --list                                     # 确认沙箱状态
firejail --shutdown=<name|pid>                      # 需要时按名关停
```

### 3. Docker container analysis loop (quick test of a low-risk sample)

```
docker run --rm -d --network none --name sand ubuntu:22.04 sleep 3600
docker cp ./sample sand:/tmp/
docker exec sand /tmp/sample                        # 容器内运行（无网）
docker cp sand:/tmp/out ./out/                      # 取出产物
docker rm -f sand
```

### 4. INetSim fake network (the standard C2-observation setup)

```
inetsim --session c2obs                              # 沙箱宿主起模拟服务
# 沙箱 VM DNS 指向宿主 INetSim（Host-only 网段 IP）
# 样本外连被模拟服务接管并记录全部请求 → 配合 [[re-netcap]] 抓包
curl http://example.com                              # 验证命中模拟响应
# 日志与报告在 /var/log/inetsim/ 取回存档
```

## Lessons (internalized)

- Integrity, high to low: VM snapshot > container > firejail — pick the tier from the sample's threat level, and write the decision and the reason into the record (step 1 of SKILL.md)
- Set the network-isolation tier before the run: cut the network / fake DNS / INetSim — run the check commands (where ping/curl land) before the sample goes in
- In and out use dedicated channels: a read-only share in, a dedicated output directory out, and the sample and the products are stored apart (sha256 on both ends)
- Restoring the snapshot is part of the analysis: write the restore command in step 1, run it immediately after analysis, and confirm there are no leftovers (pitfall 1 of SKILL.md)
- In an INetSim environment both DNS resolution and the HTTP service point at the same host, so every sample request lands locally — compare the capture with the log to recover C2 behavior

## Notes

- This skill carries out the top rule in [[re-analyze/platform-tips]] (default sandbox) — dynamic analysis always passes through here first
- A high-threat sample uses a VM snapshot, not a container or firejail (shared-kernel surface and isolation depth; pitfall 3 of SKILL.md)
- Time / hardware / input environment fingerprints are a separate problem: isolation ≠ disguise. Detection-point responses are in [[re-evasion]] (pitfalls 6-8 of SKILL.md)

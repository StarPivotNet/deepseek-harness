---
name: re-sandbox
description: >
  Sandbox setup (a required prerequisite for dynamic analysis).
  Triggers: `沙箱`, `隔离环境`, firejail, `VM快照`, `安全运行`
capabilities: [sandbox-setup]
---

# Sandbox setup

## When to use / when not to use

- Use: any dynamic analysis that runs a sample (behavior analysis, callback watching, unpack verification, dynamic API monitoring) — a sandbox is a required prerequisite for dynamic analysis, and the default sandbox is the top rule (see [[re-analyze/platform-tips]])
- Use: a clean, rollback-able isolated environment is needed to run an untrusted program
- Do not use: pure static analysis ([[re-triage]] / [[re-format-pe]] / [[re-ghidra]] and the rest) may skip the sandbox
- Do not use: the sample already has a trusted runtime and the user explicitly asked to run it on this machine (still state the risk first)

## Tool setup

Verify every tool before use. This skill is what carries out the top rule in [[re-analyze/platform-tips]] (default sandbox; dynamic execution has a required prerequisite) — every tool exists to make "run the sample" safer and more controllable.

### firejail — lightweight application sandbox (lowest isolation level, Linux only)

- Linux: `apt install firejail` / `dnf install firejail` / `pacman -S firejail`
- macOS/Windows: not supported (use Docker or a VM instead)
- WSL: the Linux package works directly
- Check: `firejail --version`; `firejail --list` shows active sandboxes
- Note: firejail is userspace isolation (a namespace/seccomp combination), not a security boundary — it does not stop a kernel exploit or privilege escalation. A high-threat sample still uses a VM (see pitfall 3). Common flags: `--private` (a temporary home, discarded on exit), `--net=none` (cut the network), `--dns=<ip>` (where DNS points)

### docker — container isolation (middle tier)

- Linux: `apt install docker.io` / `dnf install docker` / `pacman -S docker` (or the official Docker script)
- macOS: `brew install --cask docker` (Docker Desktop; start it by hand) or `brew install docker` + `brew install colima` + `colima start`
- Windows: `choco install docker-desktop` (Docker Desktop); the Linux build inside WSL2
- Check: `docker --version`; `docker run --rm hello-world` completes
- Note: a container shares the kernel. It is not full isolation (see pitfall 3)

### VirtualBox / VMware — virtual machine + snapshot (highest isolation level)

- VirtualBox:
  - Linux: `apt install virtualbox` / `dnf install VirtualBox` (RPMFusion) / `pacman -S virtualbox`
  - macOS: `brew install --cask virtualbox`
  - Windows: `choco install virtualbox`
  - Check: `VBoxManage --version`
- VMware Workstation/Fusion: commercial license; Windows `choco install vmware-workstation`; check: `vmrun list` or `vmware --version`
- Snapshot commands (VBoxManage example):
  ```sh
  VBoxManage snapshot <vm> take clean      # 建立快照
  VBoxManage snapshot <vm> restore clean   # 恢复快照
  ```

### INetSim — simulated network services (the network-isolation workhorse)

- Linux: Debian/Ubuntu `apt install inetsim` (or the official .deb; other distros build from source. The Perl dependencies are heavy, so a dedicated Debian VM is preferred)
- macOS/Windows: do not install it on the host — run it inside a Linux VM
- Check: `inetsim --version`; after start, the `inetsim` log shows HTTP/SMTP/DNS/FTP and the other services listening

### Cuckoo / CAPE — automated malware-analysis sandboxes

- Cuckoo (old, still usable): `pip install cuckoo`; check: `cuckoo --version`
- CAPE (the active successor):
  ```sh
  git clone https://github.com/kevoreilly/CAPEv2
  cd CAPEv2 && pip install -r requirements.txt
  ```
  Check: `python cuckoo.py --help`, or the `cape` subcommand lists
- They depend on a VM and a network-isolation setup, and the first build is expensive — a one-off manual analysis prefers the VM snapshot plan

## Steps

Run in order and record each result.

1. **Pick the isolation level** (integrity, high to low: VM snapshot > container > firejail):
   - **The middle and low tiers apply only to a sample already known to be low risk**: a container and firejail **share the host kernel** — as soon as the sample has a kernel attack surface (privilege escalation, a kernel exploit, a driver or kernel-module payload), those two tiers are not an isolation boundary. **The default host for an unknown or high-threat sample is a VM snapshot.** Treating a container as the "fallback isolation layer" for ordinary malware is a common tier mistake
   - VM snapshot (VirtualBox/VMware): full restore is required, plus blocking outbound connections and escape. The default choice for an unknown high-threat sample
   - Container (Docker): a quick test of a Linux binary, or a low-risk sample
   - firejail: only the filesystem and the network need limiting, for a short run
   - Decision record: write down the chosen level and why, and write the "restore the snapshot after analysis" command (step 5) in advance

2. **Network isolation** (three tiers, strong to weak):
   - Cut the network: set the VM network mode to Host-only / Internal (NAT allows outbound connections by default and cannot be used as a cut); firejail uses `--net=none`
   - fake DNS: /etc/hosts or dnsmasq points suspicious names at this machine; or `firejail --dns=127.0.0.1`
   - INetSim: point the sandbox DNS at the INetSim host. It simulates HTTP/SMTP/FTP/DNS and logs every request the sample makes — the standard C2-analysis setup (together with [[re-netcap]] from [[re-protocol]])
   - Check: inside the sandbox, `ping 8.8.8.8` fails; `curl http://example.com` hits the INetSim simulated response

3. **Take the snapshot**:
   ```sh
   # VirtualBox
   VBoxManage snapshot <vm> take clean
   # VMware
   vmrun snapshot <vm> clean
   # Docker: 提交运行中容器为镜像
   docker commit <container> sandbox-image:v1
   # firejail 无快照概念——靠 --private/--private-etc 临时目录，退出即清理
   ```
   The snapshot contains at least: a clean OS + analysis tools (procmon / sysdig / bpftrace) + the network-isolation configuration.

4. **Move the sample in and out (an isolated channel)**:
   - In: a read-only shared directory. Disable clipboard and drag-and-drop sharing in the VM (so the sample cannot read the host back). Or scan with antivirus before copying in
   - Out: products (logs / memory dumps / config) leave through a dedicated output directory and are stored apart from the sample
   - Before copying in, `sha256sum` the original sample and archive it (see [[re-triage]]). Keep one original hash on the host and one inside the sandbox
   - Disable Guest Additions clipboard / drag-and-drop sharing, and open only a Host-only network — the counter to VM-escape detection is in pitfall 4

5. **Restore the snapshot after analysis**:
   ```sh
   VBoxManage snapshot <vm> restore clean
   # Docker
   docker rm -f <container>
   # firejail——没有 --clean 选项（0.9.80 实测报 invalid option），按名/PID 关停：
   firejail --shutdown=<name|pid>   # 沙箱名/pid 用 `firejail --list` 查
   # 或直接退出 firejail 进程，--private 临时目录退出自动清理
   ```
   After restore, check: `VBoxManage snapshot <vm> list` confirms the return to clean; `ps aux` inside the sandbox shows no leftover process. Not restoring the snapshot means a contaminated environment (see pitfall 1).

## Cross-domain handoff

- [[re-malware]]: step 1 of this gateway's workflow is a required prerequisite — the default sandbox is the top rule ([[re-analyze/platform-tips]]). Every dynamic malware analysis starts here
- [[re-anti-analysis]]: dynamic verification of an unpacked product must be re-run inside the sandbox (to decide whether the packer is fully gone)
- [[re-protocol]]: C2 traffic capture depends on this skill's INetSim / fake-DNS isolated network
- [[re-binary-core]]: its dynamic stages ([[re-tracing]] / [[re-gdb]] / [[re-x64dbg]] / [[re-memdump]]) cite this skill as the runtime prerequisite
- [[re-evasion]]: the opposing surface when a sample detects a sandbox or VM (escape and anti-sandbox) — locate and bypass the detection points in that domain

## Pitfalls

- **Forgetting to restore the snapshot contaminates the environment**: symptom — the next analysis finds leftovers from the previous sample (processes / files / registry), and the two results pollute each other; cause — the snapshot was taken and never restored, so the sample's persistence stayed in the sandbox; fix — write the restore command in step 1, run it immediately after analysis, and confirm there is no leftover process
- **The network was not isolated and the sample called out**: symptom — the sample really reached an external C2 or kept spreading; cause — network isolation was skipped and it ran on the network; fix — before any run, isolate with one of the three tiers in step 2, and verify where ping/curl land
- **A shared kernel is not full isolation**: symptom — the sample uses a kernel bug or changes a global setting such as sysctl and affects the host; cause — Docker shares the kernel with the host and isolates only with namespaces/cgroups; fix — a high-threat sample uses a VM snapshot, not a container. A container is only for a low-risk quick test
- **The sample detects the VM and escapes the analysis**: symptom — the sample sees VM features (Guest Additions, a vmware process, a virtual NIC name) and then sleeps or exits, so behavior analysis gets nothing; cause — anti-analysis (see the [[re-anti-analysis]] domain); fix — disable Guest Additions, change the virtual hardware fingerprint, and extend observation together with the delay / interaction checks in [[re-behavior]]
- **Time detection (RDTSC / accelerated Sleep)**: symptom — the sample sleeps 30 seconds and then exits, or behaves oddly, or an RDTSC timing check finds that "the time is wrong"; cause — sandboxes often hook or accelerate timing APIs (Sleep/GetTickCount). The sample uses RDTSC (with CPUID forcing a VM exit), compares `Sleep` with `GetTickCount`, or uses `GetSystemTimeAdjustment` and similar to notice the anomaly; fix — identify the time-check site (xref RDTSC/GetTickCount/NtDelayExecution). Keep a real clock in the sandbox, or patch the check and continue (the [[re-anti-analysis]] domain). When a long wait is required, wait for real, do not accelerate the clock
- **Environment-name and resource-threshold detection**: symptom — the sample does not trigger malicious behavior under a `sample.exe` / `malware` directory, and renaming or changing resources changes the behavior a lot; cause — it checks analysis file names and paths, CPU-core / memory / disk-size thresholds, and missing mouse and keyboard interaction (ATT&CK T1497.001); fix — normalize the sample name (avoid the words sample / sandbox / malware), give the sandbox enough resources (≥2 cores, ≥2GB RAM, a normal disk size), and pair interaction simulation (mouse movement) with the delayed observation in [[re-behavior]]
- **Sandbox isolation is not environment disguise**: symptom — the sample runs safely inside the isolated environment, but still changes behavior because of time / hardware / input environment fingerprints; cause — isolation is not disguise. Time, hardware, and input checks are environment fingerprints, and a full VM can still be detected; fix — treat "isolation" and "environment disguise" separately. Locate each detection point by fingerprint class (time / hardware / input) and answer that class (the [[re-anti-analysis]] domain). See the sandbox branch of [[re-analyze/platform-tips]]
- **Simple interaction simulation is caught by a statistical check**: symptom — mouse movement and input events were simulated, and the sample still decides "not a human" and does not trigger the payload; cause — newer samples such as Rhadamanthys check interaction statistically: 1500 samples of cursor / foreground window / timestamp at 30ms, requiring the cursor to move ≥30 times and ≥2 different foreground windows (one of them not a desktop process), then Euclidean distance on the cursor path to tell a "non-human" movement pattern, with an observation window of 45s or more; fix — simulate a human distribution (random intervals, a non-linear path, real window switches) rather than a fixed pixel move. Satisfy the sample's sample parameters one by one (cursor / foreground window / timestamp) and stretch the observation window (CAPE/VMRay already include interaction simulation at this level)
- **The firejail cleanup flag is a copied myth (`--clean` does not exist)**: symptom — following an old document, `firejail --clean` reports `invalid --clean command line option`; cause — the official man page (since 0.9.72) and a 0.9.80 measurement both have no such option. Tutorials copied it from each other; fix — `firejail --list` for the name/pid, then `firejail --shutdown=<name|pid>`. A temporary directory is cleaned on exit by `--private`
- **The sample executes through a whitelisted process (brokered execution)**: symptom — inside the sandbox the sample's own process looks almost clean, and the malicious actions all happen in rundll32/mshta/PowerShell/WMI and similar processes; cause — the sample outsources sensitive actions to an already-allowed process through IPC (ALPC/RPC/COM/named pipes) or a LOLBin. Watching only the sample process misses the real behavior; fix — watch "the whole process chain the sample spawned" (parent → subtree, correlated with Sysmon event 1 process creation). Filter procmon/sysdig by the root process, not a single process. Kernel side (ETW/bpftrace) covers the userspace monitoring blind spot

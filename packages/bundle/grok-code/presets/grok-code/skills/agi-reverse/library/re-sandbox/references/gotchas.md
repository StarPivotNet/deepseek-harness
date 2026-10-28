# Sandbox-tool pitfalls and limits

## Network isolation

- **NAT is not a cut network**: a VM's default NAT allows outbound connections — a cut must be an explicit Host-only/Internal (or `--net=none`), and `ping 8.8.8.8` must fail (pitfall 2 of SKILL.md)
- **fake DNS only hijacks resolution**: it does nothing when the sample connects by IP or uses a hardcoded IP — pin the target port with a firewall or INetSim, or watch where the connection lands
- **INetSim only simulates common services**: a port that is not in the INetSim service table fails the connection (TCP RST) — see which port the sample wants first (static [[re-netcap]] / a dynamic capture) and add a simulated service if needed. When DNS points at the wrong place the sample waits silently until timeout; verify the `curl` landing before the sample goes in
- **systemd-resolved conflicts with `--dns`**: the firejail man page says `--dns` is unsupported under systemd-resolved — on that setup use `--net=none` or a separate DNS inside the VM

## Snapshots and rollback

- **Taking a snapshot and never restoring it contaminates the environment**: leftover persistence (processes / files / registry) pollutes the next analysis — write the restore command in advance, run it immediately after analysis, and confirm there are no leftovers (pitfall 1 of SKILL.md)
- **The snapshot was taken after the sample ran**: the baseline was forgotten, and the sample had already changed the system — the baseline snapshot must predate any sample run. A snapshot taken mid-way contains a contaminated state and is not a clean baseline
- **VBoxManage behavior vs the VirtualBox version**: `snapshot take/restore` syntax has been stable for a long time, but newer releases changed headless/guestcontrol — an automation script checks `VBoxManage --version` first. On the VMware side, `vmrun` compatibility follows the official docs

## Containers

- **A shared kernel is not full isolation**: Docker shares the kernel with the host, so a kernel exploit or a global sysctl affects the host — a high-threat sample uses a VM snapshot, and a container is only for a low-risk quick test (pitfall 3 of SKILL.md)
- **`docker cp` still works after `--network none`**: cutting the network only affects the container network stack. `docker cp` / `docker exec` go through the daemon channel and are unaffected — isolation and file exchange do not conflict
- **An image still carries sample residue**: the container is gone, but an image produced by commit still has sample traces — `docker rmi` the image after analysis. Before reusing a baseline image, pull a clean layer again

## firejail

- **`--clean` does not exist**: 0.9.80 measured `invalid --clean command line option`, and the official man page (since 0.9.72) has no such option — clean up with `firejail --list` + `firejail --shutdown=<name|pid>` (the "copied cleanup flag" pitfall in SKILL.md)
- **Userspace isolation is not a security boundary**: firejail is a namespace/seccomp combination — it does not stop a kernel exploit or privilege escalation (the userspace escape surface remains under `--net=none`). A high-threat sample uses a VM. `--net=none` can crash an application on some platforms (the man page says so); the fallback is `--protocol=unix`
- **`--private` only isolates the home/root paths**: /etc outside `--private-etc` is still globally readable — allowlist sensitive config first with `--private-etc=hosts,resolv.conf` and similar
- **firejail has a detection surface**: a sample can look for sandbox features (firejail environment variables / mount features) — same idea as VM-escape detection. After identification, respond as in [[re-evasion]]

## Environment fingerprints (isolation ≠ disguise)

- **Isolation and disguise are two problems**: isolation stops the sample from calling out or contaminating the host; disguise stops the sample from refusing to trigger because of an environment fingerprint — time (RDTSC/GetTickCount), hardware (core count / memory), and interaction (mouse / window) checks each need their own response (pitfalls 6-8 of SKILL.md)
- **Names and resource thresholds**: a `sample.exe` / `malware` directory name, CPU/memory/disk thresholds, and missing interaction all trigger T1497.001-class detection — normalize names, give enough resources, and simulate interaction from a human distribution
- **Statistical interaction checks**: newer samples discriminate mouse paths statistically (sample rate / Euclidean distance / foreground-window count) — a fixed pixel move is caught. Simulate a real behavior distribution and stretch the observation window (pitfall 8 of SKILL.md)

## Version differences

- **firejail**: the option set is stable between 0.9.72 (Debian bookworm) and 0.9.80 (measured on Arch), and `--clean` exists in neither. The `--net=none` crash warning has been there since older releases — packaged versions differ a lot across distros (0.9.6x-0.9.8x). Confirm with `firejail --version` before scripting
- **VirtualBox**: snapshot command syntax is stable across 6.x/7.x. The Guest Additions version must match the host version (a mismatch breaks the clipboard and shared folders, and it is also a VM-escape detection feature)
- **docker**: `--network none` and `docker cp` behavior have been stable for a long time. An image from commit is not a reproducible dependency (layers contain intermediate state) — rebuild the baseline from a Dockerfile instead of a commit product
- **INetSim**: the Debian package is `inetsim` (bookworm 1.3.2). The `--version` / `--session` options are stable. The log path differs slightly by distro packaging (trust `/etc/inetsim/inetsim.conf`)

## Notes

- Dynamic analysis always passes through this skill first (the top rule in [[re-analyze/platform-tips]]). Archive sha256 of the sample and the products on both ends ([[re-triage]])
- Write the analysis conclusion and the decision record (isolation level, network plan, restore check) into [[re-analyze/analysis-contract]]
- Version-specific behavior (firejail options, VM tools, the INetSim service table) follows the actual behavior of the target version

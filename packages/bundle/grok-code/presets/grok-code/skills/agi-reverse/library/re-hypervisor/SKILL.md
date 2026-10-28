---
name: re-hypervisor
description: >
  Virtualization reverse engineering: VT-x/SVM, hypervisor detection, VMCS/EPT analysis,
  and partition and vdev semantics of Xen / QNX Hypervisor / Jailhouse / ACRN / Bao / Hyper-V·VMBus / XtratuM / LynxSecure / Quest-V.
  Triggers: hypervisor, VT-x, SVM, `虚拟化检测`, EPT, Xen, grant table, event channel,
  Jailhouse, cell, ACRN, ivshmem, Bao, shmem_id, vdev, GPA/HPA,
  Hyper-V, VMBus, VSC, VSP, GPADL, SR-IOV, XtratuM, XM_CF, LynxSecure, Quest-V, sandbox kernel
capabilities: [hypervisor-analysis]
---

# Virtualization reverse engineering (VT-x / SVM / partitioning hypervisors)

<CORE RULE>
This domain has two analysis axes that are not the same. First decide which one you are on:

- **Axis A: analyze the hypervisor itself** (VT-x/SVM instructions, VMCS/VMCB, EPT/NPT) → this main document
- **Axis B: the target sits under some kind of virtualization**, and the question is "was the address / device / interrupt I see manufactured by the virtualization layer" → see [[xen]] / [[qnx-hypervisor]] / [[jailhouse]] / [[acrn]] / [[bao]]

The shared pitfall of axis B is **treating a local handle as a global identifier, and a virtual address as a physical address**:

```
a grant ref is an index into a grant-table entry   ≠ a physical address
an event-channel port is a notification port       ≠ an IRQ number
a guest BAR / GPA                                   ≠ a physical BAR / HPA
shmem_id is the shared object's identity            ≠ the mapped address inside two VMs
```
</CORE RULE>

## When to use / when not to use

- Prerequisite: **first decide which class of virtualization this is** (host vendor string / configuration format / structural evidence) → the Hypervisor section of [[re-analyze/system-fingerprints]]
- Use: the target is a hypervisor / VMM binary or driver (a malicious hypervisor, a rootkit that virtualizes, VM-based protection)
- Use: a sample / program detects whether it is running in a virtual machine or under nested virtualization (CPUID fingerprint, timing detection)
- Use: analyze startup code related to VT-x (VMX) or SVM, the VMCS/VMCB layout, and EPT-related operations
- Use: **the target runs under a partitioning / embedded hypervisor** — PV devices, static partitions, vdev, cross-VM shared memory, and virtual interrupts (see the branches below)
- Do not use: an ordinary Windows driver / rootkit (go to [[re-kernel]]); only "am I inside a VM" (a quick check follows the [[re-triage]] approach or `virt-what`)
- Do not use: dynamic verification when there is no CPU virtualization support / no nested-virtualization environment (static analysis first; see pitfall 1)
- Note: dynamic experiments (QEMU/KVM nested) follow the top rule of [[re-analyze/platform-tips]] and run inside a sandbox; a hypervisor sample is highly privileged and is run only in an experiment environment isolated from the host

## Tool preparation

Static analysis (a CPUID check / decompilation) needs no sandbox; a QEMU/KVM dynamic experiment is dynamic execution, default sandbox + snapshot (the top rule of [[re-analyze/platform-tips]]).

### CPUID check tools (hypervisor identification)

- Built into Linux: `grep -E 'vmx|svm' /proc/cpuinfo` — the VT-x/SVM support flags (zero install; use this first)
- The `cpuid` tool (dumps the full output of each CPUID leaf):
  - Debian/Ubuntu: `apt install cpuid`; Fedora: `dnf install cpuid`
  - Arch has no standalone cpuid package → use `kcpuid` (`pacman -S kcpuid`, the linux-tools group) or `cpuid_tool` shipped with libcpuid (`pacman -S libcpuid`)
  - Verify: `cpuid -1` prints each leaf's detail; `cpuid -1 -l 0x40000000` (the hypervisor vendor-string leaf)
- Windows side: `!cpuid` under WinDbg kernel debugging (an [[re-windbg]] extension command)

### QEMU / KVM — nested-virtualization experiment environment

- Debian/Ubuntu: `apt install qemu-system-x86` (**Debian 12+ removed the qemu-kvm transitional package**; installing qemu-system-x86 directly includes `qemu-system-x86_64`; Ubuntu's qemu-kvm transitional package still exists, and installing it is equivalent to qemu-system-x86; on Ubuntu also add `libvirt-daemon-system`)
- Fedora: `dnf install qemu-system-x86-core libvirt virt-install` (or `dnf group install virtualization`)
- Arch: `pacman -S qemu-system-x86 libvirt virt-manager` (enable with `systemctl enable --now libvirtd`)
- macOS: `brew install qemu` (no KVM; use HVF)
- Verify: `qemu-system-x86_64 --version`; `ls /dev/kvm` (KVM acceleration is available); `kvm-ok` (Debian/Ubuntu only, from the cpu-checker package — first `apt install cpu-checker`)

### Decompilation workbench ([[re-ghidra]] / [[re-ida]])

- [[re-ghidra]] (default) / [[re-ida]]: import the hypervisor binary (a kernel module / a raw binary)
- Verify: after import you can decompile the VMXON / VMPTRLD / VMREAD / VMWRITE call sites

### Intel SDM / AMD APM (VMCS field-encoding reference, nothing to install)

- Intel SDM Volume 3C Appendix B (the VMCS field-encoding tables); AMD APM Volume 2 (the VMCB layout)
- Use: decode VMREAD/VMWRITE operands, and look up exit-reason numbers (no separate package; official documents)

## Procedure

Execute in order. Record an evidence path + sha256 for each step's product (CPUID output, the VMCS field table, the QEMU configuration) (see [[re-triage]]), for the report to cite.

1. **Hypervisor identification (CPUID leaves / the VMX flag)**:
   ```sh
   grep -E 'vmx|svm' /proc/cpuinfo | head -1        # host CPU virtualization support
   cpuid -1 -l 0x1 | grep -i -A1 'hypervisor'        # CPUID.1:ECX[31] hypervisor present bit
   cpuid -1 -l 0x40000000                            # hypervisor vendor string in the 0x40000000 leaf
   #   "KVMKVMKVM" = KVM, "Microsoft Hv" = Hyper-V, "VMwareVMware" = VMware, "XenVMMXenVMM" = Xen
   ```
   - Detection points: the hypervisor present bit (CPUID.1:ECX[31]) → a hypervisor is present; `0x40000000` returns the vendor string (12 characters spread in order across EBX:ECX:EDX, 4 bytes each; EAX returns the maximum hypervisor leaf number)
   - A malicious sample often does this check early in startup and decides later behavior from it (ties in with [[re-evasion]]; see pitfall 5)
   - Record: host support (vmx/svm), and whether we are already inside a VM (including nested; pitfall 4)

2. **VMCS structure analysis (VT-x)**:
   - Startup path: `VMXON` (enter VMX operation) → `VMPTRLD` (load the current VMCS) → configure VMCS fields → `VMLAUNCH` / `VMRESUME` (enter the guest) → after a VM exit, dispatch on the `VM_EXIT_REASON` field
   - Locate it in the decompiler: search the `VMXON` / `VMPTRLD` / `VMWRITE` / `VMREAD` / `VMLAUNCH` instructions (Ghidra disassembly reads them directly); the VMCS region is a memory block, so first find the VMCS buffer allocation and initialization code
   - **The operand of VMREAD/VMWRITE is a VMCS field encoding** (32 bits, Intel SDM Appendix B tables B-1 through B-4): **bit0 = access type** (0=full field, 1=high 32 bits); **the index is in bits 9:1** (9 bits, not bits 9:0); the type is in bits 11:10 (00=control, 01=read-only, 10=guest-state, 11=host-state); the width is in bits 14:13 (00=16-bit, 01=64-bit, 10=32-bit, 11=natural); bit 12 and bits 31:15 are reserved (must be 0). Decode examples: 0x400C=VM-exit controls (32-bit, bits 14:13=10), 0x2000=I/O bitmap A (64-bit, bits 14:13=01), 0x681E=GUEST_RIP (natural, bits 14:13=11), 0x681C=GUEST_RSP (natural), 0x4402=VM-exit reason (32-bit read-only) — that is `access=enc&1; index=(enc>>1)&0x1ff; type=(enc>>10)&3; width=(enc>>13)&3`. Build an enum / structure annotation in Ghidra/IDA
   - Watch three blocks: guest-state (saved guest registers / CR3 / RSP), host-state (the host context after a VM exit), and control fields (execution controls decide which events cause a VM exit)
   - SVM counterpart: the VMCB (physical address through the `VM_HSAVE_PA` MSR); fields are fixed offsets — annotate them from the AMD APM layout
   - Product: a VMCS field annotation table (encoding → field name → role) + the initialization / exit-handling flow

3. **Detecting and countering virtualization techniques (EPT-hidden memory)**:
   - EPT (Extended Page Tables): a second-level page table from guest physical address to host physical address (controlled by the VMM); a malicious hypervisor can use EPT to map the same guest page to different host pages, or change page contents at the EPT layer while the guest page tables look unchanged
   - Analysis approach: in the decompilation, find EPT-related operations — use sites of `INVEPT` / `INVVPID` (TLB invalidation), assignments of the EPT pointer field (VMCS `EPTP`), and the EPT page-table construction function (walk the page-table structure from the EPT pointer)
   - How to observe the countermeasure: memory contents seen inside the guest disagree with a direct host-side read of the same physical page → evidence of EPT remapping (compare the two views); [[re-kernel]] kernel debugging dumps the same page on both the host side and the guest side
   - **The EPT-hook dual-view mechanism** (the core of a traceless hook): prepare two HPAs for the same GPA — the original page (RW/NX) and a shadow page (X-only, or the patched code) — data accesses map the original page, instruction fetch maps the shadow page; after the CPU fetch triggers an Execute Violation (VM-exit reason 48), the VM-exit handler switches to the shadow page and INVEPT invalidates the cache; a scanner / CRC reads clean bytes at the address, but execution is the patched code (traceless on the read side)
   - **Traceless INT3 through EPT**: put `0xCC` only on the shadow page; the original data page is unchanged — a memory read sees the original instruction, but fetch breaks; after the VMCS Exception Bitmap intercepts vector 3, match the address with `guest_rip - 1` (the RIP of a one-byte INT3 is after the breakpoint byte); after handling, single-step to restore and then plant the breakpoint again; a #BP that is not this framework's must be reinjected into the guest (do not swallow another debugger's / the system's breakpoint)
   - **MTF (Monitor Trap Flag) solves "read and execute the same page"**: if a shadow-page instruction reads a constant on the same page (fetch wants the shadow page, data wants the original page, and they conflict) → temporarily allow execution of the original page and set MTF; after the CPU single-steps one instruction, tighten the permissions in the MTF VM-exit; MTF is a VM-execution control, it does not touch guest RFLAGS.TF, and it does not occupy DR0-DR7
   - **EPT watch = simulating unlimited hardware breakpoints**: DR0-DR3 are only 4 slots; an EPT watch revokes the target page's R/W/X permissions so a matching access VM-exits, and the count is limited only by memory / performance; hardware-breakpoint-class needs (including interoperating with a traditional debugger, such as hooking `SetThreadContext` to see whether a hardware breakpoint was planted and then forwarding it to an EPT watch) use this instead
   - **Traceless communication through VMCALL**: the guest executing VMCALL produces VM-exit reason 18 (it does not call any address inside the guest); RAX holds a protocol identifier, RCX holds an operation number, and the other registers pass arguments. It is a private channel between the hypervisor and the guest
   - Product: the EPT build / switch code path + evidence of the memory-view difference

4. **Nested virtualization (debugging inside a VMM)**:
   ```sh
   # Enable KVM nesting (host) — module_param permission is 0444, sysfs is read-only, and an echo write fails
   sudo modprobe -r kvm_intel && sudo modprobe kvm_intel nested=1    # Intel (AMD uses kvm_amd nested=1)
   # Persist: write `options kvm_intel nested=1` in /etc/modprobe.d/kvm.conf (still in effect after reboot)
   cat /sys/module/kvm_intel/parameters/nested                       # verify (Y/1 means enabled)
   # Start a nested VM with VT-x passthrough (`-cpu host` exposes the vmx flag)
   qemu-system-x86_64 -enable-kvm -cpu host,+vmx -m 4096 disk.img &
   # Verify again inside the nested VM: grep vmx /proc/cpuinfo is visible → a hypervisor sample can run here
   ```
   - Use: a debugger on the host (gdb/lldb, or [[re-windbg]] kernel debugging) watches the hypervisor execute inside the nested VM directly — the sample believes it is at the bottom, but it is still inside the host's debug view
   - VMware / Hyper-V are the same (turn on "virtualization engine / nested virtualization" in the VM settings)
   - Product: an archive of the nested configuration + the debug-session record

5. **Bypassing anti-virtualization ([[re-evasion]] together)**:
   - Identify the detection method: the CPUID vendor string (step 1), timing (how long an RDTSC instruction takes), device names (VM virtual devices), firmware / ACPI features
   - Follow [[re-evasion]]'s "identify the evasion → locate the bypass point" frame: hook CPUID (cpuid is an **instruction**, not an exported symbol, so `findExportByName` cannot get it — instead hook the libc exports `__get_cpuid` / `__get_cpuid_max` and change the return value, or use Stalker instruction-level tracing to intercept the cpuid instruction; on the kernel side, hook / patch the instruction), forge the vendor string with QEMU `-cpu`, rename device names
   - A malicious sample that "changes behavior when it detects a VM" (it does not execute the malicious logic) is also a common countermeasure — record the detection point and the branch
   - Product: a list of detection points + a bypass plan (an authorized-research setting)

## Platform branches (references)

**Axis B**: the target is "a system running under some kind of virtualization", and the job is to decide which observations are normal mechanisms the virtualization layer manufactured.

- [[xen]] — **the PV front/back set of four** (XenStore / grant table / shared ring / event channel); **a grant ref is an entry index** (the entry holds flags/domid/frame, and **revoke is not supported while a mapping is held**); **an event-channel port is not an IRQ number** (it is bound to the `shared_info` bitmask); **after migration the local port changes, and the stable one is the remote port**; "data is flowing on the shared ring but there is no IPC call" is normal
- [[qnx-hypervisor]] — **three address layers** (guest virtual → guest physical/IPA → host physical); a **vdev** makes the guest DT ≠ the board DT; the **shmem vdev** factory page (`name` / `size` / `shmem` / `vector` / `status`; writing `size` triggers creation, so guest start order does not matter) and the control page (`status` / `idx` / `notify` / `detach`); `intr pass` vs `intr vdev`; a passthrough device allows only one resident at a time
- [[jailhouse]] — **the configuration matters more than the inmate ELF** (CPU / memory / IRQ / PCI ownership); an unauthorized access → **the CPU is parked** (not a guest crash); **a `JAILHOUSE_MEM_LOADABLE` mapping is revoked when the cell starts** (a reload goes through Cell Set Loadable); **ivshmem does not maintain pending semantics** (the MSI-X PBA is always 0; event state is read from the shared-memory protocol); scanning the hypervisor VA will not see every VM's memory
- [[acrn]] — **Service VM / pre-launched / post-launched**, three states and three I/O service paths; **a guest BAR ≠ a physical BAR** (EPT mapping; the MSI-X table pages must be trapped); posted interrupt reduces VM-exits; **ivshmem dm-land and hv-land never interconnect** (prefixes `dm:/` vs `hv:/`, and dm-land has no doorbell)
- [[bao]] — **static partitions** (CPU / memory / interrupts are exclusive, vCPU and pCPU are 1:1, no scheduler); **the shared object's identity is `shmem_id`, not an address**; IPC has `size ≤ the corresponding shmem size`; **cache coloring** suppresses interference but has a cost (large pages are sacrificed, TLB pressure rises) and is truncated to the platform's color count
- [[hyperv-vmbus]] — **VSC / VSP over VMBus** (a bidirectional channel = two ring buffers; a high-speed device can use multiple channels); **a GPADL is a buffer-descriptor handle, not an address** (the shared total has a cap); **SR-IOV changes the data-plane path mid-way** (VF passthrough bypasses VMBus and the hypervisor; the control plane stays on VMBus)
- [[xtratum]] — **driven by XM_CF** (partitions / memory / interrupts / ports / channels / schedule are all in the configuration; no dynamic objects at runtime); **a cyclic plan (MAF + time slots) and a fixed-priority plan**; **Plan 0 = initialization, Plan 1 = maintenance**, and a switch waits until the current plan's remaining slots have run; **at most 8 IPVIs per partition**
- [[lynxsecure]] — **a static separation kernel**: hardware partitions defined at boot and immutable; kernel function is limited to **resource partitioning / controlling data flow between partitions / mediating the entry of system-state changes**; **I/O and application support are entirely exported to guests** (the kernel has no drivers and no I/O stack). Includes an **operational reverse-engineering layer**: configuration ahead of code, startup is the only window where you can see "the configuration taking effect", **work backwards from the three duties to the kernel boundary**, look for a controlled channel across partitions rather than a shared page, and use the vendor constraints to verify isolation of DMA / the hypervisor from the guest
- [[questv]] — **multikernel sandboxes + one monitor per sandbox**: the monitor intervenes only at bootstrap / faults / shadow page tables / channel setup; EPT is used for **memory isolation**, not CPU virtualization; interrupts are delivered directly to the sandbox; **an EPT violation → a VM-exit to the corresponding monitor** (a trap can be forced when needed); local / remote **online recovery**; **no global clock**. Includes criteria for locating "which span is the monitor"

## Cross-domain joins

- [[re-evasion]]: the anti-virtualization detection / bypass frame (CPUID hook, timing countermeasures); analyzing a malicious sample's VM-detection behavior
- [[re-kernel]]: the base for analyzing a hypervisor driver / kernel module (DriverEntry, IRP, together with kernel debugging)
- [[re-windbg]]: Windows host / guest kernel debugging (`!cpuid` for CPUID leaves, watching driver load)
- [[re-ghidra]] / [[re-ida]]: decompile VMCS/VMCB-related code and annotate structures (build an enum from SDM Appendix B)
- [[re-sandbox]] / [[re-analyze/platform-tips]]: the top rule for isolating a QEMU/KVM experiment environment; a nested VM is the default sandbox form
- [[re-triage]]: a quick early check of "are we inside a VM / does the CPU have virtualization" (the `virt-what` approach)

## Common pitfalls and traps

- **A hardware-virtualization debug environment is complicated**: symptom — a hypervisor sample will not run inside an ordinary VM / crashes immediately, attaching a debugger fails, and the sample behaves abnormally after it detects a nested environment; cause — nested virtualization needs host CPU support + an explicit enable (KVM nested / Hyper-V / VMware options), and the sample detects whether it is "really at the bottom"; response — first accumulate information purely statically (the CPUID and VMCS analysis of steps 1-2 does not need to run the sample); before going dynamic, confirm three layers of capability: the host vmx/svm flags (`grep vmx /proc/cpuinfo`) → the nested switch (`/sys/module/kvm_intel/parameters/nested`) → QEMU `-cpu host` passthrough; run every experiment in an isolated sandbox (the top rule of [[re-analyze/platform-tips]])
- **Reversing the VMCS kernel object has a high bar**: symptom — VMREAD/VMWRITE in the decompilation is a pile of magic numbers, you do not know which field is being read or written, and the VM-exit dispatch logic is unreadable; cause — the VMCS is a hardware-defined format (field encodings are not symbols), and the layouts of the CPU architectures (VT-x vs SVM) are completely different; response — build the Intel SDM Appendix B field-encoding table into the decompiler (a Ghidra enum / structure) and decode each VMREAD/VMWRITE operand; organize the analysis as guest-state / host-state / control; for an AMD target use the VMCB fixed-offset layout (APM Volume 2)
- **EPT makes memory breakpoints fail**: symptom — a memory breakpoint / page-protection breakpoint the debugger planted inside the guest does not fire, or fires and then behaves strangely (registers do not line up); cause — EPT accessed/dirty bits are independent of the guest page tables, and the VMM controls the memory view the guest sees through EPT (including hidden pages); an ordinary debugger breakpoint is based on the guest page-table view; response — separate an EPT violation (VM exit reason 48) from a guest page fault (reason 14); to observe the EPT layer you must look at the EPT page-table structure itself (expand it from the VMCS EPTP field), not the guest page tables; under [[re-kernel]] kernel debugging, compare the host-side and guest-side memory views
- **CPU feature differences (VT-x vs SVM)**: symptom — VMCS offsets / exit-reason numbers organized on an Intel machine do not line up at all on an AMD machine, or the reverse; cause — VT-x and SVM are two independent implementations: VMCS (VMREAD/VMWRITE encodings) vs VMCB (fixed offsets), and the exit-reason numbering differs; response — first confirm the target platform (CPUID vendor + the vmx/svm flags, step 1) and pick the matching manual (Intel SDM Vol 3C / AMD APM Vol 2); mark analysis notes with the target platform and CPU model, and do not reuse a field table across platforms
- **The sample changes behavior after it detects a VM (this affects the conclusion)**: symptom — malicious logic that is clear in static analysis is completely invisible when run dynamically (the sample runs "normally"); cause — once the sample detects that it is inside a VM / debug environment it takes a "harmless branch" (a common anti-sandbox / anti-debug technique); response — follow step 1 and first determine the virtualization state from the sample's point of view; dynamic verification must match the sample's detection conditions (or bypass each detection); the conclusion is based on "the detection points recovered + the behavior after the bypass"; one run and a conclusion is not trustworthy
- **AMD NPT cannot copy an EPT scheme**: symptom — an "execute-only page" trick that works on Intel (a shadow page that is X-only) fails on AMD; cause — NPT and EPT are two independent implementations, and **NPT cannot set an execute-only attribute by itself** (the read and execute bits are tied); response — before a cross-platform hook / hide, confirm whether the target is Intel (EPT) or AMD (NPT); AMD needs a different method (for example combining NX + a data view)
- **"Traceless VT read/write" is a false proposition**: symptom — believing EPT can tracelessly read and write an arbitrary data segment; cause — a shadow page table can tracelessly rewrite only a "code segment" (the fetch view switches); a data segment cannot satisfy both views at once (read the original vs write the shadow); response — a traceless write is limited to the code-segment case (a hook); reading a data segment still walks the four-level page tables (the two-stage GVA→GPA→HPA translation) and reads the physical page directly, which is not essentially different from an ordinary driver approach
- **RDTSC detection of VM-exit cost can be compensated**: symptom — the sample uses `__rdtsc` / `__rdtscp` to measure an instruction's elapsed-time delta and recognize a hypervisor; cause — a VM-exit has a fixed measurable cost; response — record `exit_tsc` as early as possible at the VM-exit assembly entry, and have `ReadVirtualTsc` compensate with a bounded smooth estimate (do not treat the whole interrupt / scheduling long tail as exit cost), and keep each vCPU monotonic (`max(value, last_guest_tsc+1)`); principle: wherever the sample detects, handle it inside the VM-exit
- **Treating a cross-VM local handle as a global identifier**: symptom — the same integer appears in two domains / VMs in a trace and is treated as the same object; cause — a grant ref is an entry index, an event-channel port is a notification port, and shmem_id is the shared object's identity; a local port also changes after reconnect and can be reused; response — align each one through its own table / configuration (grant-table entries, the shared_info bitmask, shmem_id); see [[xen]] / [[bao]]
- **Treating a virtual address as a physical address**: symptom — an MMIO address inside the guest has no counterpart on real hardware, so the driver is called wrong or the wrong device was captured; cause — a PV device has no register window; under a partitioning hypervisor a guest BAR/GPA and a physical BAR/HPA are separated by EPT/NPT or a passthrough mapping; a vdev's address is manufactured by configuration; response — first decide "passthrough or vdev / emulation", then talk about whether the addresses match; see [[qnx-hypervisor]] / [[acrn]] / [[jailhouse]]
- **Treating a hypervisor protection action as a guest crash**: symptom — after accessing some address the program "suddenly stops", but there is no ordinary page-fault / bus-error evidence; cause — a static-partition hypervisor **parks** the CPU/cell that made an unauthorized access (Jailhouse); response — check the hypervisor-side log (Unhandled trap / Parking CPU) and compare resource ownership in the cell/VM configuration ([[jailhouse]])
- **Looking inside the device model when cross-VM shared memory will not connect**: symptom — ivshmem on both sides looks "fine" but they cannot communicate at all; cause — ACRN's dm-land and hv-land are two implementations; different prefixes (`dm:/` and `hv:/`) never interconnect, and dm-land has no doorbell notification; response — first check that the implementation and the prefix match, then look at the data plane ([[acrn]])
- **Treating a descriptor such as a GPADL as a memory address**: symptom — a small integer in a trace is used as an address or an offset in a calculation; cause — a GPADL is a handle that "describes and maps a guest buffer", and the host limits the shared total; response — recover the buffer it points at under handle semantics ([[hyperv-vmbus]])
- **Network traffic "disappears" mid-way but the function still works**: symptom — VMBus is busy for a while, then packets cannot be captured but the network still works; cause — under SR-IOV the data plane can switch from the synthetic path to **VF passthrough** (the data plane bypasses VMBus and the hypervisor; the control plane stays on VMBus); response — first decide which path the data plane currently takes ([[hyperv-vmbus]])
- **Analyzing resource ownership without the configuration file**: symptom — there is no answer to "why this partition cannot access it"; cause — a configuration-driven separation system (XtratuM, LynxSecure, Jailhouse, Bao, and similar) puts all resource ownership in the configuration; response — take the configuration first, then talk about the code ([[xtratum]] / [[lynxsecure]])
- **Treating "missing centralized management code / very few VM-exits" as no isolation**: symptom — disassembly has no central scheduler or reconfiguration logic; cause — a static-configuration model and a multikernel sandbox simply do not work that way; response — explain it with that system's model ([[lynxsecure]] / [[questv]])
- **Comparing timestamps across sandboxes**: symptom — the same event's time does not line up on the two sides; cause — some multikernel designs **have no global clock**; each core uses a local timer and the TSC; response — count clock skew; do not assert on a single timeline ([[questv]])
- **Expecting drivers and an I/O stack in the kernel region**: symptom — one image block has everything (drivers, I/O, application APIs) and is treated as the kernel; cause — an extreme static-separation design **exports all I/O and application support to guests**; the kernel only does resource partitioning / data-flow control / mediation of state changes; response — work backwards from those three duties to the real kernel boundary ([[lynxsecure]])
- **Looking for "reconfiguration" logic at runtime**: symptom — there is no dynamic MMU / resource-reconfiguration engine; cause — under a static-configuration model, mappings and ownership are fixed at startup; response — put the work of following mappings into the startup phase ([[lynxsecure]])

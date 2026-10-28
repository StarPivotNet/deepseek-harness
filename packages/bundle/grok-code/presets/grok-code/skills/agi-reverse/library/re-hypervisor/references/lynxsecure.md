# LynxSecure: a static separation kernel / what to recover / how to find the boundary

<CORE RULE>
This is an **extreme static-separation** design, and **there is no central management kernel**:

```
Hardware partitions defined at boot, immutable
Immutable hardware-enforced isolation (held continuously from power-on to power-off)
Kernel-space function is limited to: resource partitioning, controlling data flow between partitions, mediating access to system-state-change functions
I/O and application support are [entirely exported to user-mode guests]
```

So the least intuitive point is:

```
At runtime you cannot find a complete "VM configurator / dynamic MMU configuration engine"
  → consistent with this model
  → do not conclude "the firmware was stripped / damaged"
```
</CORE RULE>

**Note**: most implementation detail of this system is not public. Below, two kinds of content are separated — **[official statement]** (safe to cite directly) and **[what to recover]** (methodology, to guide analysis, not an assertion about the implementation).

## 1. Official statements (the basis for "what is normal to be missing")

- **Hardware partitions defined at boot, immutable**; **immutable hardware-enforced isolation**, held continuously from power-on to power-off
- **Least privilege**: kernel-space function is **limited** — **resource partitioning, controlling data flow between partitions, mediating access to system-state-change functions**
- **At the developer's request, I/O and application support are entirely exported to user-mode guests** — **the kernel has no drivers, no I/O stack, and no application API**
- Runtime constraints (as the vendor lists them):
  - **No hypervisor / management-console login**
  - **No dynamic system modification**
  - One guest cannot access another guest's resources
  - **The hypervisor itself also cannot access a guest's resources**
  - **A DMA-capable device cannot access a guest's resources**

(Note: public material **does not directly confirm** the specific mechanism "privileged setup code used for the initial configuration is then discarded"; what is listed above is what the vendor states explicitly — use that to judge "what is normal to be missing".)

## 2. What to recover (the reverse-engineering workbench layer)

### 1. Configuration is the most important artifact, ahead of code

Resources are fixed into an immutable division **at boot**. So the first priority is to **recover "who owns what"**:

```
CPU-core ownership / memory-region ownership / I/O and device ownership
```

**How**: the configuration itself (if you can get it) is the highest value; if you cannot, infer backwards from **the resource range each guest can see** — union the physical range each guest can see; **a gap is another partition**, and an overlap is a suspicious point.

### 2. Startup is the only window where you can see "the configuration taking effect"

Because there is **no dynamic system modification** at runtime, mappings and ownership are **established at startup**:

```
Follow mappings, follow resource allocation → do it during startup
At runtime you should see only a state that is "already fixed"
```

**So**: if at runtime you see "some resource being reallocated dynamically", first suspect you are seeing something else (for example an allocation inside a guest), not the kernel reconfiguring.

### 3. How to find the boundary: work backwards from the "three duties"

The vendor limits kernel function to three things. **Wherever those three things appear, that is the boundary**:

| Duty | What to look at |
|---|---|
| **Resource partitioning** | who reads / writes a structure of the "division table" class |
| **Controlling data flow between partitions** | where a cross-partition data path is intercepted / checked |
| **Mediating access to system-state-change functions** | the gatekeeping code at the system-state-change entry |

**Corollary**: **the kernel should not contain drivers, an I/O stack, or an application API** — so

```
You see a complete driver / I/O stack inside one image
  → that piece is very likely not the kernel
```

### 4. What cross-partition communication looks like in memory

- By design there is **no shared memory**: hardware-enforced isolation means **there is no ordinary path where two partitions share the same physical memory**
- Cross-partition data flow is **controlled** by the kernel — so what you look for is a **controlled channel** (a path where the data flow is intercepted / checked), **not a shared page**
- This is the **opposite direction** from a "shared memory + notification" system (see [[re-hypervisor/xen]], [[re-hypervisor/hyperv-vmbus]]): find the control point first, then the data path

### 5. How to verify IOMMU / device ownership

The vendor constraints can be used directly as **verification criteria**: a DMA-capable device cannot access guest resources, and the hypervisor itself cannot access guest resources.

So:

```
Take one DMA path and ask: which partition do its source and its target each belong to?
If the answer is "it crossed a boundary it should not" → contradicts the model; worth digging into
If the answer is "inside the same partition" → consistent with the model
```

### 6. The fault path and "which span of the 8 MB is the monitor"

- A minimal kernel means **the exception entry is narrow**: find "who receives control after a partition is violated"; that span is the core
- Combine that with the three duties in section 3: code blocks that **read the division table / intercept data flow / gate the system-state-change entry** belong to the kernel; the surrounding drivers and I/O stack belong to a guest

## Decision tree

```
Given an image of a static separation kernel
├─ First ask: can you get the configuration
│    ├─ Yes → recover CPU/memory/I/O ownership from it, then interpret the code
│    └─ No → infer from each guest's visible range; a gap = another partition
├─ You cannot find a "VM configurator / dynamic reconfiguration"
│    └─ Consistent with "static configuration + no dynamic system modification + no management login"
├─ You need to follow mappings
│    └─ Follow them during startup; there should be no reconfiguration at runtime
├─ You need to locate the kernel itself
│    ├─ Find the three duties: read the division table / intercept cross-partition data flow / gate system-state changes
│    └─ The kernel should not contain drivers and an I/O stack → a block that has drivers is very likely not the kernel
├─ Cross-partition communication
│    └─ Look for a controlled channel, not a shared page (the opposite direction from a shared-memory system)
├─ Verify isolation
│    └─ Use the vendor constraints as criteria: neither a DMA device nor the hypervisor itself should touch guest resources
└─ At runtime you see "a resource being reallocated"
     └─ First suspect that is behavior inside a guest; the kernel is not supposed to do this
```

## Tools and verification

- Configuration: the static division of CPU / memory / device ownership (the configuration itself, or inferred from guest-visible ranges)
- Startup: the process that establishes mappings and ownership during startup (the only window where you can see "the configuration taking effect")
- Boundary: where the three duties land; whether drivers / an I/O stack exist
- Communication: a controlled channel rather than a shared page
- Verification: you can state together "who owns which resource + whether this code belongs to the kernel or a guest + whether this data flow crosses a partition"

## Pitfalls on this platform (summary)

- **Treating "missing centralized management code" as stripped code**: a static-configuration model is like that by design
- **Looking for "reconfiguration" logic at runtime**: there is no dynamic system modification; look during startup
- **Treating a resource allocation inside a guest as the kernel reconfiguring**
- **Expecting drivers in the kernel region**: I/O and application support were exported to guests
- **Looking for cross-partition communication as "shared memory + notification"**: here it is a controlled channel, with no shared memory
- **Taking "the hypervisor can read guest memory" as the default forensic assumption**: the vendor states the opposite explicitly
- **Treating a missing intermediary for a DMA-capable device as a vulnerability**: the isolation model requires that it cannot touch guest resources
- **Assuming there is a management-console entry**: the vendor states explicitly that there is not

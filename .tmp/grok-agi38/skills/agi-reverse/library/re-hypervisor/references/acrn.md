# ACRN: Service VM / pre-launched / post-launched + Device Model

<CORE RULE>
In ACRN, "who is serving this I/O" has three mutually exclusive answers, and **you must decide which one first**:

| Path | Who serves it |
|---|---|
| **Passthrough** | The hardware is given directly to the VM; the hypervisor only does mapping and interrupt remapping |
| **Hypervisor emulation** | The hypervisor itself implements the device |
| **Service VM Device Model** | Emulated by the user-mode device model inside the Service VM |

Get that wrong and every later inference of "why was this register written this way" runs off course.

The basic topology is:

```
Hypervisor
├─ Service VM (directly owns a large amount of real hardware, and provides device emulation/sharing for post-launched VMs)
├─ Pre-launched VM (boots without depending on the Service VM)
└─ Post-launched User VM (depends on the Service VM's device model)
```
</CORE RULE>

## 1. The BAR the guest sees is not the physical BAR

On passthrough the hypervisor maps **virtual BAR ↔ physical BAR**: it builds an EPT mapping between them so the VM accesses MMIO directly — **but the pages that hold the MSI-X table must be trapped** (no EPT mapping), or it cannot remap between virtual vectors and physical vectors.

Two more things happen at the same time:

- **VT-d DMA remapping**: translates GPA to HPA for device DMA
- **VT-d interrupt remapping**: ACRN requires it for security; **if the VT-d hardware does not support interrupt remapping, ACRN refuses to start the VM**

**So:**

```
Guest BAR0 = 0x80000000
Host physical device BAR = 0xD2000000
```

**Completely normal**. Do not conclude you grabbed the wrong device or the driver is wrong just because the addresses disagree.

## 2. Interrupts: there is not an equal number of VM-exits every time

- In the ordinary case the hypervisor injects the virtual interrupt; when supported it uses **VT-d posted interrupt (PI)** for better interrupt performance
- Therefore:

```
The guest ISR clearly ran
but the hypervisor trace does not contain the expected full interrupt-injection path
```

**Do not immediately call the trace incomplete** — first confirm whether that device / that VM took a bypass such as posted interrupt.

## 3. ivshmem: dm-land and hv-land are two mechanisms

ACRN's shared-memory device (ivshmem) has two implementations. **They can exist at the same time, but VMs on different implementations cannot talk to each other through the same mechanism**:

| Implementation | Where | Shared memory comes from | Which VMs |
|---|---|---|---|
| **dm-land** | The Service VM's Device Model (`acrn-dm`) | The Service VM's memory space | **post-launched User VMs only** |
| **hv-land** | Inside the hypervisor | The hypervisor's memory space | both pre-launched and post-launched |

- Tell them apart by the name prefix: `dm:/` (in early patches, `sos:/`) and `hv:/`; **the wrong prefix makes ivshmem initialization fail**
- dm-land is defined by the `acrn-dm` launch argument `-s <slot>,ivshmem,<shm_name>,<shm_size>`; hv-land is configured at build time (`IVSHMEM_ENABLED` + `IVSHMEM_REGION`, format `name,size,VM ID list`), **at most eight hv-land regions**
- The device is a standard virtual PCI device: **BAR0 interrupt-related registers, BAR1 MSI-X table, BAR2 shared memory**
- Register semantics: `IRQ_MASK(0x0)` and `IRQ_STA(0x4)` are reserved (legacy interrupts are not supported), `IV_POS(0x8)` is the cross-VM position / VM ID (currently 0), **`DOORBELL(0xC)` triggers the peer's interrupt**
- **Notification (doorbell) is supported only in hv-land**: the sender writes the target VM ID and vector number into the doorbell register; the hypervisor side looks them up and **injects an MSI into the target VM** (at most 8 MSI-X vectors); **dm-land has no notification mechanism** (listed as not yet supported)
- Known pitfall: under dm-land, **if the guest reprograms BAR2, the shared memory becomes unusable** (GPA/HPA remapping for that case is not handled)

**So when "each VM's ivshmem looks fine, they just cannot see each other", the first thing to check is whether the prefix and the implementation match**, not to suspect the device model.

## 4. VM type decides the MSI-X trap path

ACRN defines a separate MSI-X access path for each of the three VM classes:

| VM type | Path |
|---|---|
| Service VM | the hypervisor's MMIO handler |
| **Post-launched VM** | **the Device Model's MMIO handler, which then involves the hypervisor** |
| Pre-launched VM | the hypervisor handler |

**So do not assume "every MSI-X write takes the same hypervisor path".**

## 5. Device ownership moves between VMs

- When a post-launched VM starts, ownership of a physical device **moves from the Service VM to that VM**; when the VM shuts down it **moves back to the Service VM**
- So "a PCI device in the Service VM suddenly disappears, then comes back a while later" **is not necessarily a hot-plug failure**
- **A pre-launched VM is created by the hypervisor** and does not go through the Service VM's Device Model — **not seeing a device-model process does not mean a layer is missing from boot**
- Under passthrough, a guest BAR that differs from the host BAR is normal: guest GPA goes through EPT/VT-d to HPA, and **DMA also needs VT-d's GPA→HPA translation**

## Decision tree

```
Given an ACRN target
├─ Separate VM types first: Service VM / pre-launched / post-launched
│    └─ Only post-launched can go through the Service VM's Device Model
├─ Who is serving an I/O behavior?
│    ├─ Passthrough → check virtual BAR ↔ physical BAR mapping, VT-d DMA/interrupt remapping
│    ├─ Hypervisor emulation → check the device implementation on the hypervisor side
│    └─ Device Model → check the device model inside the Service VM
├─ Guest BAR and physical BAR disagree
│    └─ Normal (passthrough does MMIO remapping by design); note that the MSI-X table pages must be trapped
├─ An interrupt happened but the trace has no expected injection path
│    └─ Check whether it took a bypass such as posted interrupt; do not call the trace incomplete
└─ ivshmem does not connect
     ├─ Check the prefix: dm:/ or hv:/ (mixing them never connects)
     ├─ pre-launched can use only hv-land
     ├─ dm-land has no doorbell → shared data only, no mutual notification
     └─ Under dm-land the guest reprograms BAR2 → shared memory unusable (known unhandled case)
```

## Tools and verification

- Topology: VM type (Service VM / pre-launched / post-launched) and device ownership
- Passthrough: the EPT mapping of virtual BAR and physical BAR, whether the MSI-X table pages are trapped, whether VT-d DMA/interrupt remapping is enabled
- Shared memory: the ivshmem name prefix (`dm:/` / `hv:/`), BAR layout, doorbell register, and MSI-X vectors
- Verification: you can state together "VM type + this I/O's service path (passthrough / hypervisor / Device Model) + how many remapping layers the address and the interrupt went through"

## Pitfalls on this platform (summary)

- **Not separating pre-launched from post-launched first**: device availability and the service path are completely different
- **Treating the guest's PCI BAR as the physical BAR**: passthrough has a virtual↔physical mapping by design
- **Assuming the MSI-X table pages are also directly accessible to the guest**: those pages must be trapped so vectors can be remapped
- **Calling the trace incomplete because an interrupt trace has no VM-exit**: a bypass such as posted interrupt reduces or even avoids the ordinary VM-exit
- **Mixing dm-land and hv-land ivshmem**: the two implementations never connect, and a wrong prefix fails initialization outright
- **Expecting dm-land on a pre-launched VM**: dm-land supports only post-launched
- **Expecting a doorbell notification from dm-land**: notification is implemented only in hv-land
- **Ignoring the effect of the guest reprogramming BAR2 under dm-land**: the shared memory becomes unusable
- **Ignoring the hard requirement of VT-d interrupt remapping**: on hardware that does not support it, ACRN refuses to start the VM

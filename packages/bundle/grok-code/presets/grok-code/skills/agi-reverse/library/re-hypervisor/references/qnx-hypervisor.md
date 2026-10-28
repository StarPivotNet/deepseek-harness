# QNX Hypervisor: three address layers / vdev / virtual interrupts

<CORE RULE>
A "physical address" inside the guest is not a host physical address at all. There are at least three layers:

```
guest virtual → guest physical (ARM term: IPA) → host physical
```

And the "device" the guest sees **may have been manufactured by configuration**:

```
the guest driver's MMIO address = 0x1c090000
  ≠ that device actually sits there on the real SoC
```

If that is a **vdev**, the address is decided entirely by the VM configuration. **First decide "passthrough, or vdev", then talk about whether the driver is written correctly.**
</CORE RULE>

## 1. Address model

- Guest RAM is configured by the process that creates the VM (qvm); to the guest it looks like physical memory, **but it still needs one more translation**
- **Passthrough device**: the device physical address the guest sees has **no direct correspondence** with the host physical address (unlike shared memory) — the virtualization layer does the translation
- **shmem vdev**: the "factory-page address" in the configuration (for example, somewhere outside the allocated RAM) **is explicitly guest physical, not a real hardware address**

**So "the guest's MMIO address has nothing at that place on the real SoC" is not an error**.

## 2. vdev: the guest driver must match the virtual hardware that was exposed

- If the hypervisor configures a PL011 vdev, the guest **should believe there really is a PL011 there** — what it matches is the hardware model the vdev exposes, not the original part on the board
- Corollary: **the guest's device tree ≠ the physical board device tree**; they can differ completely

## 3. shmem vdev: factory page + control page

A shared-memory vdev appears on the guest side as "a set of registers mapped in guest-physical + the ability to raise an interrupt". It can be MMIO (`loc` / `intr` given directly in the configuration) or PCI (the default; location and interrupt are assigned by the hypervisor).

The **factory page (4 KB)** is its virtual register page:

| Field | Role |
|---|---|
| `name` | region name |
| `size` | size — **a write triggers creation** |
| `shmem` | returns the guest-physical address of the control page |
| `vector` | interrupt vector |
| `status` | status |

- **Creation happens on first use**, so **guests may start in any order** — "the one that started first is also fine" needs no extra explanation
- Each shared region also has its own **control page** in front: `status` (active clients / notify bits), `idx` (connection ID), `notify` (write a bit set to notify other guests), `detach`
- Guests communicate **by writing the control page**

## 4. Virtual interrupts: `intr pass` and `intr vdev` are two different paths

The `intr` keyword in the VM configuration decides where the interrupt comes from:

| Form | Meaning |
|---|---|
| `pass` | The **host** routes a physical device's interrupt to the guest (a guest interrupt number can be given, or a host PIC that maps host vectors onto guest interrupt numbers) |
| `vdev` | The interrupt is produced by **vdev code running on the host side** (a host PIC that the guest vdev sends interrupts to, or a directly specified guest interrupt controller and line) |

- **On x86 the LAPIC is provided automatically** (a vdev only writes `intr apic`, no line number), for example `vdev ioapic` + `intr apic`, `vdev ser8250` + `intr myioapic:4`
- **On ARM the GIC is provided automatically** (it can also be specified explicitly)
- shmem notification uses the `notify` bit set: the receiving guest's IRQ handler reads `status` (low bits say who notified it, high bits say active connections)

**So "the driver's ISR is very short, but interrupt latency got noticeably worse" is not necessarily a slow driver**: the path may be

```
physical device → hypervisor (interrupt ownership/routing) → virtual interrupt → guest ISR
```

A latency analysis must count the virtualization layer.

## 5. When a guest exit happens (this decides what trace you can see)

Halt, **a vdev access** (for example an MMIO write to the shmem factory page's size register is trapped, and is used to create / attach a region), a host-side interrupt, a virtual timer, a CPUID-class instruction.

## 6. Passthrough devices: only one resident may access at a time

- On passthrough **the hypervisor does not need a device driver**: it only identifies and forwards the physical device's interrupts to the guest, and hands the guest's signals straight to the device; the rest of the interaction is the guest with the device
- **Only one resident (host or guest) may access a given passthrough device at a time** — "host and guest operating the same device at once" is not an option; it is an error state

## Decision tree

```
Given a QNX Hypervisor target
├─ Classify the device form first
│    ├─ Passthrough (pass) → GPA and HPA have no direct correspondence; only one resident may access at a time
│    └─ vdev → address / register layout is manufactured by the VM configuration; guest DT ≠ board DT
├─ The address does not match real hardware
│    └─ Normal: at least three address layers; the shmem factory-page address is explicitly guest physical
├─ Shared memory
│    ├─ Find the factory page (name/size/shmem/vector/status); writing size is what triggers creation
│    ├─ Created on first use → guest start order does not matter
│    └─ The data plane writes the control page (status / idx / notify / detach)
├─ Interrupts
│    ├─ Separate intr pass (host routes) from intr vdev (produced by a host-side vdev)
│    ├─ Latency got worse → count the hypervisor's interrupt ownership/routing into the path
│    └─ shmem notification → read status to decide who notified and who is active
└─ The trace has many VM-exits
     └─ Check whether a vdev register write (such as the factory-page size) was trapped
```

## Tools and verification

- Configuration: RAM layout in the VM configuration, the `loc` / `intr` keywords, vdev type (MMIO or PCI)
- Shared memory: factory-page fields and control-page fields (`status` / `idx` / `notify` / `detach`)
- Interrupts: separate the `pass` and `vdev` sources, then look at the guest-side interrupt controller (x86 LAPIC / ARM GIC are provided automatically)
- Verification: you can state together "which layer the address is on + whether the device is passthrough or a vdev + which path notification and interrupts come from"

## Pitfalls on this platform (summary)

- **Taking the guest's MMIO address and looking for the device on the real SoC**: three address layers; a vdev's address is decided entirely by configuration
- **Treating the guest device tree as the board device tree**: what a vdev exposes is a virtual hardware model
- **Assuming some guest must create the shared region first**: writing size on the factory page creates it on demand; start order does not matter
- **Treating shmem as an ordinary PCI device**: it can be MMIO or PCI; register semantics are defined by the factory page / control page
- **Not separating `intr pass` from `intr vdev`**: one is the host routing a physical interrupt, the other is produced by host-side vdev code
- **Attributing latency to the driver**: first see whether the interrupt went through the hypervisor's ownership and routing
- **Assuming host and guest can use the same passthrough device at once**: only one resident may access it at a time
- **Treating a VM-exit caused by a vdev register write as an anomaly**: that is the vdev's normal working mechanism (for example, creating a shared region)

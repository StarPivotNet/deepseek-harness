# Hyper-V / VMBus: VSC·VSP / GPADL / SR-IOV data-plane switch

<CORE RULE>
A Hyper-V synthetic device does not take "hardware MMIO + interrupt". It takes VMBus:

```
child partition:  VSC (guest-side driver, such as netvsc / storvsc)
                     ↕  VMBus (a bidirectional channel = two ring buffers)
root partition:   VSP (the host-side implementation of the synthetic device) + hardware
```

So:

```
Device I/O shows no obvious hardware MMIO
  → it may only be synthetic-device traffic on VMBus
```

Second: **a GPADL is not a memory address** — it is a handle that "describes and maps a guest buffer".
</CORE RULE>

## 1. How VMBus works

- VMBus is implemented through **memory pages mapped into several partitions** — data crossing the bus **does not need a hypervisor copy**, which cuts context switches
- A channel is **bidirectional**, made of **two ring buffers** (in / out); a high-speed device (synthetic SCSI, a NIC) can use **several channels** to raise parallelism
- On the Linux side it is a bus model (`/sys/bus/vmbus`); the main users are synthetic devices: storage, network, video, integration services

## 2. GPADL: Guest Physical Address Descriptor List

- Ring-buffer space is limited; the performance-critical path uses a **GPADL**: it lets the root partition **map extra guest memory pages directly into its own address space**
- The ring buffer itself is allocated by the guest, and the guest tells the host the GPA list **over the VMBus control path**; larger transfers use a separate GPA list to describe the data buffer
- Hyper-V **limits the total amount of guest memory shared through GPADLs** (about 1280 MB on Windows Server 2019+, about 384 MB earlier), so a malicious guest cannot exhaust host resources

**RE meaning**:

```
GPADL = 37
  → not GPA 0x25000
  → a handle, behind which is "a guest buffer that was described and mapped"
```

## 3. SR-IOV: the data plane can "change roads mid-way"

On a NIC with SR-IOV:

- **Data plane** (VF): from the VF inside the VM **straight through hardware to the NIC** — **not through VMBus, and not through the hypervisor**
- **Control plane**: VF control still goes **through VMBus** back to the root partition's PF driver

**Migration order when a VF is torn down**:

```
The virtualization stack notifies the VPCI VSP (root-partition management OS)
  → notifies the VPCI VSC inside the guest over VMBus
  → NetVSC unbinds from the VF NIC driver
  → child-partition traffic moves from the VF data plane to the software synthetic data plane
  → then: move filter rules onto the default VPort on the PF, delete the VF's VPort, request a function-level reset, release VF resources
```

**So**:

```
VMBus is busy at first → later the traffic suddenly disappears from the packet capture → the network still works
```

**Not necessarily data loss** — it has very likely switched onto the SR-IOV VF passthrough path (or switched back).

## 4. Deleting a GPADL can block

- **If that GPADL is still mapped by the server, the delete call blocks until it is unmapped**
- When a GPADL is created from a buffer, **that buffer is probed and locked until the GPADL is destroyed**
- So a thread that "sticks after the delete call" during teardown should **first be checked against the lifetime of the remote mapping**, not immediately called a deadlock

## 5. Packet lifetime: callback return ≠ packet end

- **The completion call can be made immediately inside the processing callback, or later**
- **Only when the completion call is issued** does the system: clean up outstanding mappings, release the occupied buffer, and, **when the peer asked for a completion notification**, send the completion packet
- Therefore:

```
callback returned  ≠  packet lifetime ended
```

**When reversing a resource lifetime, do not treat "the callback returned" as the release boundary.**

## 6. A large payload is not inside the ring packet

- A packet can have only an **inline control buffer**; a large payload is supplied through an **external memory descriptor**
- So a ring dump shows:

```
header / command / a few fields
but the real data is not there
```

**That is normal** — keep parsing the external memory descriptor.

## 7. Fetching external data can return "pending", and the callback runs again

- If describing that memory requires the corresponding region to be **paged in**, the call that fetches external data returns **STATUS_PENDING**
- You **must then return from the packet-processing callback**; **a later callback may be invoked again at a different IRQL (for example DPC)**, and calling it once more then succeeds and returns the data
- So the packet handler's control flow is actually:

```
callback #1  →  fetch data → STATUS_PENDING → return
        …later, possibly at a different IRQL…
callback #2  →  fetch data again → success → continue processing
```

**An ordinary synchronous CFG easily misses this edge.**

The returned MDL has two easy mistakes:

- **The memory it describes is already locked** — do not probe/lock it again
- **It has neither a user-mode nor a kernel-mode virtual address** — if you need a virtual address you must map it explicitly (and unmap it afterwards), or hand the MDL directly to a driver that does DMA
- **The MDL becomes invalid when "completion" is called**, and the kernel library frees it afterwards; **the driver does not free it itself**

When processing must run at passive level, a "defer to passive level" interface can hand the packet over.

## Decision tree

```
Given a Hyper-V environment target
├─ Device I/O has no hardware MMIO
│    └─ Explain it first as a synthetic device (VSC/VSP over VMBus)
├─ A small integer handle appears in the trace
│    └─ It may be a GPADL (a guest-buffer descriptor), not an address
├─ Network traffic "disappears" mid-way but the function still works
│    ├─ Check whether SR-IOV is enabled: the VF data plane does not go through VMBus
│    └─ Check the VF teardown / migration path (VPCI VSP → VMBus → VPCI VSC → NetVSC unbind)
├─ Channel congestion / a performance anomaly
│    └─ See whether multiple channels are in use (high-speed devices often have them)
└─ Shared-memory usage
     └─ There is a cap on the GPADL total (a host-side limit); sharing is not unlimited
```

## Tools and verification

- Channels and devices: the VMBus bus view, the VSC/VSP pairing, the synthetic-device type
- Buffers: where a GPADL is established and used; check "this is a handle, not an address"
- Network path: whether a VF exists, whether the control plane is still on VMBus, whether the data plane currently takes the VF or the synthetic path
- Verification: you can state together "whether this I/O takes the synthetic path or VF passthrough + how the shared memory is described by a GPADL + who holds the control plane"

## Pitfalls on this platform (summary)

- **Treating a GPADL as a memory address**: it is a buffer-descriptor handle
- **Looking for hardware MMIO on a synthetic device**: VMBus uses a shared ring, not a register window
- **Treating an SR-IOV switch as data loss or a failed capture**: the data plane can move from VMBus to VF passthrough (and can move back)
- **Assuming everything about the VF bypasses VMBus**: the data plane bypasses it; **the control plane still uses VMBus**
- **Ignoring multiple channels**: a high-speed device may use several channels in parallel
- **Assuming GPADL sharing has no cap**: the host limits the shared total
- **Treating a block while deleting a GPADL as a deadlock**: it waits for the server to unmap; a GPADL created from a buffer also locks that buffer until destruction
- **Treating processing-callback return as the end of the packet**: the completion call is the release boundary, and it may be deferred
- **Looking for a large payload inside the ring packet**: large data goes through an external memory descriptor
- **Treating "pending" from a fetch of external data as failure**: that is what it returns when paging is required, and the callback runs again later, possibly at a different IRQL
- **Taking a virtual address directly from an external-data MDL**: it carries no virtual address; map it explicitly and unmap it
- **Freeing the external-data MDL yourself**: it becomes invalid at the completion call, and the kernel library frees it

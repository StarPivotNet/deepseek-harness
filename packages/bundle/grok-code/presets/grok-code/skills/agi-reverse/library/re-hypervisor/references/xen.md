# Xen: PV front/back ends / grant table / event channel / XenStore

<CORE RULE>
**Do not treat a Xen PV device as an ordinary PCI/MMIO driver.**

Typical PV I/O has no register window. It has only a set of four:

```
frontend
  ├─ XenStore      : exchange configuration (including ring-ref / event-channel)
  ├─ grant table   : share a page
  ├─ shared ring   : request/response
  └─ event channel : notification
                   │
                backend
```

That produces two frequent misreads: **treating a grant ref as an address**, and **treating an event port as an IRQ number**. Both are only an **index / handle**, not something in the address space.
</CORE RULE>

## 1. XenStore: where configuration is exchanged; values are stored as text

- The frontend records the backend domain in XenStore (`backend-id`, usually 0), and writes the **grant reference of the shared ring** there: `ring-ref`, `tx-ring-ref`, `rx-ring-ref`, `ctrl-ring-ref`, and similar
- The notification port is also written into XenStore: `event-channel` (the network control ring uses `event-channel-ctrl`)
- **Values are strings** (XenStore is textual) — "ring-ref=42" stores the text `"42"`, not a binary field
- **The frontend shares memory with the backend** (not the other way around): the frontend shares a locally allocated ring in a way similar to `xenbus_grant_ring()`, then tells the backend the reference; after the backend receives the reference it allocates a page in its own kernel address space and maps it

**RE meaning**: once you have a PV frontend, **first read what it wrote in XenStore** — the backend domain, the ring reference, and the event port are there, a ready-made entry for recovering the topology.

## 2. A grant reference is an **entry index**, not a physical address

```
ring-ref = 42
  ≠ page 0x2a / physical address 0x2a000

ring-ref = 42
  → entry 42 of the frontend grant table
  → { flags, domid, frame(MFN) }
  → the backend maps that page from the entry
```

- Each domain has its own grant table (a block of memory shared with the hypervisor, allocated / initialized by the guest and handed to Xen by a hypercall)
- An entry has three fields: **`flags` (operation and permissions), `domid` (the remote domain that was granted), `frame` (the MFN of the granted page; note that it is an MFN, not a virtual address)**
- **The grant reference is the entry subscript**; the subscript is passed to the remote domain, and the remote uses it to "activate" that entry
- A reference can be passed embedded in a ring message (for example a block device's `blkif_request_segment.gref`, or the network's `netif_tx_request.gref`) — **a small integer inside a ring is very likely a gref, not an offset or a length**

**Permission and state bits (they decide "can it be revoked")**:

| Name | Meaning |
|---|---|
| `GTF_permit_access` | allow the remote domain to access some page of this domain |
| `GTF_accept_transfer` | accept a page being transferred into this domain |
| `GTF_readonly` | export / import read-only |
| `GTF_reading` / `GTF_writing` | set by the hypervisor; the page **is currently mapped by the remote** (read / write) |
| `GTF_transfer_committed` | the transfer has completed |

- **Xen does not support revoke while a mapping is held**: the call that ends foreign access **only prevents later mappings**; it does not revoke a mapping already established; the sender must **wait until the reading/writing flags clear** (confirm with the query interface) before it can actually reclaim
- Two uses must be kept apart: **grant access that keeps ownership** (block frontend/backend: A grants, B maps, B unmaps when done, A then revokes) and **a transfer of ownership** (PV only; older network front/back ends use it; newer designs copy through the hypervisor to avoid TLB cost)

## 3. An event-channel port is not an IRQ number

```
event-channel = 17   ≠  hardware IRQ 17
```

- An event channel is Xen's notification primitive (the `event_channel_op` hypercall). Types include **VCPU/IPI, VIRQ, PIRQ, and interdomain**
- An interdomain channel is commonly built with `alloc_unbound` / `bind_interdomain`, and the port number is usually passed to the peer through XenStore
- **The port integer is bound to a global bitmask in each guest's `shared_info`** (1024 bits for a 32-bit guest, 4096 bits for a 64-bit guest) — that is what a "port" actually is in this system
- User mode has a separate interface, `/dev/xen/evtchn`

**So when a trace shows `port 17`, do not go looking for IRQ 17 in the IOAPIC/GIC.**

## 4. Migration: **the local port is unstable; the remote port is the stable identifier**

- An interdomain event channel is essentially **a pair of ports**: a local port + a remote port
- When the holder exits it closes `/dev/xen/evtchn`, and the kernel then closes the local port; **on reconnect it binds a brand-new local port using the original remote port**, and the new local port number **may differ from the old value**
- So **what you record / align on is the remote port**; treating the local port number as a persistent object identity will be wrong
- A more dangerous point: **a local port number can be reused after unbind**, and a leftover reference points at a completely different channel

**This is the same class of pitfall as a seL4 CPtr and a Zircon handle** (see [[re-kernel/sel4-kernel]], [[re-kernel/zircon-kernel]]): **an integer handle is not a global identifier**.

## 5. A shared ring is not ordinary shared memory

Typical flow:

```
The frontend owns the page → grants it to the backend → the gref is written into XenStore
        → each side maps the same pages → the event channel only kicks
```

So seeing **the ring memory keep changing, with no `memcpy` / socket IPC**, is normal — this is a shared-page + producer/consumer-index model, and the notification is only "a kick". Each ring has one event channel: wake the receiver when the ring becomes non-empty, wake the sender when it becomes non-full.

## 6. XenStore is the control plane, not the data plane

- **`state = Connected` only means protocol negotiation finished**; it does not mean data travels through XenStore
- The real data plane can be a **grant shared ring + an event channel**:

```
XenStore has almost no traffic, but device I/O is large
  → normal
```

- **The backend is not necessarily in Dom0**: do not hard-code `/local/domain/0/...`; the frontend provides **`backend` and `backend-id`** to locate the service domain explicitly — **a normal backend region should not be derived by assumption**

## 7. Notification suppression: the ring advancing with no kick is normal

- The producer-side push macro **decides whether the peer actually needs a notification**: **a notification is sent only when the newly advanced request crosses the `req_event` threshold the peer set** (the response side is symmetric, using `rsp_event`)
- So:

```
ring producer advances + no event is sent
  → completely normal
  → the peer already has work in flight, and it will look at the ring again itself
```

- Ordering requirement: write the request → write barrier (the peer sees the request first) → update the producer index → full barrier (the peer sees the new request first) → then test `req_event`

## 8. "Check once more before sleeping" is the core of the protocol, not a strange busy-loop

The standard shape on the consumer side when it is about to sleep:

```
no work found
  → set "notify me of the next event" (req_event = req_cons + 1)
  → full barrier
  → check the ring once more
```

- The race this barrier covers is: **the producer has already read `req_event` (and therefore decided not to notify), and the consumer updates it afterwards** — without the recheck a **wakeup is lost**
- A known side effect: used as written it causes "one extra wakeup every 2^32 events" (index wrap); implementations commonly push the event pointer into the past as a fix
- Another side effect: the macro **advances the ring's event pointer**, which in a NAPI-class case can "invite the next interrupt early", so some paths use it only when they really switch back to interrupt mode

**So do not optimize away the "double check", and do not treat the related full barrier as redundant.**

## 9. Event-channel mask / pending semantics: not "set the enable bit to 1"

- An event channel is a **"one-bit event state"** model; **unmask is not simply turning an enable bit on**
- The FIFO ABI unmask path: clear MASKED (and BUSY with it), and **if PENDING is set, issue the unmask call**; that call's semantics require: **if the event is pending, a notification must be delivered to the corresponding VCPU**
- So "an event arrives while masked, and behavior is strange after unmask" should be explained from **pending / masked / FIFO semantics**, not as an ordinary interrupt enable

## 10. FIFO event ABI: priority, and the two ABIs must not be mixed

- **Priority 0 is highest, 15 is lowest**, default 7; **each VCPU has 16 event queues**
- Each event is a word with flags: **PENDING / MASKED / LINKED / BUSY**, plus a LINK field pointing at the next queue item; each VCPU control block contains a ready word and 16 queue heads
- Meaning: **delivery latency of different events can come from FIFO priority, not from vCPU scheduling**
- **Inside the same Xen build, the event-accounting layout can be completely different** — there is a **2-level ABI and a FIFO ABI**:

```
Using a shared_info pending-bitmap parser to interpret a FIFO control block → entirely wrong
```

- One concrete trap: **the operation that initializes the FIFO control block does not re-deliver events that are currently pending (they are dropped)**, so it should be finished before any event is bound

## 11. Identity changes after migration

Migration may require the front and back ends to **renegotiate the protocol**, because **domid and event-channel state are not necessarily preserved**:

```
Before migration: domid 7 / port 10
After migration:  domid 12 / a new connection
```

**That should not be called device hijacking. (Same origin as handle locality in [[re-kernel/zircon-kernel]] and [[re-kernel/sel4-kernel]].)**

## 12. Memory barriers are part of the protocol

There are barriers before and after the ring producer-index update, so request / response data is **visible to the other end first**. **These barriers are not compiler noise; deleting them breaks the protocol.**

## Decision tree

```
Given a Xen target
├─ Classify first: PV frontend / backend / a fully virtualized (HVM) device?
│    ├─ PV → find the set of four: XenStore entries + grant ref + shared ring + event channel
│    └─ No register window / MMIO loop → normal; PV does not have one
├─ You see `ring-ref = N`
│    └─ N is a grant-table entry index → read the entry {flags, domid, frame}; it is not an address
├─ You see `event-channel = N`
│    └─ N is an event-channel port (bound to the shared_info bitmask), not an IRQ number
├─ A page is accessed by the remote / you want to reclaim the page
│    ├─ GTF_reading / GTF_writing is set → the mapping is still held; revoke has not taken effect
│    └─ Ending foreign access only prevents later mappings; you must wait for the flags to clear
└─ The port number changed after migration / reconnect
     └─ Normal: the local port is reallocated; the stable identifier is the remote port
```

## Tools and verification

- Configuration source: ring references and event ports in the XenStore tree (`~/device/...` and `~/backend/TYPE/DOMID/DEVID`); `backend-id` in the frontend tree
- Memory path: grant-table entries (flags / domid / frame) and the reading/writing state bits
- Notification path: event-channel type (IPI / VIRQ / PIRQ / interdomain) and the port number; user mode through `/dev/xen/evtchn`
- Verification: you can state together "topology (who is in front, who is behind, connected by which XenStore path) + which set of grefs the memory uses + which port the notification uses"

## Pitfalls on this platform (summary)

- **Treating a grant ref as a physical address / page number**: it is only the subscript of an entry in this domain's grant table; the MFN is inside the entry
- **Treating an event-channel port as an IRQ number**: it is Xen's notification port, bound to the bitmask in `shared_info`
- **Assuming ending foreign access reclaims the page immediately**: revoke is not supported while a mapping is held; wait until `reading` / `writing` clear
- **Treating an event-port integer as a persistent object identifier**: the local port changes after migration / reconnect; after unbind the same number can be reused
- **Aligning on the local port (rather than the remote port)**: on reconnect the stable one is the remote port
- **Treating a small integer inside a ring message as an offset or a length**: it is very likely an embedded gref
- **Seeing the ring memory change with no IPC call and concluding the analysis missed something**: the PV data plane goes through shared pages by design; the notification only kicks
- **Reversing the share direction between frontend and backend**: the frontend shares the ring with the backend, and the backend then maps it
- **Expecting binary fields in XenStore**: it is textual; references and ports are stored as strings
- **Treating XenStore `Connected` as the data plane transferring**: it only means negotiation finished; the data is on the grant shared ring
- **Hard-coding the backend in Dom0**: read the frontend's `backend` / `backend-id`
- **Treating "the ring advanced but there was no notification" as a dropped event**: notification suppression is the protocol design
- **Deleting the consumer-side double check or the full barrier**: that is exactly the part that prevents a lost wakeup
- **Reading event unmask as "an interrupt enable bit"**: masked/pending semantics differ; a pending event must be delivered
- **Using one event parser for both ABIs**: the 2-level and FIFO accounting layouts differ
- **Initializing the FIFO control block only after events are bound**: events that are currently pending are dropped
- **Attributing latency caused by FIFO priority to vCPU scheduling**
- **Calling a domid / port change after migration a hijack**: renegotiation is normal

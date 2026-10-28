# z/OS: TCB·SRB / three address spaces / load module and LE / AMODE·RMODE·XPLINK

<CORE RULE>
z/OS **cannot be forced into a process + thread model**. There are two kinds of schedulable work unit, more than one address space, **and the program itself has a set of attributes for "which addressing mode I can run in, and where I live"**:

```
schedulable unit: TCB / SRB
address spaces: home / primary / secondary
program attributes: AMODE / RMODE (+ whether XPLINK)
```

Only when the three stack together do you get:

```
the current execution address belongs to another address space  → do not automatically call it control-flow hijack
the same module's stack behavior is reversed under two calling conventions → do not automatically call it stack corruption
```
</CORE RULE>

## 1. Two schedulable units

| | TCB | SRB |
|---|---|---|
| Represents | a task executing in an address space | a request to run a system-service routine |
| Typical origin | user programs and the system programs that support them | one address space detected an event that affects **another** address space |
| Ownership | the home address space contains that TCB | aligned with an ASCB (local SRB) or the master scheduler (global SRB) |
| Capability | ordinary task semantics | **always in supervisor state**; **cannot call an SVC (except ABEND) or WAIT**; can run cross-memory / AR mode, issue a PC, and schedule another SRB |

- **An SRB provides the asynchronous mechanism for communication between address spaces** (the synchronous counterpart is cross-memory services with access registers)
- **The PC (PROGRAM CALL) instruction requires the schedulable work unit to exist as a TCB or an SRB**

**So**: executing code with no traditional "thread-creation graph" is not necessarily an anomaly.

## 2. Three address spaces: home / primary / secondary

- When a program is first dispatched, **home and primary are the same**
- **home is the address space in which that TCB / SRB was originally dispatched, and it stays unchanged for the whole execution**; **`PSAAOLD` always points at home** (hardware does not change it)
- **primary**: the address space whose segment table is used to fetch instructions; **secondary** is used for data access in secondary ASC mode
- Fetch rule: primary / secondary / AR mode fetch from **primary**; home mode fetches from **home**; real mode fetches from real storage

## 3. The PC instruction and space switch

- **PC-SS (space switch)**: the address space switched to becomes **primary**, secondary is usually set to the old primary, and **home does not change**
- **A PC routine always runs under the TCB / SRB that issued the PC**
- Two linkage styles: **basic PC** (manually save / restore the caller's environment, return with PT) and **stacking PC** (the system saves the environment on the linkage stack, return with PR)
- A PC is defined through an entry table and a linkage index; the PC number is the linkage index concatenated with the entry-table index

## 4. AR (access-register) mode

- Each general register has an AR; the **ALET** placed in the AR **identifies the target address space**
- **Special ALETs: 0 = primary, 1 = secondary, 2 = home**
- AR mode can communicate with up to 16 address spaces, **and it can call an SVC** (that is where it beats basic cross-memory)

## 5. Constraints and the classic fault

- **Cross-memory services require APF authorization**; the remote address space **must be non-swappable**
- **Using a TCB pointer across address spaces is a classic cause of S0C4-11** — a TCB **is not at the same virtual address** in different address spaces
- In cross-memory mode (primary ≠ home), the work unit's user identity is taken from the **home ASCB or the TCB / SRB**

## 6. Executable material: load module / program object

| Form | Notes |
|---|---|
| **load module** | the traditional linkage-editor product |
| **program object** | the newer form; it can live in a **PDSE**; **a z/OS UNIX load module lives in a PDS** |
| Link | linkage editor / program binder; the link-library list decides where resolution comes from |

**AMODE / RMODE (every program object carries them)**:

- **AMODE**: which hardware addressing mode the program supports — 24 / 31 / **ANY** / **64**
- **RMODE**: **where the program object lives** — 24 (below 16 MB) / **ANY** (below or above)
- **Both the program object and the running program have an AMODE attribute**; language-runtime options and compiler options together affect AMODE / RMODE behavior and storage location
- In some cases AMODE 24 execution is restricted and 31 must be used

**XPLINK vs non-XPLINK (the key when judging stack / calling convention)**:

| | XPLINK | non-XPLINK |
|---|---|---|
| Stack growth | upward | downward |
| Stack unwind | the **BACKCHAIN** compiler suboption | a backchain pointer |
| Stack pointer | GPR4, **with a 0x800 bias** | ordinary |
| Parameter passing | parameters in registers / the caller's DSA (STOREARGS) | R1 points at the parameter list |

- The runtime **automatically inserts glue** between XPLINK and non-XPLINK; **conversion between the two is supported only in the 31-bit case**
- The conversion can be observed with a dedicated trace option (trace-item types distinguish entry / exit)
- Paths that are **not supported** include: a COBOL dynamic call of an XPLINK function, FETCH in some languages, and some load services

**Reversing meaning**: **the same code has reversed stack behavior under the two conventions** — seeing "the stack grows upward" or "the stack pointer has a bias" is not corruption; confirm whether it is XPLINK first.

## 7. Supervisor services and SVC

- System services are provided through **SVC** and interrupt handlers; the **SVC table** is where system-service entries are located
- Related to SVC is an `SVC`-type dump (alongside a standalone dump)
- The **PC table** (program-call entry table) is likewise a locatable static structure

## 8. Diagnosis and dumps

- There are **several dump types** (including an SVC dump and a standalone dump), produced by the dump-management mechanism
- **IPCS** is the **tool for offline dump analysis**: define / select a dump, and a set of dump commands; used together with **SLIP** (automated diagnostic action) and **GTF** (trace)
- **Under XPLINK there are fewer control blocks than in 31-bit**, so **IPCS's LEDATA view is especially important**: it can give a traceback and the DSA hierarchy (the same class as the dump services the language runtime provides)
- The language runtime also provides dump / traceback / SNAP-class services and a trace-table tool
- **Trace-table contents are presented in EBCDIC**; the runtime also provides a service to switch ASCII / EBCDIC character mode

**Reversing meaning**: given a scene, confirm the **dump type** and "whether it is XPLINK" first — the latter decides which control blocks to look for, and where the traceback comes from.

## 9. Character set and the record model

- **Characters are EBCDIC** (not ASCII) — string constants, logs, and trace tables are all handled that way
- **Record model**: data-set structure, record format, and VSAM are a separate set of z/OS data-management concepts; **do not apply a POSIX byte-stream file**

## Decision tree

```
Got a z/OS target
├─ what is the unit of execution
│    ├─ a TCB (a task inside an address space) or an SRB (a system-service request)
│    ├─ an SRB cannot call an SVC (except ABEND) and cannot WAIT
│    └─ no thread-creation graph ≠ an anomaly
├─ addresses do not line up
│    ├─ distinguish home / primary / secondary
│    ├─ after a PC, primary ≠ home is normal, and home does not change
│    └─ instruction fetch comes from primary (except home mode)
├─ stack behavior looks reversed
│    ├─ confirm whether it is XPLINK first (stack grows upward, stack pointer has a 0x800 bias)
│    ├─ XPLINK ↔ non-XPLINK conversion is 31-bit only, and needs glue
│    └─ do not call the difference between the two conventions stack corruption
├─ the program will not load / will not run
│    ├─ check AMODE (24/31/ANY/64) and RMODE (24/ANY)
│    └─ look at both the program object's attributes and the running program's
├─ passing data across address spaces
│    ├─ basic cross-memory (needs APF authorization; the remote side must be non-swappable)
│    └─ or AR mode (ALET 0/1/2; can call an SVC)
├─ a fault such as S0C4-11
│    └─ check whether a TCB pointer was used across address spaces
├─ scene diagnosis
│    ├─ confirm the dump type; under XPLINK there are fewer control blocks → rely on LEDATA
│    └─ read characters as EBCDIC
└─ data access
     └─ the record model (data set / record format / VSAM) ≠ a POSIX byte stream
```

## Tools and verification

- Unit of execution: the distinction between TCB and SRB; the SRB's dispatch path (local / global)
- Address spaces: the current values of home / primary / secondary and the switch points (PC / PR / PT / SSAR)
- Program attributes: AMODE, RMODE, and whether XPLINK, for the load module / program object; the library type it lives in (PDS vs PDSE)
- Diagnosis: dump type, the IPCS view (under XPLINK, look at LEDATA in particular), the trace table
- Verification: be able to state together "whether the work unit is a TCB or an SRB + who primary / secondary / home currently are + which addressing mode and calling convention this code runs under"

## Pitfalls on this platform

- **Forcing the TCB / thread model onto it**: an SRB is another kind of schedulable unit, with completely different constraints
- **Assuming every execution has a thread-creation graph**: an SRB is triggered by an event
- **Mixing up primary and home**: after a PC they differ, and home never changes
- **Using primary's address to explain authority in cross-memory mode**: identity comes from the home ASCB or the TCB / SRB
- **Reusing a TCB pointer across address spaces**: the classic cause of S0C4-11
- **Forgetting that an SRB cannot WAIT / cannot call an SVC**
- **Calling XPLINK stack behavior corruption**: the direction is reversed, the stack pointer has a bias, and the unwind mechanism differs
- **Ignoring that conversion between XPLINK and non-XPLINK is supported only in 31-bit**
- **Looking only at the program object and ignoring the running program's AMODE**: both have that attribute
- **Looking for the scene from a 31-bit control-block list under XPLINK**: there are fewer control blocks; look at the LEDATA view
- **Treating strings and trace tables as ASCII**: here they are EBCDIC
- **Treating a data set / record format as a byte-stream file**

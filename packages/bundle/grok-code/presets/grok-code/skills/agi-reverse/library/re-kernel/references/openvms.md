# OpenVMS: AST / $QIO / condition handling / image activation and shareable images

<CORE RULE>
OpenVMS has **two asynchronous / exceptional control flows**, and reversing has to add both to the graph:

```
AST (Asynchronous System Trap)  → asynchronous control flow driven by an external event
condition handling              → control flow of exception / status propagation
```

Add one more layer of **image-activation** semantics (logical names, shareable images, global sections) — only when the three stack together can you explain "who calls this code, and where this image came from".
</CORE RULE>

## 1. $QIO and event flags

The key parameters of `SYS$QIO`:

| Parameter | Role |
|---|---|
| `efn` | the event-flag number **set** on completion |
| `astadr` | the **AST routine address** executed on completion |
| `astprm` | the parameter passed to the AST routine |
| `iosb` | the I/O status block that receives the final status |

- **The event flag is cleared when the request is issued**; it is set on completion
- `iosb` is technically optional, but **it should not be treated as optional** — concurrent asynchronous events each need their own IOSB

## 2. Completion order and control flow

```
① write the IOSB   →   ② set the event flag   →   ③ deliver the AST
```

- When `astadr` is specified, on completion the system **interrupts the process and hands control to the AST routine**; when the routine ends, **control returns to the point that was interrupted**
- **An event flag being set ≠ this I/O completed**: a wait service waits on the flag, and another operation can set it too; completion is judged by a synchronous wait plus the IOSB
- **A `W` suffix = the synchronous version**

## 3. AST semantics

- An AST is like a subroutine call, but it is **delivered asynchronously regardless of the main-flow context**; code shared by the main line and an AST **must be reentrant**
- **An AST does not abort a system call in progress**
- When the process is hibernating or waiting on a wait service: AST delivery **temporarily removes the process from the wait** to run the AST, and when that finishes **the original wait call is executed again**

**So**: `a wait that looks like it "returned and then waited again" is not loop corruption` — that is normal behavior of this model. The only way out of that loop is a wake or setting the event flag.

- In the same access mode, an AST **cannot be preempted by another AST of the same access mode**, but **it can be preempted by an AST of a more privileged access mode**
- A **special kernel-mode AST** is the standard mechanism for obtaining process context: the next time that process is scheduled, it runs at the process's highest priority

## 4. Disabling ASTs

- A dedicated system service can turn AST delivery off / on for **the current and all less-privileged access modes**
- A very short critical section can use **two flag bits in per-process P1 space** instead, to avoid the cost of a service call: the delivery code sets the "disabled" bit, and if the first bit is already set it sets the second bit and **does not deliver**; user code later checks the second bit and re-enables

## 5. Condition handling: the control flow of an exception

**Signals and handlers**:

- A routine can **return a completion code** (in R0, judged by bit 0) or **explicitly signal** a condition
- **The condition-handling facility (CHF) calls enabled condition handlers in order**; a signal copies the argument list and builds the signal argument vector passed to the handler
- **Details of handler-chain behavior** (remember these when recovering control flow):
  - If a second exception occurs while a handler is still active, **CHF skips frames already searched**, and adjusts the depth value passed to the handler
  - **A handler established through an exception vector is called on every exception (it is not skipped)** — be careful establishing a handler that way when several signals are in flight
- **After the handler returns, CHF acts on the return status**: signal another condition / **continue** / **resignal (keep searching for the next handler)** / **unwind**

**So**: exception flow is not two stages of "throw — catch". It is **a chain that can continue, can be redelivered, and can unwind**.

## 6. Two ways to establish a handler (including language differences)

- One way **moves the handler address into longword 0 of the caller's stack frame** (that is `SF$A_HANDLER`) and returns the old value; **it stays in effect until it is restored explicitly, or until control returns to the routine that called the establish routine**
- It **modifies the caller's stack frame**, and is provided mainly for **languages with no built-in error handling**; **it should not be mixed with a language that has a predefined handler** (the result is unpredictable); in hand assembly the equivalent is writing the handler address at frame-pointer offset 0
- **It is not available on native Alpha and I64 programs**, but most language compilers **recognize and map** it:
  - Each procedure can identify a handler with the handler field in the **procedure descriptor** (Alpha); on I64 it is identified by the handler field of the **unwind information block**
  - It is not in the I64 runtime; each language handles it separately (some treat it as built-in, some turn it into a runtime entry point, some provide their own establish / restore built-ins)
  - **The 32-bit signal-array format is the same on VAX and I64, but the condition code and the mechanism-array format differ** (quadword elements, extra registers, the depth value)
- **A C program must use the C runtime's own establish interface**: it catches exceptions related to the C runtime and forwards the ones you do not want to handle to your handler; **using the generic interface with `setjmp` / `longjmp` is undefined behavior**
  - For an exception to generate a UNIX-style signal, the user handler must return "resignal"; returning "normal" **prevents** a UNIX-style signal from being generated
  - Calling with a null pointer cancels an existing handler in that routine

## 7. The default handlers established at image startup

**Every time a new image is started, the operating system establishes default condition handlers** (a set of three, and the order matters):

1. **traceback handler** — established **after** catchall, so it **gets control first**; through message-output and formatting services it gives the error message and a symbolic traceback, and decides to continue or exit by condition severity
2. **catchall handler** — built in **the first stack frame**, and **called last**
3. **last-chance handler** — established through the system exception vector; **called only when the stack is invalid, or when every stack handler resignals**; **if a debugger is present, the debugger's own last-chance handler replaces the system's**

**Only these three output an error message.**

## 8. Image activation and shareable images

- **Redirecting a shareable image**: **use a logical name equal to that shareable image's file name** — the image activator uses that logical name to find the target file, so the implementation can be replaced **without relinking**
- The default directory for a shareable image is **`SYS$SHARE:`** (not `SYS$LIBRARY:`, even though the two currently point at the same set of directories)
- The logical name must match both "the input file specification used at link time" and "the name used at install time"
- There is a routine that **dynamically activates a shareable image into the process's P0 space**
- **Limits on a privileged / execute-only image** (security analysis hits these often):
  - When activating a privileged image, **only logical names in the system logical-name table that have the executive attribute are considered**
  - **The image being activated, and the shareable images and message sections it references, must be installed as "known images"**
  - An execute-only image (execute right, no read right) is under **the same limits as a privileged image**; a dedicated qualifier (meaningful only for the main program) allows activation of a shareable image the user can execute but cannot read
  - In this restricted mode, **RMS uses only "trusted" logical names** (created in exec / kernel mode); **user-mode and supervisor-mode logical names are not trusted**; redirection in the process / group logical-name tables is ignored

## 9. Sections and the calling standard

- Specifying **shared** when installing an image creates **global sections** for it; otherwise it is mapped as **private sections**
- A shareable image can be installed so its global sections **reside in multiport memory** (that needs the matching privilege)
- **A known image (and its global sections) is deleted only after every process using it has released it**; a writable global section is written back to disk when removed
- The calling standard shows up in the parameter and return conventions: **the return value is a condition value**; a parameter can be **by descriptor**, by reference, or by value; descriptors have class requirements (on VAX some must be a specific class); a routine such as a symbol lookup **adds the shareable image's start address when it returns a symbol's virtual address**

## 10. RMS and file-specification parsing

- Many functions **parse the file name and the default name separately** (rather than concatenating them into one full specification)
- The default device / directory and the default file type (for example `SYS$SYSTEM` / `EXE`) are supplied by the caller or by the routine
- **A known-image lookup ignores the version number** and always uses the highest version that exists; **the install command's specification is not allowed to name a version**

## Decision tree

```
Got an OpenVMS target
├─ a routine has no caller but has behavior
│    ├─ check whether it was passed as astadr to an asynchronous service → add an AST edge
│    └─ check whether it is a condition handler → add a condition-handling edge
├─ the completion path is incomplete
│    └─ add: write the IOSB → set the event flag → deliver the AST
├─ exception handling is incomplete
│    ├─ the handler chain: three destinations, continue / resignal / unwind
│    ├─ on a second exception, CHF skips frames already searched
│    └─ the three default handlers (traceback / catchall / last-chance)
├─ a wait "returned and then kept waiting"
│    └─ after AST delivery the original wait is executed again; that is normal
├─ a shareable image's behavior does not match the expectation
│    ├─ does the logical name match the file name (the redirection mechanism)
│    ├─ the default directory is SYS$SHARE
│    └─ under a privileged / execute-only image: it must be installed as a known image, and only trusted logical names count
├─ parameter / return-value parsing is misaligned
│    └─ follow the calling standard: condition value + descriptor class + by reference / by value
└─ a file will not open / the one found is not that one
     └─ RMS parses the file name and the default name separately; a known-image lookup ignores the version number
```

## Tools and verification

- Asynchronous registration sites: the `astadr` / `astprm` / `efn` / `iosb` parameters of an asynchronous service
- Condition handling: where the handler is established (stack-frame field / procedure descriptor / unwind information block), the handler's return value, the default set of three
- Image: the image activator and logical names (default directory, redirection rules), known-image install state, global / private / message sections
- Calling standard: descriptor class, parameter-passing method, the returned condition value
- Verification: be able to state together "which AST edge this I/O's completion comes back on + which handler layer an exception takes + where this image was activated from, and whether the section is global or private"

## Pitfalls on this platform

- **Treating an AST routine as dead code with no caller**
- **Explaining the completion path with a synchronous call graph**: the AST edge must be added
- **Treating "a wait returned and then waited again automatically" as a broken loop**
- **Treating an event flag being set as that I/O having completed**
- **Ignoring the IOSB**: concurrent asynchronous events must each use one
- **Assuming an AST aborts a system call in progress**
- **Treating an exception as two stages of "throw — catch"**: it is actually a chain that can continue, be redelivered, and unwind
- **Ignoring "a second exception skips frames already searched"**: the handler's depth value changes
- **Treating a handler established through an exception vector as called only once**: it is called on every exception
- **Mixing the stack-frame style of establishing a handler into a language with built-in error handling**: the behavior is unpredictable
- **Using the generic interface with setjmp / longjmp in C**: undefined behavior; the C runtime's own interface must be used
- **Looking up a shareable image by file name and ignoring logical-name redirection**: what you see may not be the one you think
- **Expecting an ordinary logical name to take effect under a privileged / execute-only image**: only trusted logical names count, and a referenced shareable image must be installed
- **Reading parameters and records as ASCII / a byte stream**: the calling standard and RMS specification parsing each have their own rules

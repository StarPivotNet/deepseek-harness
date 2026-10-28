---
name: re-binary-core
type: gateway
description: >
  Software-reversing core gateway (the shared base). Orchestration: survey → format parsing → decompile → debug/trace → memory.
  Sub-skills: [[re-address-space]] [[re-triage]] [[re-format-pe]] [[re-format-elf]] [[re-format-macho]]
  [[re-imports]] [[re-ghidra]] [[re-ida]] [[re-radare2]] [[re-gdb]] [[re-x64dbg]]
  [[re-lldb]] [[re-tracing]] [[re-memdump]] [[re-windbg]] [[re-binaryninja]]
  [[re-emulation]] [[re-shellcode]] [[re-kernel]] [[re-game]] [[re-go]] [[re-rust]]
  [[re-plugin-dev]] [[re-hypervisor]] [[re-anti-cheat]], [[re-cpp-abi]], [[re-swift]], [[re-zig]],
  [[re-nim]], [[re-fp-runtime]], [[re-variant]], [[re-mips]], [[re-arm]], [[re-riscv]].
  Triggers: `静态分析`, `看这个程序的逻辑`, `反编译`, `逆向这个二进制`, binary analysis.
capabilities: [decompilation, debugging, memory-dump, elf-parser, pe-parser, macho-parser]
---

# Software-reversing core

## Full workflow

1. Environment: probe + preferences (if you did not enter through [[re-analyze]], do that first and read the `RE_*` session variables)
2. Survey: [[re-triage]] (capability: `triage`) — file/hash/entropy/strings, confirm the file type and architecture
3. Format parsing: by type, [[re-format-pe]] (capability: `pe-parser`) / [[re-format-elf]] (capability: `elf-parser`) / [[re-format-macho]] (capability: `macho-parser`)
4. Imports and exports: [[re-imports]] (capabilities: `pe-parser`, `elf-parser`) — library fingerprints, IAT/symbols, identify what was linked
5. Decompile: by `RE_DECOMPILER`, [[re-ghidra]] (capabilities: `decompilation`, `debugging`) / [[re-ida]] (capabilities: `decompilation`, `debugging`) / [[re-radare2]] (capability: `decompilation`; if not installed → install per that skill's "Tool preparation"; Ghidra is the default recommendation)
6. Dynamic (as needed, sandbox by default): [[re-gdb]] (capability: `debugging`) / [[re-x64dbg]] (capability: `debugging`) / [[re-lldb]] (capability: `debugging`; by OS) + [[re-tracing]] (capability: `tracing`) + [[re-memdump]] (capability: `memory-dump`)
7. Output: conclusion / report (per `RE_REPORT`)

## Analysis methodology

Generic analysis methodology that applies to this gateway (from user practice). Skill pitfalls cite this section.

### Entry analysis

- **R1 The entry point ≠ main**: the EP is the init entry, and it reaches main only through CRT/TLS/loader
- **R2 A string cross-reference beats guessing a function**: a key string → walk XREFs backward
- **R3 No strings ≠ no logic**: encoding/hash/runtime concatenation/decrypt generation; trace the use point
- **R4 An abnormal function boundary → check a decompiler illusion**: hand-written assembly / obfuscation / a tail call / no frame pointer; do not fully trust the decompiler

### Call analysis

- **R5 Few calls ≠ simple logic**: indirect calls through function pointers / vtables / callbacks / a switch jump table
- **R6 An abnormal indirect call → check where the function pointer comes from**: trace the target-address source in a register/memory
- **R7 Virtual-function analysis → find the vtable first**: object pointer → vptr → vtable → the function set

### Memory and data structures

- **R8 Do not identify a struct only from field accesses**: combine the init site / lifetime / uses in several places
- **R9 Track an object's lifetime with malloc/free**: the create point and the free point fix the meaning
- **R10 For a global, find references first, not the definition**: the global area is noisy

### API / behavior

- **R11 An API call is a result, not the logic**: analyze the argument source and the call context
- **R12 Exception handling may be control flow**: SEH / a C++ exception / a signal handler carries a normal transfer
- **R13 The syscall layer is more trustworthy than the API**: when it is hooked / wrapped / replaced, follow it down to the syscall

### Obfuscation analysis

- **R14 Control-flow flattening → look at the state variable**: dispatcher + state variable + case blocks
- **R15 A high proportion of junk code → do not analyze it instruction by instruction**: find external effects / data flow / real calls
- **R16 An opaque predicate → verify whether the condition is constant**: a always-true / always-false judgment

### Dynamic debugging

- **R17 A breakpoint that does not fire → it may still have executed**: self-modifying code / memory remapping / an exception mechanism / an anti-debug bypass
- **R18 An abnormal single-step → check anti-debug**: the trap flag / timing detection / exception handling
- **R19 When you see decrypted data → save it immediately**: the next stage may wipe it

### PE/ELF depth

- **R20 The memory layout matters more than the file layout**: the mapped state after the loader is the runtime truth
- **R21 Section names are not trustworthy**: look at permissions / entropy / contents
- **R22 Relocation information affects a dump**: when addresses disagree, check relocation first

### Intelligence and survey

- **R23 The three tables first**: file (format) → per-region entropy (the distribution of code/data/ciphertext) → strings (**scan both wide and narrow characters**; a packer converts to wide strings) — finish these three steps before any deep dive, and avoid 80% of directional mistakes
- **R24 Sample entropy by region**: a whole 4KB at entropy 7.9 ≠ all ciphertext — the entry region's 64B at entropy 5.6 may be real code; scan with a 64B/1KB window to find the plaintext/ciphertext boundary; **high entropy ≠ encryption**: it may be compression, VMProtect mutation, or data; rule out compression and obfuscation before judging encryption
- **R25 The import table has two faces**: (a) a tiny import table (a few functions) = a packer / dynamic-resolution signal; (b) **dead imports**: the IAT has stubs but .text has zero call sites = LoadLibrary+GetProcAddress dynamic loading, and the static-import conclusion is void; (c) **an import-table count ≠ the API surface**: a COM interface (d3d11 and similar) has 1 import behind hundreds of vtable methods, and the real call surface is always outside the import table
- **R26 A build path / a log function name is the strongest intelligence**: `G:\BuildAgent\...\Graphics_Renderer_D3D11.cpp` leaks the whole renderer architecture; `Renderer::CreateAdapter()` recovers the init chain — prefer this over guessing functions

### Disassembly method

- **R27 Linear disassembly must drift**: a PE code section embeds a jump table, and decoding in order from the section head is garbage by the middle; the immune approach = **a byte-by-byte pattern scan** (recognize only the FF15/FF25 call/jmp [rip] and 8B/8D mov/lea [rip] patterns, and compute the target address from the raw bytes as `next_ip + disp32`, not the decoder's displacement field)
- **R28 When the decompiler hangs, downgrade decisively**: treating a ciphertext/obfuscated region as code for function analysis explodes exponentially (4 cores for 8 minutes) — limit the analysis range (-analysisTimeoutPerFile) or switch to a hand-written decoder; do not wait
- **R29 Cross-check tool blind spots**: objdump silently skips an abnormal section flag (MEM_NOT_PAGED), iced-x86's RIP-relative displacement returns a non-raw value, and readelf errors out and stops on a forged header — every tool has a blind spot; two independent tools parsing the same data, and a disagreement means something is wrong
- **R30 Judge entry bytes as real or fake**: `e8 xx xx xx xx` (call) + `0f 05` (syscall) can look like code and still be a random coincidence — decode 30 instructions in order, and an instruction of the `fcom`/`int 88h`/`ret far` class means it is fake

### Verification

- **R31 A static conclusion must be backed dynamically**: "it runs" ≠ "it is correct" (relocation correctness can be proved only by reading the memory slot at runtime); a byte-by-byte check can prove only "the implementation matches the spec", not "the spec is correct" — on the dynamic side, read the slot from live memory and compare it with the value stored in the file
- **R32 Two independent tools parse the same data**: compare the addend with the value stored in the file, the symbol address with nm output, and the RVA with objdump — a disagreement means something is wrong; do not trust a single tool's output
- **R33 Dynamic work is minimally invasive**: a DLL-hijack proxy (record the call sequence) > a debugger > an instrumentation framework; if you can avoid modifying the target binary, do not modify it; **dynamic analysis is always sandboxed** (firejail/bwrap + no network + a disposable environment)

### Getting knowledge

- **R34 Look up a format offset in the spec, do not rely on memory**: field-class knowledge such as the PE32+ data directory at oh+112 (+96 is SizeOfHeapCommit) and TEB offsets — memory will get it wrong; the MS spec / ELF gABI is the only authority (concrete values are in the domain experience of [[re-format-pe]]/[[re-format-elf]])
- **R35 An open-source implementation is the second authority**: look up the TEB layout in Wine's winnt.h, and syscall semantics in the ReactOS source — more reliable than a blog, and cross-checkable

## Which atomic skill to use (selection tree)

- You just received a file and do not know what it is → [[re-triage]] (capability: `triage`)
- You know it is PE / ELF / Mach-O and need to understand the structure → the matching format skill
- You need to know which libraries/APIs the program linked → [[re-imports]] (capabilities: `pe-parser`, `elf-parser`)
- You need to read function logic → one of four decompilers ([[re-ghidra]] (capabilities: `decompilation`, `debugging`) is the default; [[re-ida]] (capabilities: `decompilation`, `debugging`) / [[re-radare2]] (capability: `decompilation`) / [[re-binaryninja]] (capability: `decompilation`))
- You need to watch runtime behavior and set breakpoints → pick a debugger by OS (Linux [[re-gdb]] (capability: `debugging`), Windows [[re-x64dbg]] (capability: `debugging`) / [[re-windbg]] (capability: `debugging`), macOS [[re-lldb]] (capability: `debugging`))
- You need to trace syscalls/function calls → [[re-tracing]] (capability: `tracing`)
- You need to read/dump process memory → [[re-memdump]] (capability: `memory-dump`; dump by default; see [[re-analyze/platform-tips]])
- The target is a driver/kernel module/rootkit → [[re-kernel]] (capability: `kernel-analysis`; with [[re-windbg]] (capability: `debugging`) kernel debugging)
- The target is a hypervisor/VMM/virtualization-detection related → [[re-hypervisor]] (capability: `hypervisor-analysis`; VT-x/SVM, VMCS/EPT)
- The target is an anti-cheat component (an EAC/BattlEye driver, a memory integrity check) → [[re-anti-cheat]] (capability: `kernel-analysis`; driver analysis + kernel debugging; mind the authorization boundary)
- The target has no environment / unpack assistance, and needs emulated execution → [[re-emulation]] (capability: `emulation`)
- The target is shellcode (a raw code blob with no file-format header: extract / a decode loop / emulated execution) → [[re-shellcode]] (capability: `shellcode-analysis`)
- The target is a game (Unity/Unreal, CE memory edits) → [[re-game]] (capability: `game-analysis`)
- The target is a Go binary (language specialty: symbols / string table / goroutine) → [[re-go]] (capability: `lang-runtime-analysis`)
- The target is a Rust binary (language specialty: symbol demangle / generic expansion / ownership) → [[re-rust]] (capability: `lang-runtime-analysis`)
- **The target is C++ (dense RTTI/exception tables)** → [[re-cpp-abi]] (capability: `decompilation`; RTTI/vtable/exception recovery)
- **The target is a Swift artifact ($s mangling features)** → [[re-swift]] (capability: `lang-runtime-analysis`; mangling/witness table/closure capture)
- **The target is a Zig artifact (no RTTI/exception table, panic-function features)** → [[re-zig]] (capability: `lang-runtime-analysis`; comptime/error paths)
- **The target is a Nim artifact (NimMain/NimString features)** → [[re-nim]] (capability: `lang-runtime-analysis`; runtime/string structure)
- **The target is a Haskell/OCaml artifact (GHC RTS/OCaml block features)** → [[re-fp-runtime]] (capability: `lang-runtime-analysis`; closures/data flow)
- **A patch/N-day comparison (before and after a fix / variant association)** → [[re-variant]] (capability: `binary-diffing`; function matching / patch diff)
- You need to write a Ghidra/IDA script or plugin (batch annotation / a decrypt loop / custom format parsing, engineering a script into a plugin) → [[re-plugin-dev]] (capability: `plugin-development`)
- You suspect a packer → go to [[re-anti-analysis]] (capabilities: `unpack`, `deobfuscation`, `evasion-analysis`)

## Cross-domain joins

- [[re-mobile]]: analyzing a mobile app's native .so library → this gateway's [[re-format-elf]] + [[re-ghidra]] (the specialty is [[re-android-native]])
- [[re-hypervisor]] / [[re-anti-cheat]]: reversing a hypervisor and an anti-cheat driver uses this gateway's skills as the base ([[re-kernel]] / [[re-windbg]] kernel debugging)
- [[re-ctf]]: a CTF reversing challenge → this gateway's skills are the base
- [[re-anti-analysis]]: obfuscation/a packer found statically → enter the unpack domain
- [[re-shellcode]]: specialty analysis of a shellcode payload (extract/decode/emulated execution) → the decompile base is this gateway ([[re-radare2]] / [[re-ghidra]])
- This gateway's skills are cited by the [[re-malware]] deep-reversing step

## Common pitfalls

- Memory detected under 4GB and you still pick Ghidra → suggest [[re-radare2]]
- strings output is disturbed by encryption/compression → use entropy (re-triage) to decide whether to unpack first
- Before a direct read of `/proc/<pid>/mem` you must check maps (see [[re-analyze/platform-tips]])

### Unknown formats and emulated execution

- **An unknown / heavily modified format: let the target's own parser answer, do not do archaeology by hand**: symptom — a hand-written parser of a modified bytecode/resource/protocol format is misaligned again and again; cause — the target vendor modified the format, and the public docs have drifted from the implementation; fix — find the component inside the target that can load that format (its own VM, a parser library), and use it to "compile/load/export" a same-source artifact (for example compile its bytecode with the target's own Lua VM); format-compatibility problems go to zero — the generalization of "if it runs, do not reverse it"
- **Emulating a target function: separate its dependencies first**: symptom — calling the function in the emulator reports unmapped memory / an out-of-bounds access; cause — the function references the module's static area / global state, outside the mapped range; fix — prefer a pure computation function with no global dependency (a static getter, a pack/unpacker) as the verification target; for a function that really needs globals, fill in the memory map at the referenced addresses and then call it
- **A patch-script resource: produce an isomorphic artifact with the target's compile pipeline**: symptom — bytecode or a resource produced by a third-party compiler/packer fails to load in the target or behaves abnormally; cause — the compiler version/configuration does not match the target; fix — prefer the target's own compile/pack capability (an exported compile API, a `dump`-class function) to generate the patch artifact
- **Byte layouts are always parsed by a script + assertions**: symptom — hand-counted hex offsets are misaligned across the board (the magic length was miscounted, a field offset is off by 1); cause — eye-counted offsets are unreliable; fix — parse the header/fields with a script and add assertion checks; when the parser output contradicts a tool, first verify that the tool itself works as expected (an alias/wrapper/argument may change behavior, such as a grep wrapper that skips binary contents)
- **An indirect-jump flattened main function**: symptom — the decompiler recognizes only the CFG of the front of the function, and stops at the dispatcher; cause — an indirect BR jump table (control-flow flattening); fix — enumerate real basic blocks by the jump-table formula `target = (table_entry + fixed_delta)`, and do not rely on the default CFG; when the symbol length is much larger than the CFG-recognized length, check the BR/BLR indirect table first
- **A per-function XOR string decryptor**: symptom — a string scan sees only a few paths; cause — the text uses a loop XOR that is independent per string; fix — recognize the layout "the first N bytes are the key + the following M bytes are ciphertext", extract the key/output length from the decryptor instructions, and replay the algorithm statically (local constant propagation on a flattened block is enough to recover the indirect target and the string source address; you do not need to fully deflatten first)
- **Safely expanding a self-extracting archive**: symptom — the unpack target contains a malicious path; cause — a path inside the archive can be constructed; fix — check each member and then write it out (reject an absolute path, `..`, a link, a device node); do not execute it directly, and do not trust member paths
- **Locating a compressed payload**: symptom — searching for a compressed stream only by magic misses it; cause — the magic is not unique / was obfuscated; fix — do a full decompress test on candidate offsets (a valid-stream check), and do not look only at the header
  (source: reverse-skill field-journal, MIT)

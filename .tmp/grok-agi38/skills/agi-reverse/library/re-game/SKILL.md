---
name: re-game
description: >
  Game reversing: Unity/Unreal, Cheat Engine, Lua script engines, graphics shaders. Triggers: `游戏逆向`, Unity, Unreal, Cheat Engine, `内存修改`, `反作弊`, Lua, LuaJIT, .luac, .jsc, `脚本引擎`, Shader, `着色器`, SPIR-V, DXIL, DXBC, GLSL
capabilities: [game-analysis]
---

# Game reversing (Unity / Unreal / Lua script engines / graphics shaders)

## When to use / when not to use

- Use: game-logic reversing (Unity mono/IL2CPP, Unreal); memory search and modification (CE value/pointer scan); function location and modification ([[re-patching]]); anti-cheat (EAC/BE) detection evasion (inside an analysis environment)
- Do not use: pure static reading of Unity mono logic (decompile `Assembly-CSharp.dll` directly with [[re-dotnet]]; this skill is not needed)
- Do not use: a mobile game ([[re-mobile]] / [[re-apk]] / [[re-ios]] / [[re-frida]])
- Do not use: you only want a finished trainer/cheat — this skill is an analysis path, not a release tool; online-match anti-cheat risk is on you
- Do not use: V8 bytecode .jsc of an Electron app (go to [[re-electron]])

## Tool setup

Anti-cheat game analysis defaults to a sandbox + isolation ([[re-analyze/platform-tips]] highest principle; [[re-sandbox]] is a mandatory precondition); dynamic debugging follows the OS branch.

### Cheat Engine (CE, Windows)

- Install: download and install from the cheatengine.org site (`choco install cheatengine` is optional)
- Verify: open CE, attach any process, and do a value scan (First Scan has results)

### Unity tools

- Il2CppDumper (IL2CPP recovery): GitHub `Perfare/Il2CppDumper` releases (Windows exe / dotnet tool)
- mono scene: no extra tool; hand `Game_Data/Managed/*.dll` directly to [[re-dotnet]] (dnSpy/ILSpy)
- Verify: Il2CppDumper can produce `dump.cs` (class/method signatures) and `script.json` (function addresses) from the target `global-metadata.dat`

### Unreal tools (the UnrealFinder approach)

- UnrealFinder (GitHub `povlhp/UnrealFinder` or the similar `Dumper-7`): locate global symbols such as `GObjects`/`GNames`, and export the UObject class tree and function addresses
- Verify: against the target UE game exe, it can list `GWorld`/`GNames` addresses and export the object list

### Debuggers (by OS)

- Windows: [[re-x64dbg]] (lightweight breakpoint debugging) or [[re-windbg]] (exception analysis)
- Linux: [[re-gdb]] (when running a Windows game under Wine, read Wine process memory; see the Wine direct-read approach in the [[re-analyze/platform-tips]] Linux branch)

## Procedure

Run in order. Archive each step (engine-identification evidence, address and offset records, dump-product sha256, [[re-triage]] evidence).

1. **Identify the runtime / engine**:
   - Directory signatures: `Game_Data/Managed/Assembly-CSharp.dll` → Unity mono; `Game_Data/il2cpp_data/` + `global-metadata.dat` → Unity IL2CPP
   - Unreal signatures: `Engine/Binaries/`, `*.pak`, `<game name>-Win64-Shipping.exe`; search strings for `GWorld`/`GNames`
   - Another / in-house engine → the ordinary [[re-binary-core]] flow; do not take this skill
   - Archive: engine type + version (decides later tool choice)

2. **Export Unity mono vs IL2CPP**:
   - mono: decompile `Game_Data/Managed/*.dll` directly ([[re-dotnet]]; opening Assembly-CSharp.dll in dnSpy/ILSpy yields all C# logic; the dynamic part of this skill is not needed)
   - IL2CPP (no managed DLL): export with Il2CppDumper:
    ```
    Il2CppDumper.exe <Game.exe> <Game_Data>/il2cpp_data/Metadata/global-metadata.dat
    → dump.cs（类/方法/字段签名） + script.json（方法地址） + il2cpp.h（结构体）
    ```
   Use `dump.cs` to locate the target method name, and `script.json` to take the matching function address → debug/patch that address in the exe ([[re-x64dbg]] / [[re-windbg]])
   - Archive: dump.cs/script.json + the target method address table

3. **Memory search (CE)**:
   - Value scan: attach the process → enter the current value `First Scan` → change the value in the game → `Next Scan` converges the address list
   - Pointer scan (addresses change under ASLR): on a located address, `What accesses this address` → record the accessing instruction's offset → `Pointer scan` generates a pointer chain (save a `.pt` file), still usable after restart
   - Multi-level pointer: a struct base looks like `Game.exe+0x2A3F4C → +0x10 → +0x28` — offsets are decided by the engine object structure (Unity looks at MonoBehaviour field order; Unreal looks at UPROPERTY offsets)
   - Modification verification: a memory edit or a CE Lua script freezes the value, and in-game behavior change is observed
   - Archive: the address expression (module+offset), the pointer-chain file, scan parameters

4. **Locate and modify a function**:
   - Code↔memory: on a key address, `Find out what writes to this address` → a breakpoint hits the write-code location → record the in-module offset → analyze that function at the matching address in a decompiler ([[re-ghidra]] / [[re-binaryninja]])
   - Or take the IL2CPP function address directly from `dump.cs`/`script.json` → decompile → modify ([[re-patching]]: change a jump/argument/return)
   - Test after modification: run inside a sandbox and verify the function took effect ([[re-sandbox]]); record the behavior difference before and after the modification

5. **Anti-cheat countermeasures (detection evasion, inside a sandbox)**:
   - Understanding: EAC/BattleEye detect a debugger's presence, memory-rewrite traces, CE/cheat traces, and multi-instance/virtualization signatures — the analysis environment is fully isolated from a real online environment (a dedicated VM + snapshot, [[re-sandbox]] + the [[re-analyze/platform-tips]] highest principle)
   - Means: statically analyze detection points first (the anti-debug approach in [[re-anti-analysis]]), hook/bypass detection APIs (NtQuerySystemInformation and similar), minimize modifications (restore after use), and avoid long-lived resident traces
   - Close: restore the snapshot after analysis; do not use it for online matches

## Game script engines (Lua / LuaJIT)

Game logic is often carried by the script layer (character behavior, skill values, level config). When the analysis object moves from the engine C++ side to script bytecode: identify the script VM and the exact version first, then take the bytecode-parse path for that version.

### Bytecode identification (header signature / version)

- Standard Lua bytecode header: `0x1B 4C 75 61` (`\x1bLua`) + a version byte — 5.0=0x50, 5.1=0x51, 5.2=0x52, 5.3=0x53, 5.4=0x54; from 5.3 the header contains format/checksum data and width fields for int, size_t, instruction, lua_Integer, and lua_Number, and the tail carries a checksum
- LuaJIT bytecode header: `0x1B 4C 4A` (`\x1bLJ`) + a version byte — 2.0=0x01, 2.1=0x02, followed by endianness and per-type width flags
- Memory-side identification: scan for the magic ([[re-memdump]]), or locate the interpreter by references to the interpreter version string (`Lua 5.x` / `LuaJIT 2.x`) and error messages (the `attempt to call a nil value` class)
- Archive: VM type + exact version + endianness/width parameters (they decide the parse path)

### Instruction structure

- Lua 5.1~5.3: a 32-bit instruction = opcode(6) + A(8) + B(9) + C(9); Bx is B|C concatenated (18 bits), sBx is signed
- Lua 5.4: opcode widens to 7 bits, A is 8 bits, B/C narrow to 8 bits and a k flag is added, Bx is 17 bits — a parse table from 5.3 and earlier cannot be reused
- LuaJIT: a 32-bit instruction has two formats — ABC format opcode(8) + A(8) + C(8) + B(8) (little-endian memory byte order is OP/A/C/B), AD format A(8) + D(16); there is no Bx field; the D field carries constant indexes and jump offsets (a jump offset is biased, D − 0x8000)
- Parse approach: take the instruction layout table by version, and split a 32-bit word into fields; a wrong layout-table version shows up as jump targets / register indexes going out of range
- A jump offset is in instruction-index units (not bytes); the baseline differs slightly by version; confirm it by version when parsing

### Locate the constant table / upvalue table

- A function prototype (Proto) has a fixed serialization order: source string → line numbers/parameters/vararg/maxstacksize → code segment → constant table → upvalue table → nested Proto → debug information; strings are length-prefix encoded, and the walk advances in order
- Constant-table value: numbers/strings inside the script (skill values, level config, a key used for a check) are directly readable, which is faster than recovering full semantics
- Memory side: take the Proto layout at a load/execute API, or search the heap by a known constant-value signature (a format string, a specific number)

### Disassembly approach (luac-class tools)

- Parse layer by layer as "header → instructions → constants/upvalues → nested Proto", and output pseudo-assembly (the `GETGLOBAL`/`CALL` class)
- When a ready parser does not support the target version, write a parser yourself by the field order above (small in scale); the core is a version-correct instruction layout table
- Products are used to: find the target function by constant-table string/number cross-references; change an instruction operand or a constant value to implement a modification (the [[re-patching]] approach)

### LuaJIT bytecode differences

- LuaJIT bytecode is incompatible with standard Lua 5.1 bytecode (language-level compatible, different instruction set); LuaJIT 2.0 and 2.1 are also incompatible with each other (opcode numbers/semantics changed)
- Bytecode is bound to the runtime: endianness, pointer width, and type widths are all written into the file header; a file dumped on another platform fails to parse if the environment is swapped directly
- Fix: strictly follow the `\x1bLJ` + version-byte LuaJIT parse path; prefer to finish a modification at the source/bytecode layer; do not carry it across versions

### Extract Cocos-family script resources (.jsc / .luac obfuscation variants)

- Cocos2d-x Lua scene: `.luac` is standard Lua/LuaJIT bytecode; common obfuscation variants are a truncated header (the `\x1bLua` magic deleted/changed) and a single-byte XOR of the whole file; encryption-class variants (the XXTEA scheme; when the ciphertext carries an `xxtea` start mark, decrypt first, then take the bytecode path)
- Cocos Creator scene: `.jsc` is JS-engine bytecode, and truncated-header/XOR variants are likewise common
- Fix (identify first, then unwrap): recover with a known magic as a crib — mask = the magic's matching byte XOR the file's first byte; after restoring the magic, parse by version; if truncated, pad the header bytes first; the method is isomorphic to the XOR chapter of [[re-fw-extract]] (the block-first mask and per-block period-transform approaches reuse directly)

### Hook a script function ([[re-frida]] / memory side)

- Load surface: `luaL_loadbuffer`/`luaL_loadbufferx`/`luaL_loadfile`/`lua_load` — a hook captures the raw bytecode/source, suited to changing script logic (replace bytecode, change constants)
- Execute surface: `lua_pcall`/`lua_pcallk`/`lua_call` — a hook captures arguments/return, suited to changing runtime behavior; LuaJIT also has an assembly call path that does not go through a C API wrapper
- Memory side: when not hooking, patch already-loaded bytecode directly (change a constant value/jump), or change the resource file and replace the load path
- Unsigned scene: locate the interpreter function address by a version-string / error-message reference

### Common pitfalls

- **Lua bytecode is incompatible across versions**: Symptom — dumped bytecode is garbage or fails outright when parsed by another tool/runtime; cause — Lua 5.1~5.4 and LuaJIT differ in instruction layout, header fields, and checksum data; the same version also splits by endianness/width, and 5.4 even changed the opcode bit width; fix — first judge the version and endianness/width precisely by magic + version byte, then pick the matching parse path; in a cross-version scene, find same-version source/interpreter and recompile for comparison; do not force a parse
- **A .jsc/.luac variant's magic was truncated**: Symptom — the file header is not `\x1bLua`/`\x1bLJ`, and parsing it directly as bytecode fails; cause — an obfuscation variant truncated or changed the magic (truncated header, single-byte XOR of the whole file); fix — identify first, then unwrap: recover the mask with a known magic as a crib (mask = magic byte XOR the byte at the matching file position) or pad the truncated header; after restoring the magic, parse by version; XXTEA-class encryption is decrypted by its encryption signature first, then takes the bytecode path
- **Hook-point choice: lua_pcall is not the only entry**: Symptom — hooking only `lua_pcall` misses some script behavior or fires repeatedly, and hooking a load-class API does not get the target script; cause — the interpreter has several call surfaces (`lua_call`/`lua_pcallk`/load-class APIs are each a surface), and LuaJIT also has an assembly call path that does not go through the C API; fix — decide the goal first: to change script logic, hook the load surface and take the bytecode; to change runtime behavior, hook the execute surface or memory-patch; when a hook cannot land, locate the interpreter's internal call site by a version-string / error-message reference
- **Jump-target conversion is wrong**: Symptom — a disassembled jump target address is absurd / out of range; cause — a Lua bytecode jump offset is in instruction-index units (not bytes), and the Bx bit width and baseline change with version (5.1~5.3 is the current instruction index + 1 + sBx); fix — confirm bit width and baseline by version; after conversion, check that the target lands inside the code segment

## Graphics and shaders

The usual goal of graphics-side reversing is: change a visible effect (color/parameters/culling), locate resource-binding and constant-update sites, and recover render-pipeline logic. The entry splits into the file side (shader resources) and the memory side (runtime load sites).

### SPIR-V disassembly (the spirv-dis approach)

- Magic 0x07230203 (file byte order 03 02 23 07); a word-stream structure: header (magic/version/generator/bound/schema) + an instruction sequence (each: word count + opcode + operands)
- Disassembly approach: split the instruction stream on word boundaries, and recover semantics such as OpFunction/OpEntryPoint/OpConstant/OpType*/OpDecorate
- Location points: OpEntryPoint fixes the entry (stage type + entry function), OpDecorate's DescriptorSet/Binding/Location fix resource bindings and vertex attributes, OpConstant fixes constant initial values (they can be changed directly)
- Generalization: the binary-IR parse pattern (magic → structure header → instruction stream → semantic table) is common across several GPU IRs; changing format only changes the magic and the instruction table

### DXIL / DXBC disassembly (the dxc approach)

- DXBC: the DX10/11 container format ("DXBC" magic + a chunk table); shader code is in the SHDR/SHEX chunk; input/output signatures and resource reflection are in chunks such as ISGN/OSGN/RDEF
- DXIL: DX12 SM6+ bytecode; the outer layer is still a DXBC container, and the inner "DXIL" sub-object is LLVM bitcode style — the parse path is completely different from DXBC
- Disassembly approach: judge the container/sub-object type first (DXBC chunk vs DXIL), then follow the matching format; mind the SM version (it decides the instruction set) and cbuffer reflection (name/member offset)
- Memory side: scan for the "DXBC"/"DXIL" magic to locate an already-compiled shader ([[re-memdump]]), or hook a create-class API and capture the bytes

### GLSL recovery (the spirv-cross approach, generalized)

- Recovery path: IR → target language (GLSL/HLSL/MSL); the approach is type reconstruction (OpType* → a language type) → semantic recovery (OpDecorate → layout/qualifiers) → expression reconstruction
- Recovery is lossy: reconstruction of loops/switch/optimized structure is incomplete; the recovered result is for reading and analysis, and cannot necessarily be recompiled as-is
- Generalization: an IR→source recoverer is organized in three passes, "type → declaration → function body"; changing the target language only changes the syntax-emission layer

### Find the render entry and locate the constant table

- File side: unpack a shader resource (.spv/.dxbc/.hlsl/.cso or an in-package resource) first ([[re-fw-extract]]), then disassemble by format; locate the load site in the binary by a load-API string reference (the glShaderSource/glCompileShader, CreateVertexShader/CreatePixelShader/CreateComputeShader, vkCreateShaderModule class)
- Memory side: hook a load-class API and capture the raw bytes (source or already-compiled bytecode), or scan a magic and dump ([[re-memdump]])
- Constant-table location: CPU-side update sites — the glUniform* family (a single-value uniform is indexed by location), the VSSetConstantBuffers/UpdateSubresource class, Vulkan's vkCmdPushConstants/descriptor-update class; GPU-side layout — a cbuffer is packed by struct-member offset + 16-byte alignment (there is padding between float4 arrays); a single-value uniform has no such rule
- Parameter-change entry: change the value at a constant-update site at runtime, statically patch a constant initial value inside bytecode, or change constant-table data

### Common pitfalls

- **Misjudging DXIL vs DXBC (SM6 vs SM5 take different paths)**: Symptom — parsing by DXBC's SHDR/SHEX fails, or disassembling by the DXIL path is garbage; cause — SM5.x and below is DXBC bytecode, SM6+ is DXIL (LLVM bitcode style), the parse paths are completely different, and a DXIL outer container is also the "DXBC" magic, so judging only by the container name misjudges it; fix — confirm the SM version first (reflection/RDEF or the compile config); SM6+ finds the "DXIL" sub-object inside the container and takes the DXIL path; SM5- takes the DXBC chunk path; the two paths are not interchangeable
- **SPIR-V has no function names (locate by entry point / resource binding)**: Symptom — the disassembly is all OpFunction/OpLabel numbers, and the target logic cannot be found; cause — a release build usually strips OpName/OpMemberName debug information; fix — fix the entry by OpEntryPoint (stage type + function reference), fix resources by OpDecorate's Binding/Set/Location, and locate the target fragment by a known OpConstant value signature (a matrix initial value / a threshold constant)
- **A shader constant table is conflated with a uniform buffer**: Symptom — a uniform update site found on the CPU side does not match the constant layout disassembled on the GPU side; cause — the same logic may take two paths: a single-value uniform (passed directly by location index) and a uniform/constant buffer (packed by struct-member offset + 16-byte alignment, including padding); fix — confirm the path from disassembly/reflection first (SPIR-V looks at OpDecorate Uniform/Block; DXBC looks at RDEF's cbuffer member table); a single value converts by location number, a cbuffer by member offset; do not mix the two packing rules

## Cross-domain joins

- [[re-binary-core]]: the static-analysis base for a game exe ([[re-format-pe]] and similar)
- [[re-dotnet]]: decompile Unity mono managed logic (the main tool on this skill's static side)
- [[re-patching]]: land a function modification (jump / byte-level patch)
- [[re-anti-analysis]]: anti-cheat detection countermeasures (reuse the anti-debug approach)
- [[re-sandbox]]: anti-cheat game analysis is mandatorily isolated (the [[re-analyze/platform-tips]] highest principle)
- [[re-mobile]]: a mobile game (Unity/Unreal mobile builds) hands off to [[re-apk]] / [[re-ios]] / [[re-frida]]
- [[re-cracking]]: bypass a single-player game's license/activation check
- [[re-console]]: game reversing for modern consoles (Switch/PS4/PS5) and retro platforms (ROM headers/cartridge formats/cheat codes)

## Common pitfalls

- **Looking for a DLL when IL2CPP has no managed DLL**: Symptom — `Game_Data/Managed/` has only a few DLLs or none, and decompilation cannot find the target logic; cause — IL2CPP compiles C# into a native binary, and the managed DLL does not exist; fix — use Il2CppDumper directly (the version must support the target Unity version; too old and parsing `global-metadata.dat` fails), and take function addresses from dump.cs
- **A pointer-chain scan is tedious and fails easily**: Symptom — an address from a value scan changes every start, and editing it directly does nothing; cause — the game uses dynamic memory allocation/ASLR, and the base differs every time; fix — CE `Pointer scan` saves a `.pt` pointer chain, or locate by module base + offset (`Game.exe+0x...`); after start, recompute the base and then the offset; confirm multi-level offsets level by level
- **Anti-cheat (EAC/BE) detects strongly**: Symptom — attach is refused, the debugger is detected, and the account is banned; cause — an anti-cheat driver-level monitor of the debugger and memory traces; fix — fully isolate the analysis environment (a dedicated VM/offline, [[re-sandbox]] + the [[re-analyze/platform-tips]] highest principle); after static analysis of detection points, bypass them ([[re-anti-analysis]]); never attach a debugger in an online environment
- **Frequent game updates invalidate patches**: Symptom — after an update every original address is invalid and the patch does not take effect; cause — each update recompiles, and addresses/offsets change; fix — record a patch as "module + offset + byte pattern" rather than an absolute address; after an update, locate the change with an old/new exe diff, or relocate by string/function name (an IL2CPP dump)
- **Anti-cheat detects virtualization / multi-instance**: Symptom — inside a VM the game exits immediately or behaves oddly; cause — some anti-cheat detects VBS/VMP signatures and a virtualized environment; fix — adjust the VM config against the anti-cheat's known evasion checklist (options that hide hypervisor signatures); if that still fails, make static analysis primary, and move the dynamic part to an old version / offline mode with no anti-cheat
- **UE5 Dx12 draw hook (vtable replacement)**: Symptom — a Dx11 Present hook (copied from ImGui) fails on UE5 Dx12, and after breaking on Present the stack has no main-module code; cause — UE5 ships its own separately compiled `D3D12Core.dll` (**the Release build is called D3D12Core.dll, the Debug build d3d12SDKLayers.dll**; it does not use the system-directory dll, and a signature cannot be found by searching the system dll), and when GPU acceleration/super-resolution is on the stack above Present is occupied by other dlls; fix — compile your own D3D12Core.dll from open-source UE5 source and drag it into IDA as a reference (`ExecuteCommandLists` is CommandQueue vtable index=10); after breaking on Present, directly locate **the return address under the main module** (super-resolution is identified by dll name; changing mode changes the dll name, and the approach does not change); the vtable replacement site: at the `mov rax,[rcx]` call, take rcx (the object pointer) and replace the vtable
- **In-game 5-byte hook detection (anti-hook)**: Symptom — the located target function's head has already been changed (a classic 5-byte hook stub), and the game's own call passes while an external hook call fails; cause — the game/engine ships a call-source check (it checks the stack return), and a non-self call restores the head 5 bytes; fix — do not hook the protected function body; hook **the site that calls it** (the stack-return site), take the object pointer (rcx/r12 and similar), and replace the vtable for the same effect; identification signature: the function head's 5 bytes were changed + the function internally has logic that restores the head (key functions such as FName::ToString/StaticFindObject are handled the same way in several places)
- **IL2CPP metadata recovery**: Symptom — a dump tool reports an unsupported version / incomplete output; cause — a Unity version changed the metadata format; fix — upgrade the dump tool (Il2CppDumper or Il2CppInspectorRedux); the products of the same dump must be paired (script.json matches the so; clear the IDA cache when switching)
- **An encrypted global-metadata.dat**: Symptom — the metadata file is ciphertext; cause — anti-cheat / custom encryption; fix — find the init decrypt function (around il2cpp_init); with Frida, after mmap/read, dump the already-decrypted metadata from memory and feed it to the dump tool
- **IL2CPP method hook**: Symptom — a bare Frida hook errors; cause — an IL2CPP method is not standard Java/ObjC, and the offset must be computed from metadata; fix — use the frida-il2cpp-bridge library; do not force-write Interceptor.attach
- **A crash after a patch**: Symptom — after a static modification, startup crashes; cause — a file-hash check / anti-tamper; fix — prefer a hook (do not change the file); when a static patch is required, handle the check logic at the same time; after repackaging, delete META-INF and re-sign (apksigner)
  (source: reverse-skill field-journal, MIT)
- **IL2CPP dual-file structure pairing (metadata skeleton + binary flesh)**: Symptom — only `global-metadata.dat` or only the binary is available, the dump result lacks method implementations/field offsets/the type graph, and parsing is scrambled when the two files' versions are misaligned; cause — an IL2CPP product splits in two: metadata (magic 0xFAB11BAF) stores only the declarative skeleton (type/method/field definitions, parameter default values, string literals, generic containers, interface offsets, vtable method indexes), and the binary (GameAssembly.dll / libil2cpp.so and similar) stores the flesh (the Il2CppType type graph, the field-offset table, the method-pointer table, the generic-instance table); type references cross-link the two sides, and either missing or version-misaligned cannot be fully recovered; information ownership also drifts with version (v27 removed metadata usage, and a newer version moved method specs and similar back into metadata — the concrete migration version follows a measurement; do not hardcode a version number from memory); fix — pair the two files at the same version; handle information ownership by a version fork; binary-side parsing depends on only two primitives, "virtual address → file offset mapping + pointer size", and PE/ELF/Mach-O/WASM/NSO are abstracted uniformly
  (source: Cpp2IL (SamboyCoding), MIT)
- **metadata version judgment needs a joint decision of the version number + the Unity version**: Symptom — a dump tool is sometimes fine and sometimes bad on the same version number across games, and structure parsing is misaligned (fields read crooked, indexes out of range); cause — the header version field is a coarse signal; the same version number corresponds to several generations of structure (24 splits into 24.1~24.5, 27 splits into 27.1/27.2, and similar), and a second decision by the Unity version number is required to read the structure correctly; different product lines may also share a number with different meanings (a reskin trap), so branch by version; from Unity 6 (v38+) type/method/field indexes are no longer a fixed 4 bytes, but 8/16/32-bit dynamic widths, the width is inferred backward from a section's Size/Count, and the type-index width even has to be derived from the binary-side interfaceOffsets structure (the type table is not in metadata); fix — a joint decision of the version field + the Unity version; build a version map by "the Unity version that introduced the change" and record each generation's change points (field add/delete, bit-width change, structure move); a hotfix version number is sometimes the critical boundary; after indexes widen, infer the element width backward before reading the table; do not hardcode 4 bytes
  (source: Cpp2IL (SamboyCoding), MIT)
- **Registration-structure location: count-pattern search + candidate arbitration**: Symptom — searching the binary for MetadataRegistration/CodeRegistration structures yields a pile of false hits, and parsing the first one is all garbage; cause — these two registration structures (MetadataRegistration: pointer and count tables for types/field offsets/metadata usage; CodeRegistration: the method-pointer table, the generic-method pointer table, the codegen-module pointer table) are the first step of a dump; there is no name to rely on, so the only search is a whole-file search for a byte pattern of a count known from metadata (method count / type-definition count), and false hits are extremely common; fix — after parsing the hit as a struct, exclude false hits with a verification-rule set: a count field does not exceed the ceiling (method count / type count on the order of hundreds of thousands), a pointer field must map back inside the file, and key counts cross-check against the metadata side (fieldOffsetsCount == type-definition count, numTypes is not less than the type-definition count); ceiling thresholds are updated continuously against the sample library (a real sample pushes some count up to the order of hundreds of thousands); v24.2+ can follow an xref reference chain (the mscorlib string → the codegen-module pointer that points at it → the module list → fall back to the CodeRegistration base); when all of that fails, fall back to entering the address by hand
  (source: Cpp2IL (SamboyCoding), MIT)
- **Static countermeasures when metadata was tampered with / encrypted**: Symptom — metadata parsing fails (magic does not match, section count does not match, layout is scrambled), and the only path that comes to mind is a runtime dump; cause — anti-cheat / custom protection may encrypt or scramble the metadata header; fix — decide the Unity version first, then parse; version sources have priority and cross-check (globalgamemanagers first → the data.unity3d package file → the main-program version; a suspicious value automatically switches to a backup source and retries); infer an encryption key backward from "known-plaintext signatures" rather than brute force — the high bytes of header offset/length fields must be 0 (the file is under 32MB), the string region starts with two 0 bytes, and header fields are a sequential byte stream (after XOR the difference of adjacent bytes is fixed); after the constraints converge, verify segment by segment; when the layout was scrambled, treat every candidate offset/length in the header as a pool and DFS-splice to rebuild the section chain (the difference between the offset and the current position is in a reasonable range, the length advances the position and does not go out of bounds, and alignment constraints hold); a failed parse can hang a fixup callback (raw bytes + Unity version → return repaired bytes and reread); that is the mount point for countering encrypted/obfuscated metadata
  (source: Cpp2IL (SamboyCoding), MIT)
- **Incomplete AOT generic instances + shared implementations**: Symptom — some generic methods in the decompilation have no implementation or the address is a placeholder, and different generic call sites recover the same implementation with types that do not match; cause — AOT generates only the generic instances the game actually uses, and an unused instance pointer is a placeholder; value-type parameters and reference-type parameters share implementations grouped by size (List<some reference type> and List<object> share the same implementation pointer; List<int> is a separate implementation); compiler dedupe/shared method bodies make "address → method" many-to-one; fix — look up ConcreteGenericImplementationsByAddress backward from the call address and list every generic instance that address corresponds to; that is the key channel for recovering a generic call; a shared body is recovered with conservative arbitration (decide only when exactly one non-static candidate's declared type matches the receiver type; better unresolved than guessed); a shared generic body passes an extra hidden MethodInfo* tail argument at the call; when recovering, do not treat the hidden argument as an ordinary argument
  (source: Cpp2IL (SamboyCoding), MIT)

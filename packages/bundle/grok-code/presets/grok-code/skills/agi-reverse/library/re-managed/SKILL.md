---
name: re-managed
type: gateway
description: >
  Managed-code reversing gateway. Orchestration: identify the runtime → decompile → deobfuscate → malicious cases go to [[re-malware]].
  Child skills: [[re-dotnet]] [[re-java]] [[re-script-deob]] [[re-wasm]] [[re-ai-triage]] → [[re-ai-model]] [[re-blockchain]] [[re-python]], [[re-browser-ext]], [[re-electron]], [[re-javacard]].
  Triggers: .NET, dnSpy, ILSpy, Java, jar, `字节码`, `PowerShell混淆`, `VBA宏`, `JS去混淆`, `托管代码`, managed code.
capabilities: [bytecode-parser, deobfuscation]
---

# Managed-code reversing (.NET / Java / scripts)

## Full workflow

1. Identify the runtime (decompiling before you know the type is the biggest waste):
   - **PE file**: `file` output contains "Mono/.Net assembly", PE optional-header data directory item 15 (COM Descriptor / CLI header) is nonzero, imports `mscoree.dll` → a .NET assembly → [[re-dotnet]] (capability: `bytecode-parser`)
   - **jar/war/class**: `unzip -p app.jar META-INF/MANIFEST.MF` shows `Main-Class`, class-file magic `CAFEBABE` → Java bytecode → [[re-java]] (capability: `bytecode-parser`)
   - **Script/macro**: a shebang (`#!/usr/bin/pwsh`), `-EncodedCommand` / `IEX` (PowerShell), VBA embedded in an OLE document (`file` shows "Composite Document"), `eval(` / `fromCharCode` (JavaScript) → [[re-script-deob]] (capability: `deobfuscation`)
   - If unsure, survey first with [[re-triage]] (capability: `triage`) (file/hash/entropy/strings). Do not guess from the extension
2. Decompile: follow the identification to [[re-dotnet]] (capability: `bytecode-parser`) / [[re-java]] (capability: `bytecode-parser`) / [[re-script-deob]] (capability: `deobfuscation`), and first restore the target logic to readable code
3. Deobfuscate: each atomic skill has its own method — de4dot (ConfuserEx/SmartAssembly), obfuscation identification + string decryption (ProGuard/Allatori), layer-by-layer decode (scripts/macros); deobfuscation of mixed native components (native stub / JNI) goes to [[re-deobfuscate]] (capability: `deobfuscation`)
4. Malicious cases (phishing macros, downloader scripts, malicious .NET/Java samples): go to the [[re-malware]] gateway (capabilities: `malware-behavior`, `document-malware`, `evasion-analysis`, `key-extraction`, `threat-intel`) — default sandbox → behavior analysis → C2/protocol → IOC/report; the decompiled recovery goes back to [[re-malware]] (capabilities: `malware-behavior`, `document-malware`, `evasion-analysis`, `key-extraction`, `threat-intel`) as static evidence

## Which atomic skill when (choice tree)

Branch by runtime:

- **PE and confirmed .NET metadata (CLI header / mscoree)** → [[re-dotnet]] (capability: `bytecode-parser`; dnSpy/ILSpy decompile, de4dot deobfuscate)
- **jar / war / class (Java bytecode)** → [[re-java]] (capability: `bytecode-parser`; CFR/JD-GUI, javap, unpack a packer)
- **.ps1 / .docm / .xlsm / .js / .jse / .hta (script or macro)** → [[re-script-deob]] (capability: `deobfuscation`; layer-by-layer decode, dynamic execution defaults to a sandbox)
- **Python-packed sample (.exe with PyInstaller/PyArmor features / .pyc / a python pack)** → [[re-python]] (capability: `bytecode-parser`; pyinstxtractor unpack, PyArmor-Unpacker, pyc decompile; pure script obfuscation goes to [[re-script-deob]] (capability: `deobfuscation`))
- **.wasm / WebAssembly module (web/Node-side payload)** → [[re-wasm]] (capability: `web-assembly`; WABT section parse, wasm-decompile, DevTools/wasmtime dynamic)
- **AI-model related** → [[re-ai-triage]] (capability: `triage`) routes: a model file (.onnx/.safetensors/.pt) → [[re-ai-model]] (capability: `ai-model-analysis`; format identification, weight extraction, file-level watermark; an unknown pkl defaults to isolation); API only → [[re-ai-attack]] (capability: `ai-model-analysis`; behavior-layer assessment, guard authorization first)
- **EVM contract bytecode (.bin / hex)** → [[re-blockchain]] (capability: `blockchain-analysis`; ABI recovery, panoramix decompile, vulnerability analysis)
- **Browser extension (crx/xpi/zip extension file)** → [[re-browser-ext]] (capability: `browser-extension`; permission audit / malicious behavior / deobfuscation)
- **Electron packaged app (resources/app.asar)** → [[re-electron]] (capability: `electron-analysis`; asar unpack, V8 bytecode boundary, CDP dynamic debug)
- **Java Card / SIM (CAP file)** → [[re-javacard]] (capability: `bytecode-parser`; 12-component parse, process(APDU) dispatch recovery)
- **Android DEX** → not this gateway — go to [[re-mobile]] (capabilities: `dex-parser`, `jni-analysis`, `frida-instrumentation`, `mobile-forensics`; [[re-apk]] (capability: `dex-parser`)). If it contains Java-native logic, return to [[re-java]] (capability: `bytecode-parser`)
- **A script that only calls a natively downloaded PE** → the dynamic side follows [[re-malware]] (capabilities: `malware-behavior`, `document-malware`, `evasion-analysis`, `key-extraction`, `threat-intel`); the static side returns to [[re-binary-core]] (capabilities: `decompilation`, `debugging`, `memory-dump`, `elf-parser`, `pe-parser`, `macho-parser`)

## Cross-domain

- .NET/Java malware samples: [[re-malware]] → this gateway (dotnet / java decompile and recover) → back to [[re-malware]] (behavior verification + IOC)
- Malicious scripts/macros: [[re-malware]] → [[re-sandbox]] (dynamic) → [[re-script-deob]] (static payload recovery)
- Base [[re-binary-core]]: initial survey ([[re-triage]]), the native part of a mixed program (format parse / [[re-ghidra]] decompile), deep deobfuscation ([[re-deobfuscate]])
- This gateway is called by the ".NET/Java/script sample" path in [[re-analyze]] triage
- The "code lives in the data" branch: AI models ([[re-ai-triage]] → [[re-ai-model]] file layer / [[re-ai-attack]] behavior layer; embedded code goes to [[re-binary-core]]), EVM contract bytecode ([[re-blockchain]], vulnerability side hands off to [[re-vuln]])

## Common pitfalls

- **Guessing the runtime from the extension or imports**: a PE that imports `mscoree.dll` is not necessarily pure managed (mixed mode / obfuscator disguise), and a jar may embed a native library — confirm first per workflow step 1 (CLI header / manifest / magic) and then pick the skill
- **Analyzing a .NET self-contained single file / Java fat jar without unpacking**: a single file bundles IL + the runtime into a native host, and fat-jar classes are in `BOOT-INF/lib` — unpack first ([[re-dotnet]] / [[re-java]] have the matching steps), or the decompiled product is empty/garbled
- **Underestimating obfuscation depth**: finding another layer after restoring one is normal — verify layer by layer, archive each layer, and do not try to finish in one step
- **Dynamic execution without a sandbox**: scripts/macros/VBA may be downloaders and may persist — every dynamic execution defaults to a sandbox (top principle in [[re-analyze/platform-tips]]). Static decode may skip it
- **Confusing packing with obfuscation**: Java packing (Virbox and similar) is a "packer", and de4dot cannot handle it — first decide "packer or obfuscation". A packer follows the [[re-anti-analysis]] idea (unpack first, then reverse)
- **Bytenode bytecode is bound to an ABI**: symptom — the host Node fails to load a JSC; cause — Bytenode bytecode is bound to a specific V8/Node ABI; fix — run it in the sample's own Electron RunAsNode mode (`ELECTRON_RUN_AS_NODE=1`), and do not start the business GUI
- **The registration surface is not the execution surface**: symptom — enumerating handlers cannot prove a data flow; cause — a registration existing does not mean the path executes; fix — enumerate the IPC/preload registration surface first, then call high-risk handlers with a mock fixture and capture side effects (URL receive / download / extract / spawn arguments) to close the evidence loop
- **Update-chain five-tuple forensics**: symptom — update-flow evidence is incomplete; cause — chain nodes are scattered; fix — for each node of `source URL → downloader → archive path → extractor → executable`, save the hash and timestamp
- **Signature state has four states**: symptom — a dual-signed DLL is judged vaguely; cause — each signature's state may differ; fix — `signtool verify /pa /all /v` checks signature by signature (existence / validity period / timestamp / trust verification reported separately)
- **Static capability ≠ already executed**: symptom — native strings/imports show a high-privilege capability; cause — an import is a clue, not evidence; fix — describe capability together with xrefs/call chains, and split the report into "conditional capability" and "observed behavior"
- (Source: reverse-skill field-journal, MIT)

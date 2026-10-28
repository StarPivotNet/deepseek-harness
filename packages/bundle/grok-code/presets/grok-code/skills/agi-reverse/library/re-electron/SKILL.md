---
name: re-electron
description: >
  Electron desktop-app reversing: asar unpack, main/renderer-process JS, V8 bytecode (.jsc) boundary, CDP dynamic debugging, anti-debug countermeasures.
  Triggers: Electron, asar, `桌面应用逆向`, .jsc, `V8 快照`, CDP, ELECTRON_RUN_AS_NODE, `devtools 检测`.
capabilities: [electron-analysis]
---

# Electron desktop-app reversing (asar / CDP / .jsc)

## When to use / when not to use

- Use: an Electron-packaged desktop app — `resources/app.asar` structure, recover main/renderer-process JS logic, native `.node` modules, extract keys/communication logic
- Use: identify a V8 bytecode `.jsc` file (a bytenode-class tool compile product) and judge its boundary
- Use: dynamic debugging — main process `--inspect`, renderer process `--remote-debugging-port` (CDP), `ELECTRON_RUN_AS_NODE` to reuse the runtime in Node mode
- Use: anti-debug countermeasures — identify and bypass devtools / inspect detection (joins [[re-evasion]])
- Do not use: a pure browser extension (go to [[re-browser-ext]])
- Do not use: obfuscated JS/scripts outside an Electron scene (go to [[re-script-deob]] / [[re-deobfuscate]])
- Do not use: `.jsc` appears in a Cocos game-resource scene (that is Cocos engine bytecode; go to [[re-game]]; this skill only covers Electron V8 bytecode)
- Do not use: you only need a generic binary triage ([[re-binary-core]] is the generic base; this skill only adds Electron packaging-layer semantics)
- Note: **dynamic execution defaults to a sandbox ([[re-analyze/platform-tips]] highest principle)** — running the app, connecting CDP, and loading `.jsc` are all treated as dynamic; static unpack can skip the sandbox

## Tool setup

Verify every tool before use. Static unpack can skip the sandbox; running the app / dynamic debugging defaults to a sandbox + network isolation ([[re-analyze/platform-tips]] highest principle). Electron apps are mostly packaged cross-platform; the toolchain is mainly the npm ecosystem and is consistent across OSes.

### Node.js + npm — tool base (asar / CDP client / bytenode / fuses)

- Linux: distro package `apt install nodejs npm` (Debian/Ubuntu repo versions are old; for a V8 version-lock scene, install a new version with NodeSource or nvm); macOS: `brew install node`; Windows: the official installer or `choco install nodejs`; cross-platform: nvm (`nvm install <version>`) switches Node versions as needed
- Verify: `node --version && npm --version`
- nvm: the official install script (GitHub nvm-sh/nvm); Windows uses nvm-windows or the official installer

### @electron/asar — asar archive unpack (the currently maintained official package)

- `npm install -g @electron/asar` or no-install `npx @electron/asar ...` (npx downloads automatically the first time; the old package name `asar` is deprecated but the CLI remains compatible)
- Verify: `npx @electron/asar --help` (should list the `pack / list / extract-file / extract` subcommands)
- Use: `npx @electron/asar extract app.asar out/` (extract the whole archive), `npx @electron/asar list app.asar` (list the directory), `npx @electron/asar extract-file app.asar path/to/file` (one file)
- Read without a tool: the asar header embeds a JSON directory (`{"files":{...}}`; each file has `size`/`offset`/`integrity`); the JSON string starts at offset 16 (the first 12 bytes are pickle nested-size fields, offset 12 is the header-string length, all uint32 LE) — `strings app.asar | grep '"files"'` or a small script `JSON.parse` locates it; no tool is required

### strings / grep — text leads

- Linux: ships with binutils (`apt install binutils` and similar); macOS: built in (or `brew install binutils`); Windows: inside WSL or Sysinternals strings
- Verify: `strings --version`

### chrome-remote-interface — CDP client (main dynamic-debugging tool)

- Inside the project, `npm install chrome-remote-interface` (official npm package, Chrome DevTools Protocol client)
- Verify: `node -e "require('chrome-remote-interface')"` with no error means it is installed; actual connectivity is in procedure step 6
- Alternative: pure curl + Node's built-in ws, no package (`curl http://127.0.0.1:<port>/json/list` takes `webSocketDebuggerUrl`, then connect WebSocket and send JSON-RPC)

### bytenode — .jsc compile/load understanding tool (for verification and comparison)

- `npm install -g bytenode` or install inside the project
- Verify: `npx bytenode --help` (`-c` compile, `-e/--electron` compile for Electron, `-ep/--electron-path` specify the Electron executable)
- Use: recompile against the sample `.jsc` magic and loadability with the target-version Node/Electron; it is not itself a decompiler (see pitfall 1)
- An Electron 42+ main-process scene (`electronMain`) has no matching CLI parameter; it must use the API call form: `require('bytenode').compileFile({ electronMain: true, filename: 'main.js' })` (matches the `electronMain` mode in pitfall 1)

### @electron/fuses — check/flip runtime-capability switches

- `npm install -g @electron/fuses` (official package)
- Verify: `npx @electron/fuses read --app <app executable or .app path>` — prints each fuse state (RunAsNode / EnableNodeCliInspectArguments / EnableEmbeddedAsarIntegrityValidation / OnlyLoadAppFromAsar and similar)
- Flip: `npx @electron/fuses write --app <path> RunAsNode=off EnableNodeCliInspectArguments=off` (read and assess before writing; flipping changes the binary and breaks the signature; macOS needs re-signing)
- View without a tool: strings-search the fuse sentinel `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`; after it are the fuse version, length, and wire bytes (`0x30`(0)=disabled, `0x31`(1)=enabled, `0x72`(r)=removed)

### Generic decompilers — native .node modules

- Ghidra (official release package, needs a JDK; some distro repos have `apt install ghidra` / `pacman -S ghidra`; macOS `brew install --cask ghidra`; Windows official zip; verify `analyzeHeadless -help`)
- IDA: commercial; Freeware architecture support follows the official page
- A `.node` is essentially an ELF/Mach-O/PE dynamic library; before importing into a decompiler, confirm the architecture with `file`/`readelf -h` (joins [[re-format-elf]] / [[re-format-macho]] / [[re-format-pe]])

### (Optional) xvfb-run — run a GUI app on Linux with no display

- Linux: `apt install xvfb` / `dnf install xvfb` / `pacman -S xvfb`
- Verify: `xvfb-run -a node --version`; with no display server, `xvfb-run -a electron .` runs the target
- macOS/Windows have a native display; not needed

## Procedure

Run in order. Archive each step; dynamic execution defaults to a sandbox.

1. **Identify Electron and the version**:
    ```sh
    ls resources/                    # 打包应用应有 app.asar（+ app.asar.unpacked/）
    strings <可执行文件> | grep -i -E 'electron|chrome' | head
    ```
   - Decision signals: a `resources/app.asar` structure, multiple processes in the process list (main process + GPU/renderer children), Electron/Chromium version strings inside the binary
   - Version confirmation: a packaged app's `--version` often prints nothing — the reliable path is the dynamic stage, executing `process.versions` through CDP (electron/chrome/v8/node/modules, every field); statically you can only assist with binary strings version strings
   - The Electron → Chromium/Node mapping is in the official electron-timelines release table (lists only Chromium/Node, no V8 column); the V8 version can only be obtained at runtime from `process.versions.v8`

2. **asar unpack**:
    ```sh
    npx @electron/asar list app.asar                       # 先看目录结构
    npx @electron/asar extract app.asar out/               # 整包解出
    npx @electron/asar extract-file app.asar package.json  # 单文件快速取
    ```
   - Without a tool: the JSON directory starts at offset 16; `strings app.asar | grep '"files"'` or a script that concatenates by size/offset can restore every file
   - The `app.asar.unpacked/` directory is native modules that were not packed into the archive; they sit on disk as-is and can be analyzed directly
   - Before repacking, `npx @electron/fuses read --app <executable>` and look at `EnableEmbeddedAsarIntegrityValidation` / `OnlyLoadAppFromAsar` — when integrity validation is on, replacing app.asar makes startup fail (see pitfall 2)

3. **Main-process entry and logic**:
   - After unpack, read the `main` field of `out/package.json` → the main-process entry JS (default `main.js`)
   - The main process is a Node environment: the require chain and `app`/`BrowserWindow`/`ipcMain` calls are the business skeleton; IPC handlers (`ipcMain.handle/on`) are the main/renderer communication hub; list them all first
   - Main-process logic can be reused as pure Node with `ELECTRON_RUN_AS_NODE=1 <executable> script.js` (the same V8/Node ABI; see the boundary in pitfall 3) — parts that do not depend on the electron API can be run offline to observe behavior
   - When the main process is packaged as `.jsc`: under `ELECTRON_RUN_AS_NODE`, `require('bytenode')` loads the .jsc (the version must match; see pitfall 1)

4. **Recover renderer-process JS**:
   - Renderer code is generally bundled in some subdirectory of `out/` (a webpack/browserify/rollup bundle, often obfuscated and compressed to one line)
   - Recovery order: identify the entry HTML (BrowserWindow's loadFile/loadURL argument) → find the bundle referenced by `<script>` → beautify (js-beautify class) → locate strings (strings/`xxd`) → the obfuscation layer goes to [[re-script-deob]] / [[re-deobfuscate]]
   - Extract renderer-process keys/logic by expanding from string references (hardcoded keys, API domains, signature constants) as anchors
   - When a `.jsc` file appears, jump to the boundary handling in pitfall 1 (do not parse it as JS text)

5. **Native module `.node`**:
   - Locate: `app.asar.unpacked/**/*.node` (and .node files pointed at by require paths after unpack)
   - Identify: `file xxx.node` (ELF/Mach-O/PE + architecture), `readelf -h` (Linux); a `.node` is a dynamic library; walk [[re-format-elf]] / [[re-format-macho]] / [[re-format-pe]] first → decompile with [[re-ghidra]] / [[re-ida]] / [[re-radare2]]; C++ semantics go to [[re-cpp-abi]]
   - NODE_MODULE_VERSION (`process.versions.modules`) corresponds one-to-one with the Electron version; loading a .node with the wrong version reports an ABI error — this can confirm the target Electron version
   - Exported functions are the N-API/V8 interface layer; cross-locate business functions from the export table + JS-side call sites (joins [[re-imports]])

6. **Dynamic CDP debugging**:
    ```sh
    # 主进程（Node/V8 Inspector，默认端口 9229）
    <可执行文件> --inspect=9229
    <可执行文件> --inspect-brk=9229        # 启动即暂停，等调试器
    # 渲染进程（Chromium CDP，默认端口 9222）
    <可执行文件> --remote-debugging-port=9222
    ```
   - Before start, `npx @electron/fuses read --app <executable>`: when `EnableNodeCliInspectArguments` is Disabled, `--inspect`/`--inspect-brk` are ignored (SIGUSR1 no longer opens the inspector) — then the only paths are renderer-process CDP or [[re-frida]] injection
   - Renderer-process connection flow:
      ```sh
      curl -s http://127.0.0.1:9222/json/list    # 列 targets（title/url/webSocketDebuggerUrl）
      ```
      Connect `webSocketDebuggerUrl` with chrome-remote-interface; `Runtime.evaluate` runs arbitrary JS, `Console.enable` collects logs, `Page.captureScreenshot` takes a screenshot; the main process connects the `--inspect` port the same way
   - Trust the actual `/json/list` response for the port; do not guess a fixed port (the app may occupy/change it); a target does not appear until a window is created; trigger the UI first, then enumerate
   - A single-instance lock (`app.requestSingleInstanceLock()` is common) makes a second start exit immediately — use `--user-data-dir=<new directory>` or end the existing instance first
   - A WebSocket that connects CDP from a browser page is subject to an Origin check (Chrome 111+): add `--remote-allow-origins=*`; a Node client has no Origin header and is unaffected
   - Runtime-info forensics: `Runtime.evaluate` executes `process.versions` (versions), `process.env` (environment variables), `require.cache` (loaded modules) — more reliable than static strings
   - On Linux with no display, wrap the start in `xvfb-run -a`

7. **Anti-debug countermeasures and data extraction**:
   - Common devtools/inspect detection shapes: look for inspect arguments in `process.argv`/`process.execArgv`, DevTools-open detection (window size `outerWidth - innerWidth`, console timing), `debugger` statements, abnormal `process.versions` checks
   - Locate the detection point → patch past it (edit the bundle and repack asar; mind the integrity in pitfall 2) or hook at runtime ([[re-frida]]); bypass before the CDP-layer `Debugger.enable`
   - Injection-surface judgment: `contextIsolation` (default true since Electron 12), `sandbox` (default true since Electron 20), and `nodeIntegration` (default false) decide what preload/the renderer process can require, and CDP `Runtime.evaluate` must pick the right execution context (main world vs isolated world's contextId)
   - Data-extraction joins: runtime memory/keys [[re-memdump]], hardcoded keys [[re-crypto-keys]], encrypted-data recovery [[re-crypto-decrypt]], syscall/file behavior [[re-tracing]]
   - Behavior observation: `ELECTRON_ENABLE_LOGGING=1` or `--enable-logging` turns on Chromium logs; diagnose failures first

## Cross-domain joins

- [[re-managed]]: the managed-code gateway path (re-managed → this skill); Electron's JS layer is orchestrated by it
- [[re-script-deob]] / [[re-deobfuscate]]: recover obfuscated renderer-process JS
- [[re-evasion]]: devtools/inspect detection-countermeasure methodology (this skill produces target features; bypass strategy joins)
- [[re-format-elf]] / [[re-format-macho]] / [[re-format-pe]]: format-parse precondition for a native `.node` module
- [[re-cpp-abi]]: recover C++ semantics of a native module (RTTI/vtable/STL)
- [[re-imports]]: .node export table and library fingerprint; assist Electron version confirmation
- [[re-ghidra]] / [[re-ida]] / [[re-radare2]]: decompile native modules
- [[re-frida]]: an alternative dynamic-injection channel when a fuse bans inspect
- [[re-memdump]] / [[re-crypto-keys]] / [[re-crypto-decrypt]]: extract runtime keys and encrypted data
- [[re-tracing]]: observe dynamic behavior (file/network/syscall)
- [[re-variant]]: multi-version comparison (patch location, logic differences)
- [[re-game]]: distinguish a Cocos-scene `.jsc` (JS-engine bytecode) from an Electron `.jsc` (V8 bytecode)
- [[re-sandbox]]: a mandatory precondition for every dynamic execution (the [[re-analyze/platform-tips]] default-sandbox principle)
- Companions: [[re-patching]] (byte-patch an edited bundle), [[re-triage]] (triage precondition)

## Common pitfalls

- **`.jsc` is a V8 bytecode snapshot, not JS text**: Symptom — after extracting a `.jsc` file, grep/beautify/parse all fail; the contents are unreadable binary; cause — a bytenode-class tool compiles JS into V8 bytecode and removes the source (`Function.prototype.toString()` is replaced with stub code; that is one identification signature); boundary — the V8 bytecode format is undocumented and changes with the V8 version; there is currently no public decompiler; `node --print-bytecode` (available on an official Node build) can only print bytecode mnemonics compiled "while running", not recover source; fix — first confirm the sample `.jsc`'s compile environment (magic/loader hint, compare `process.versions.v8`); if it can load, run behavior analysis (strace/network/memory); if you need source semantics, find an uncompiled .js copy or a bundle map; version lock — a `.jsc` can load only if it was compiled by a Node or Electron of the same V8 version and the same platform/architecture; a cross-version load crashes immediately; an Electron 42+ (V8 ≥ 14.8) main-process `.jsc` must be compiled by a real Electron main process (bytenode `electronMain` mode); one compiled with `ELECTRON_RUN_AS_NODE` crashes on load (read-only snapshot check mismatch) — report an uncertain boundary as-is; do not invent source contents
- **Path obfuscation and integrity checks inside asar**: Symptom — extracted file paths do not match the require logic, or the app exits as soon as it starts after app.asar was edited; cause — asar allows arbitrary filenames (including `..`/encoded variants), and when the `EnableEmbeddedAsarIntegrityValidation` fuse is on the asar contents are checked, and when `OnlyLoadAppFromAsar` is on non-asar loads are refused; fix — restore by the JSON directory's size/offset rather than path semantics; before editing the package, `@electron/fuses read`; when the check is on, switch to a runtime hook (frida) or dynamic analysis; do not force-edit the archive
- **`ELECTRON_RUN_AS_NODE` behavior differs**: Symptom — after setting the environment variable the app does not run as Node as expected, or the main-process `.jsc` crashes on load; cause — in this mode Electron only provides the Node runtime (no `electron` API; `require('electron')` behaves oddly), and when the `RunAsNode` fuse is Disabled the environment variable is ignored completely (and `process.fork()` fails with it); fix — read fuses first and confirm the RunAsNode state; this mode is only for rerunning logic that does not depend on the electron API; GUI/window code must take the normal start path
- **contextIsolation / sandbox decide the injection surface**: Symptom — require errors inside the preload script, or CDP evaluate cannot get page variables; cause — since Electron 12 contextIsolation defaults to true (the renderer process is isolated from the preload context), since Electron 20 sandbox defaults to true (preload has no full Node capability), and nodeIntegration defaults to false; fix — CDP `Runtime.evaluate` enumerates execution contexts first (after `Runtime.enable`, look at contextId), distinguishes the main world from the isolated world, then evaluates; design the inject/read surface from the actual configuration of these three switches
- **fuses change runtime capability (the debug entry may be closed entirely)**: Symptom — `--inspect`, `--inspect-brk`, and `ELECTRON_RUN_AS_NODE` are all ineffective, and the app looks as if it never received the arguments; cause — the `EnableNodeCliInspectArguments` / `RunAsNode` fuses were flipped off; fix — `@electron/fuses read` first to confirm; writing a fuse changes the binary and breaks the signature (macOS needs re-signing; when unsigned, use the resetAdHocDarwinSignature option); this is the last resort for changing a packaged product; prefer a frida / renderer-process CDP channel
- **Single-instance lock and an uncertain CDP port**: Symptom — a second start with arguments exits immediately, and /json/list will not connect; cause — `requestSingleInstanceLock()` makes the second instance exit immediately, and the CDP port may be occupied or changed by the app; fix — bypass the single-instance lock with a separate `--user-data-dir`; trust the actual `/json/list` response for the port; until a window is created the target is not exposed; trigger the UI first, then enumerate

---
name: re-rpk
type: gateway
description: >
  Quick App / Vela `.rpk` gateway. Orchestration: unpack and classify, then analyze mode recovers all logic, or crack mode changes only the gate and then signs and packs.
  Tools in this directory: `cli.js`, `jsc.js`, `rpk.js`, `vendor/sign`.
  Triggers: RPK, `快应用`, Vela, `分析全部逻辑`, `破解`, `去验证`, `重签`, JSC.
capabilities: [unpack, bytecode-parser]
---

# Quick App RPK (logic recovery / unlock and re-sign)

This file is `library\re-rpk` inside `agi-reverse`. It is not a catalog skill. Do not call `skill` for `re-rpk`.

`<skill_base>` is the `agi-reverse` directory. The cli in commands is `<skill_base>\library\re-rpk\cli.js`. The user states that this package is theirs. Analyze mode is read-only and writes `logic-map.md`. Crack mode changes only verification, the lock, and activation, then signs.

## Tools

This directory ships `cli.js`, `jsc.js`, `rpk.js`, `vendor/sign` (SignUtil and the default pem), and `node_modules` (jszip, jsrsasign). Do not read a workspace project, do not run `resolve-toolchain.js`, and do not read `DSH_JSC_TOOL`. If `vendor/sign` or `node_modules` is missing, repair this copy; do not switch to a guessed compression tool.

```
node <skill_base>\library\re-rpk\cli.js unpack <app.rpk> --out <workDir>
node <skill_base>\library\re-rpk\cli.js pack <workDir> --out <app.crk.rpk>
node <skill_base>\library\re-rpk\cli.js classify <workDir>
node <skill_base>\library\re-rpk\cli.js strings <file.jsc> [--contains TEXT]
node <skill_base>\library\re-rpk\cli.js find <file.jsc> [--fn NAME] [--atom A,B] [--index N] [--contains]
node <skill_base>\library\re-rpk\cli.js splice <file.jsc> [--fn NAME|--atom A,B|--index N] --from N --count N --false
node <skill_base>\library\re-rpk\cli.js disasm <file.jsc> [--fn NAME] [--atom A,B] [--index N] [--contains]
node <skill_base>\library\re-rpk\cli.js flow <file.jsc> [--fn NAME] [--atom A,B] [--index N] [--contains]
node <skill_base>\library\re-rpk\cli.js gates <workDir>
node <skill_base>\library\re-rpk\cli.js stub <file.jsc> [--fn NAME|--atom A,B|--index N] --true|--false [--set-field path[=bool]] [--async]
node <skill_base>\library\re-rpk\cli.js stub <file.jsc> --define-field ATOM --true|--false
node <skill_base>\library\re-rpk\cli.js verify <file.jsc> [--fn NAME|--atom A,B|--index N] --ops name,name,...
node <skill_base>\library\re-rpk\cli.js decompile <file.jsc> --ir <file.ir.json>
node <skill_base>\library\re-rpk\cli.js compile <file.ir.json> --out <file.jsc>
```

`decompile` writes only IR. Do not send `.js` into `compile`. You can also `require("<skill_base>\library\re-rpk\rpk.js")` and use `unpackRpk` / `packRpk` / `packFilePlan`, and `require("<skill_base>\library\re-rpk\jsc.js")` and use `parseJsc` / `toIR` / `assembleJsc` / `findFunctions` / `stubFunction` / `spliceWindow` / `traceLines` / `scanGates`. When editing IR, write `name` and the `atomName` you need; `assembleJsc` fills `atom` from the atom table.

Directories in the current workspace: `<stem>.rpk` is the original package, `_rpk_<stem>/` is the unpack root, `_rpk_<stem>_work/` holds backups, scripts, and `logic-map.md` (not packed into the package), and `<stem>.crk.rpk` is the crack-mode product. `stem` is the file name with `.rpk` removed; a Chinese name stays as-is.

## Full workflow

1. **Classify.** `unpack`, then `classify`. If it is not a zip, stop and report the file header. `classify` only reports `kind=js|jsc|unknown`, `entry`, and `extra`/`missing`. This step does not edit files. Read `router.entry`, `package`, and `versionName` from both manifests, and note the file count and whether `META-INF/CERT` is already present. Write the classification into this session's cognition `Live`, then pick the mode immediately.
2. **Choose the mode.** The user wants analysis, recovery of all logic, only the flow, or has said not to change the package: analyze mode. The user wants a crack, to remove verification or the lock, or to re-sign: crack mode. Both: finish `logic-map.md` first, then enter crack mode. When the intent is unclear, use analyze mode, finish the map, then ask whether they want a `.crk.rpk`.
3. **Analyze mode.** Cover startup, routing, every page, the gameplay core, the gate, resource checks, network, and storage. Do not `stub`, do not edit the unpack tree, and do not `pack`. For JS, read every `pages/**/*.js` and the shared modules. For JSC, run `flow` on every `.jsc` and `gates` on the unpack root. `flow` is the readable listing: absolute branch targets, calls, get versus put fields, compares, and storage keys. `disasm` stays the raw opcode listing. `decompile --ir` is only for a later edit. The gate row is the `gates` lists, not one sentence. Every page in the route table needs a duty and one piece of evidence. Deliver `_rpk_<stem>_work/logic-map.md` with at least seven rows: package identity (`package`, `versionName`, `kind`, entry page), route table (who `replace`/`push` to whom), launch chain (cold start to the first screen), gameplay core (state, input, rules, win/loss or score, AI), gate (lock, activation, authorization, membership, device binding, HMAC, and the failure jump), resources and side effects (local storage, network, decryption, certificates), evidence (path, function name or `--index`, key atom or string). Done when all seven rows are present and the reply explains all logic from this map. Do not deliver a `.crk.rpk`.
4. **Crack: locate the gate.** Search the unpack tree for `lock|license|activat|grantAccess|requireAccess|deviceCode|hmac|vip|trial|expire|paywall|授权|激活|解锁|试用|会员`. For JSC use `strings --contains`, `find --atom`, `find --fn`, and `disasm --atom`. Identify a function by function name or methodName, the atom set, `argCount`, and ops, not by a constant-pool index alone. Also check whether `router.entry` points at a lock page or a splash, whether a failure path `router.replace`s to the lock page, and whether the gameplay page's `onInit`/`onShow` returns early. Read `gates` before choosing a patch. `fieldWrites`, `storageSets`, `statusReturns`, and `readers` are the whole gate. A status function that still returns an empty or all-zero array, and another function that writes `moduleStatus`, `activationStatus`, or `activationResult`, are one gate even when they are not the same function. If the search misses, widen the strings; do not gamble by editing the entry.
5. **Crack: minimal patch.** Crack mode does not change the gameplay core. JS: make the condition always true, remove the branch that jumps to the lock page, or point the entry at the gameplay page; after the edit it still follows the original path, and `pack` packs it straight back. Copy each file to a temporary `.mjs` and run `node --check`. About 50KB per file is the experience limit. JSC: `find` a unique hit before `stub`; hand-edit IR only for complex control flow. For a mangled name, `find --atom` first, note the `index`, then `stub --atom` or `stub --index`. `--fn` is an exact match by default; add `--contains` only for a substring. Pick one path from the real ops: synchronous always-true `stub --true` (`push_0,lnot,return`); synchronous always-false `stub --false` (`push_1,lnot,return`); asynchronous always-true `stub --true --async` (`push_true,return_async`); write a field with `stub --index N --set-field a.b=true`; a constructor-time field with `stub --define-field ATOM --true`; when the false branch of a compare window is the one that lets the user through, use `splice --false`. The window length must be odd and the net stack `+1`. `splice` rejects an even length, a window that does not fit, or a net stack that is not `+1`. Do not `stub` out a function whose tail still enters gameplay. The lock-page file may stay, as long as a cold start cannot enter it and a failure jump cannot reach it. Do not delete a rules function that a gameplay page still calls. Touch HMAC or decryption only when a cold start is still stuck on a resource check, and do not stub a decryption function into a boolean constant true. Put the patch script in `_rpk_<stem>_work/` and print `{rel, hits}`. Immediately after the patch, `verify --index N --ops`; the ops must be the sequence this round actually wrote. If `verify` fails, stop. Run `gates` again. `writeBack` true means do not pack: the same function both writes a gate field or calls `setStorage` / `setStorageSync` and still calls `checkActivation`, `verifyActivation`, `getStorage`, or `getStorageSync`, or is itself a status return; or an empty or all-zero status return exists anywhere while `moduleStatus`, `activationStatus`, or `activationResult` is still written. Patch only that verification, lock, or activation write. Make the status function return the activated array, or stop the activation page from writing the empty or all-zero array. Do not edit gameplay, rules, score, or AI. Do not stub HMAC or decryption to true. `verify --index` every patched function. Pack only after `writeBack` is false.
6. **Crack: pack and sign.** `pack` signs by default. Add `--no-sign` only when an unsigned zip is required; a watch usually cannot install it. `pack` ignores `.rpk-meta.json`, `.agent`, `.git`, `.dsh`, `_work`, `*.ir.json`, `*.disasm.txt`, and `*.bak`. A file that is not on the original manifest throws by default; use `--allow-extra` only after you confirm it should be included. Glance at `missing`, and do not drop resources without a reason.
7. **Crack: open the finished package and check it.** Check the packed `.rpk`, not only the work directory: the zip opens and contains `META-INF/CERT`, and `extra`/`missing` are explained; `entry` in both manifests is the expected gameplay page; `verify --ops` on every changed JSC function equals the sequence written this round, and spot-check one unchanged page to confirm it was not touched; the JS gate condition is always true and `node --check` passed. Then `present` this `.crk.rpk`. The default certificate is not the original publisher certificate. If install fails, uninstall the original package first and then install, and say so in the delivery. The lock page may still be in the route table, as long as it is no longer the launch page.

## When to use which atomic skill (selection tree)

- **All logic, report only** → analyze mode. Do not `stub`, and do not `pack`.
- **An installable unlocked package** → crack mode. Crack mode does not change the gameplay core.
- **kind=js** → edit the plaintext, then `pack`. Do not compile it to `.jsc`.
- **kind=jsc** → edit only IR, or use `stub` / `find` / `splice`, then `compile`. `.js` and `.jsc` are not in the same package.
- **APK, iOS, HarmonyOS package** → leave this file and follow [[re-mobile]].
- **Other managed bytecode (.NET, Java, script, WASM)** → [[re-managed]].
- **No `.rpk` was given** → stop. Do not use this file for ordinary feature work.

## Cross-domain handoff

- A named `.rpk` stays on this file. Do not switch to [[re-managed]] or [[re-mobile]] to unpack this package.
- A source tree, or a binary that was not shipped, is handed by the `agi-reverse` entry to `takeover-codebase` and does not enter this file.
- The preset's safety rules outrank this file. A patch lands only on a package the user owns.

## Pitfalls

- **Treating JSC as encryption.** The sample is plaintext bytecode from QuickJS 2021-03-27. Start from `strings` / `find`.
- **Treating `.dec.js` or `liftJsc` as compilable source.** The high-level pseudo-JS is lossy. Only IR round-trips (`toIR` against `assembleJsc`).
- **Compiling plaintext `.js` into `.jsc` and then packing.** A JS package is `pack`ed directly after the edit.
- **Editing files before classification, or writing `logic-map.md` before classification.**
- **Analyze mode only scans lock strings.** It must cover the gameplay core and the route table, and it must deliver `logic-map.md`.
- **Crack mode also edits the UI or the rules.** Change only verification, the lock, and the entry.
- **`find --fn g` substring-hits `gate`.** A mangled name uses `--atom` or `--index`. `stub` clears the function-body atoms; when checking, use the `--index` recorded before the stub.
- **Treating the documented `push_0,lnot,return` as this package's ops.** Read the sequence this round actually wrote with `verify`.
- **Treating a correct work directory as a correct package.** Open the zip. A plain zip will not install; it must go through SignUtil.
- **Transplanting a whole page by string concatenation.** Nested ternaries and template arrays break. Edit in small steps, and `node --check` after each step.
- **Turning a watch-face page into canvas.** Vela's canvas is unstable.
- **Adding opcodes because a listing is hard to read.** The 244-opcode table already names every in-range byte. Use `flow`. These packages often have no per-op source line.
- **Packing after one stub.** `gates` must show `writeBack` false first. Save the JSON as `_rpk_<stem>_work/gate-closure.json`, never inside the unpack root.
- **Treating `flow` text as IR.** `compile` still accepts only `aiot-jsc-ir` from `decompile`.

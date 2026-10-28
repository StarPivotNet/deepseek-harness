---
name: re-script-deob
description: Script and macro deobfuscation: PowerShell, VBA, JavaScript. Triggers: `PowerShell混淆`, `VBA宏`, `JS去混淆`, `脚本解密`, `恶意脚本`
capabilities: [deobfuscation]
---

# Script and macro deobfuscation (PowerShell / VBA / JavaScript)

## When to use / when not to use

- Use: recovering obfuscation of a script or macro such as .ps1 / .docm / .xlsm / .js / .jse / .hta (encoding, string concatenation, an execution chain)
- Use: a phishing-attachment macro, a malicious downloader script (the [[re-malware]] → [[re-managed]] path)
- Do not use: a compiled product (native uses [[re-binary-core]], .NET uses [[re-dotnet]], Java uses [[re-java]])
- Do not use: the script is fully readable (read the logic directly; this skill is not needed)
- Note: **dynamic execution defaults to the sandbox (the top rule in [[re-analyze/platform-tips]])** — a static decode that does not execute may skip the sandbox. Any step that "runs the script to get the next layer" must enter [[re-sandbox]]

## Tool setup

See [[re-analyze/platform-tips]] — this skill is mainly static decoding and skips the sandbox. A step in the execution-chain trace that needs a runtime (running a script / opening a macro) enters the sandbox under the top rule.

### python3 (the decode workhorse)

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: shipped. Windows: the official installer or `choco install python`
- Check: `python3 --version`

### oletools (extracting and decoding a VBA macro, optional but strongly recommended)

- `pip install oletools` (the pyparsing dependency installs automatically)
- Check: `olevba --help`

### xxd / sed (hex and text processing)

- Debian/Ubuntu: `apt install xxd` (a separate package on newer versions; on older versions it is in `vim-common`). Fedora: `dnf install vim-common` (xxd has traditionally been provided by vim-common; F38+ also has a separate `xxd` subpackage). Arch: `pacman -S xxd`
- macOS: shipped (bundled with vim)
- Windows: no shipped xxd — use WSL or PowerShell `Format-Hex`
- sed is shipped on every platform. Check: `xxd -v && sed --version`

### PowerShell (built into Windows) / pwsh (Linux/macOS)

- Windows: the built-in `powershell.exe` (or PowerShell 7 `pwsh`)
- Linux: `apt install powershell` (the Microsoft repo) or `snap install powershell`. macOS: `brew install --cask powershell`
- Check: `pwsh --version`

### js-beautify (JS formatting, optional)

- `pip install jsbeautifier`. Check: `js-beautify --version`

## Steps

Run in order. Archive each recovered layer with a number (`layer_01.ps1` → `layer_02.ps1` …). A step in the execution-chain trace that "runs the script to get the next layer" always runs inside the sandbox.

1. **Identify the script type and the obfuscation style**:
   ```sh
   file sample.ps1 && head -c 512 sample.ps1
   grep -oiE 'IEX|Invoke-Expression|-EncodedCommand|FromBase64String|eval\(|unescape|fromCharCode|Chr\(|StrReverse|Document_Open|AutoOpen' sample.ps1
   ```
   - PowerShell signs: `-EncodedCommand` / `IEX` / `FromBase64String` / `[Convert]::`
   - VBA signs: `Sub AutoOpen` / `Document_Open` / `Chr(` / `StrReverse` / `Evaluate` / `Shell`
   - JS signs: `eval(` / `unescape` / `fromCharCode` / `\xHH` hex / `document.write`
   - Obfuscation-style classes: pure encoding (base64/hex/char-code), string concatenation (`'co'+'mmand'`), an execution chain (an outer IEX/eval nesting an inner payload), character reversal or substitution

2. **Recover layer by layer (decode first, then follow the execution chain)**:
   - Order: peel from the outside — decode the pure-encoding layer first, then follow the IEX/eval argument until the innermost payload
   - After each layer, go back to step 1 and identify again (the new layer may be a different obfuscation technique)
   - The final goal: readable "real logic" (a URL, a command, a payload). Archive the final layer
   - A step in the execution chain that "prints the next layer after it runs" → run it inside the sandbox

3. **PowerShell (`-enc` decode, the IEX chain)**:
   - Decode `-enc` (safe; it does not execute):
     ```sh
     pwsh -NoProfile -Command '$d=[Convert]::FromBase64String("BASE64"); [Text.Encoding]::Unicode.GetString($d)'
     ```
   - The IEX chain (inside the sandbox, replace IEX with output to get the next layer): `sed 's/IEX(/Write-Host (/g' layer_01.ps1 > layer_02.ps1`
   - Extract string literals structurally (the AST; it does not execute):
     ```powershell
     $ast = [System.Management.Automation.Language.Parser]::ParseFile('layer_01.ps1', [ref]$null, [ref]$null)
     $ast.FindAll({ $args[0] -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) | % { $_.Value }
     ```
   - Common techniques: `-join` / `-split` character concatenation, `$env:XXX` variable substitution, string reversal

4. **VBA (olevba extracts the macro, then recover it)**:
   ```sh
   olevba -c sample.docm > macro.txt                 # 提取宏源码
   olevba --decode -c sample.docm > macro_decoded.txt  # 自动解常见字符串混淆（--decode 自 oletools 0.24/2015 起就有，无版本门槛）
   ```
   - A manual recovery: convert a `Chr(65)` concatenation to ASCII with python3. Reverse `StrReverse(...)`. The execution string inside `Evaluate("...")`
   - Find the auto-exec entry: `AutoOpen` / `Document_Open` / `Workbook_Open` / `Auto_Open`
   - Dynamic verification (must be the sandbox): open the document in Office/LibreOffice inside the sandbox (macros enabled), and watch the behavior and the next layer's output

5. **JS (deobfuscate / decode)**:
   - `eval(` → statically replace it with `console.log(` (or `print(`) and watch the payload
   - char-code decode: `python3 -c "print(''.join(chr(int(c)) for c in '72,101,108,108,111'.split(',')))"`
   - `\xHH` hex: `python3 -c "print(bytes.fromhex('68656c6c6f').decode())"` (strip the `\x` prefix first)
   - a base64 string: `python3 -c "import base64; print(base64.b64decode('...'))"`
   - format: `js-beautify layer_01.js -o pretty.js`
   - Dynamic (the sandbox): `node payload.js`, or run it in a browser sandbox to get the next layer

## Concrete deobfuscation-chain recipes

These continue the obfuscation-style classes of step 1. Follow the recipe (the method is the core; the tool can be replaced):

**Replacing eval / an exec function**: replace `eval` / `IEX` / `Invoke-Expression` / `bash` with a print statement (in JS, `eval = console.log`; in PowerShell, replace `IEX(...)` with a print). After it runs, it prints the underlying code. Decode one layer, look at that layer, then decode the next. Archive each layer (`layer_01.ps1` → `layer_02.ps1` …).

**Common JS encoding functions (seeing one means it is a decode target)**: `unescape()` (URL-decode %XX), `String.fromCharCode()` (a character-code array), `atob()` (Base64). Batch-decode hex `\xHH` / Unicode `\uHHHH` escapes (`python3 -c "import sys; print(sys.argv[1].encode().decode('unicode_escape').decode(errors='replace'))" '<string>'`). Replace `document.write` with a print.

**The PowerShell -enc / IEX chain**: a base64 decode after `-EncodedCommand` is UTF-16LE:
```powershell
[System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String($encoded))
```

**Junk-code detection** (five identification features):
- A NOP sled
- push/pop appearing in pairs that cancel each other
- A result of 0 / an identity (arithmetic junk)
- A dead write: a register is written and never read before the next write
- An unconditional jump to the next instruction

Real logic looks like `junk, junk, junk, CALL target, junk, junk` — extract every real call target and ignore the noise around it (a script can filter by the `call` instruction plus junk targets).

**A hex-encoded payload**: after hex is turned into bytes, try common transforms first: subtract 1 from each byte, and a single-byte XOR key (try upward from 0x01).

**A common decode-chain pattern**: `base64 decode → gzip decode → reverse → base64 decode`. `file` each layer's output to judge the type and check readability. A failed check means the layer order or the encoding judgment was wrong. Roll back one layer and retry.

## Advanced obfuscation (a commercial obfuscator)

Techniques of a JScrambler-class commercial obfuscator, and the counters:

- **Feature identification**: a bootstrap loader (a self-executing entry), a hidden string table (an array plus an index reference), the `_0x` variable-rename pattern, function-body encryption (decrypted at runtime)
- **Countering control-flow flattening (CFF)**: identify the dispatcher (the switch dispatch center) → follow the state variable → recover branches into sequential or conditional structure (the method continues at [[re-deobfuscate]])
- **Countering string encryption**: locate the hidden string table (the decode-function call site) → extract at runtime (run the decode function inside the sandbox and take the value; see [[re-sandbox]]) or recover it statically (script the decode loop)
- **Countering dead-code injection**: filter unreferenced functions (by the call relation; no caller means a deletion candidate)
- Toolchain: js-beautify formats it → pick the counter path by technique. The dynamic side runs inside the sandbox and takes the value (the default-sandbox principle)

## Cross-domain handoff

- [[re-managed]]: steps ② (decompile) and ③ (deobfuscate) of the gateway workflow always call this skill
- [[re-malware]]: the path for a malicious script or a phishing macro (a docm/ps1/js attachment → sandbox behavior + this skill recovers the payload)
- [[re-sandbox]]: the required prerequisite of every dynamic execution (running a script, opening a macro); see the default-sandbox principle in [[re-analyze/platform-tips]]
- Companions: [[re-triage]] (the first look), [[re-ioc]] (extract a C2 domain/URL from the script as an IOC), [[re-protocol]] (the callback traffic the script downloads)

## Pitfalls

- **Nested obfuscation has to be peeled patiently, layer by layer**: symptom — one layer after another, and it feels endless; cause — stacked obfuscation (encoding + concatenation + an execution chain) is normal; fix — decode layer by layer, archive each layer with a number, and re-run identification after each decode. Do not skip a layer, and do not expect one step to finish it
- **After olevba extracts it, it is still obfuscated**: symptom — the macro extracted by `olevba -c` is still a screen full of `Chr(65) & Chr(66)` concatenation; cause — olevba only extracts; it does not recover; fix — `--decode` automatically undoes common techniques, recover the rest by hand, and finally check dynamically that the recovery is correct
- **A malicious script must run inside the sandbox**: symptom — a local `pwsh sample.ps1` changes the system or makes an outbound connection; cause — the script may be a downloader or a persistence implant (a typical violation of the default-sandbox principle in `platform-tips`); fix — every dynamic execution enters [[re-sandbox]] (network isolation + a snapshot). A static decode may skip the sandbox
- **A blind regex edit easily breaks the script structure**: symptom — after a global sed replacement there is a syntax error, and the next layer will not decode; cause — the obfuscated string itself contains the pattern being replaced, and a string literal was hit by mistake; fix — prefer an AST or a structured parse (the PowerShell AST, JS parenthesis matching). After every replacement, do a syntax check first (`pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content layer.ps1 -Raw))"` / `node --check layer.js`) and only then go to the next step
- **Locating a signature function inside a webpack bundle**: symptom — searching "sign" returns too many hits; cause — the bundle compresses variable names; fix — search a signature string (`sign=`) or walk back the call stack of the request from the network panel's initiator column (faster than searching the source)
- **A local reproduction does not match**: symptom — the signature logic is right but the server does not accept it; cause — the parameter order or the timestamp precision is wrong; fix — check the source's sort logic (alphabetical by key, plus special-character rules). The timestamp uses `Math.floor(Date.now() / 1000)` (seconds)
- **The key is in another chunk**: symptom — the key is not inside the signature function; cause — the key is brought in from another chunk through require; fix — at a breakpoint in the signature function, console.log the key variable
- (source: reverse-skill field-journal, MIT)
- **Restore a transpiled product before analyzing it**: symptom — the JS shows a `var state=0; while(true){switch(state){…}}` state-machine loop or a `_asyncToGenerator(function*(){…})` wrapper, and the logic looks like a tangle; cause — generator/async was lowered by a transpile chain such as Babel/Regenerator into a state machine and a wrapper, and the source-level meaning was flattened mechanically; fix — after recognizing the "a while whose condition is a real constant + a single switch body" pattern, flatten it into linear statements in case order, and the artificial state variable disappears. For async, scan the whole program for the wrapped generator functions first, then restore Yield inside the function body to Await and inline the wrapper. Look at helper function names first and confirm the transpile chain (Babel/Regenerator and the rest each have a signature fingerprint). An inverse transform written for a known toolchain is less work than a generic recovery
- (source: hermes-decomp (SymbioticSec), MIT)
- **Compute the edit length before patching**: symptom — the edited script or bundle will not run, or a structure table parses wrongly; cause — a same-length edit can overwrite in place, and a changed-length edit moves every later offset and structure segment. Writing without updating them together corrupts the file; fix — same length → overwrite in place, and do not touch the structure table. A changed length → rebuild the affected structure segment (for example the string table), move the later segments, and correct every offset together. Refuse a patch of shared storage or overlapping references. After the patch, parse the structure table again as a consistency check, and roll back if it is inconsistent — an unsupported case errors explicitly. Never keep writing and corrupt the file (the general rule is the matching pitfall entry in [[re-hybrid-app]]; the Hermes layout is in that skill; source: hermes-decomp (SymbioticSec), MIT)

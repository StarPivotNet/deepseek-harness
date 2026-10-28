---
name: re-analyze
type: entry
description: >
  Sole entry for reverse analysis. Flow: environment probe (probe.sh) → preference questions (goal / decompiler / depth / report / platform) →
  task identification (triage.md) → orchestrate category gateways.
  Triggers: `分析`, `逆向`, reverse, RE, `帮我看看这个文件`, `这个样本是干什么的`,
  `脱壳`, `找密钥`, `破解`, `固件分析`, `恶意软件分析`, analyze this binary.
---

# Reverse-analysis entry

<TARGET-AWARE-GATE>
Decide from the input type whether an environment probe is required, then continue. Do not skip the probe and analyze a binary file or sample directly.
</TARGET-AWARE-GATE>

## Step 0: Input-type decision and environment probe

**Input type → probe decision**:

| Input type | probe |
|---|---|
| File / sample (executable, firmware, archive, document, APK, and so on) | required |
| Binary / firmware analysis request (target is on disk) | required |
| Phenomenon description / no sample (`某程序不落盘` / `行为异常`; the target is running) | required (live acquisition needs tools and an environment probe) |
| Code fragment (C / assembly / pseudocode the user pasted) | skip |
| Decompiler screenshot / disassembly text (no file to analyze) | skip |
| Protocol description / logic question (no binary target) | skip |

- **When probe is required**: run `references/probe.sh` (or the equivalent commands by hand on this machine) and record:
  - `RE_OS` / `RE_ARCH` / `RE_CORES` / `RE_MEM_GB` (probe failure → ask the user)
  - `RE_TOOLS`: HAVE list (installed, prefer these) and MISS list (not installed, **do not abort the flow**; the skill that needs a tool will guide installation)
  - See the experience for this platform's branch in [[platform-tips]]
- **When probe is skipped**: no OS/ARCH/MEM requirement — set `RE_OS`/`RE_ARCH`/`RE_CORES`/`RE_MEM_GB`/`RE_TOOLS` to `unknown`. Later steps and skills ask only when they need a value. Do not block the entry.

## Step 1: Preference questions (tiered)

Follow the tier rules in `references/preferences.md` (**do not ask every item by default**):
- **Level 0 quick entry (default)**: the goal is an initial analysis, or it is not yet clear → take the defaults (goal = initial analysis, Ghidra, standard, report yes, platform auto) and go to step 2
- **Level 1 deep task**: the goal is clearly a deep task (unpack / vulnerability / protocol reverse engineering / deep malware analysis / cracking / forensics, and so on), or the user asks → ask all 5 items:
  1. **Analysis goal** (required, first item) — if unclear, keep asking
  2. Decompiler: Ghidra (default) / IDA / radare2
  3. Depth: quick conclusion / standard analysis / deep report
  4. Report: yes / no
  5. Platform confirmation: auto / manual

Store the result in session variables (`RE_GOAL`, `RE_DECOMPILER`, `RE_DEPTH`, `RE_REPORT`, `RE_TARGET_PLATFORM`). They stay valid for this analysis and are read by called skills.

**Safety floor**: if the goal involves running a sample → remind the user of the default-sandbox principle (highest principle in [[platform-tips]]).

## Step 2: Task identification

**Identify the target first**: if it is unclear **which system** the target belongs to, go through [[system-fingerprints]] first — **step 0 is evidence attribution** (which objects are in the container, each object's scope, which one is the subject; **a hit across scopes records existence only**), then carrier and format → super-family narrowing → identification inside the family → easy-to-confuse pairs → negative criteria. In many cases **ELF `EI_OSABI` and the note segment decide it in one step**; if there is no container image, look for magic numbers and signature strings; when a config file is present, **the config format itself is a strong criterion**.

**If you cannot decide, do not force a decision**: a settled family with an unsettled system is better than guessing a system and sending the whole analysis chain off course. Advance on the family-level branch.

Use the decision table in `references/triage.md` to map `RE_GOAL` + the input file to one orchestration path. For a compound goal, chain category gateways in dependency order.

**Judge authorization context first**: follow triage step 0 and set `RE_AUTH` (owned / ctf / research / unknown) — patch / bypass / dynamic execution and other sensitive paths are constrained by it (same authorization boundary as [[re-cracking]]).

## Step 3: Routing engine (state machine)

A skill is not a call chain. It is a **state transition**: each skill produces new evidence, and the evidence drives the next hop.

```
triage → route → skill execution → evidence → route (loop)
```

Call the matching category gateway (`[[re-binary-core]]` `[[re-malware]]` `[[re-firmware]]` `[[re-protocol]]` `[[re-mobile]]` `[[re-anti-analysis]]` `[[re-cracking]]` `[[re-vuln]]` `[[re-ctf]]` `[[re-managed]]` `[[re-forensics]]`). The gateway chooses atomic skills itself.

**Route State (loop guard)**:
- `visited`: skills already entered (session variable `RE_VISITED`)
- `max revisit`: 1
- **Rule**: a second entry into the same skill must carry **new evidence** (an increment since the last entry — a new string / new behavior / new structural feature). No new evidence means no re-entry. Return to the current skill's alternate branch, or close out on table B in [[rerouting]] (prevents binary-core ↔ crypto ↔ anti-analysis loops)

**Two-track reroute (mandatory, see [[rerouting]])**:
- Track 1 (required check when a gateway finishes): after each gateway, check new evidence against tables A/B in [[rerouting]]; on a hit → call the matching skill, then return to track 1
- Track 2 (check as soon as evidence appears): each time analysis produces a new evidence type (string content such as a key / C2 / packer name, section table, behavior, crypto feature), check table A immediately; on a hit → call the skill
- No table row hit → act under table B constraints (change approach / fall back / deliver a partial conclusion). Do not grind it out alone.

**Cross-system misread table (mandatory before a judgment)**: whenever you are about to write "this is a hook / dead code / loader bug / malicious", check [[cross-system-models]] first — the ten high-frequency misread rows + shared cross-system rules (local handle ≠ global identity, ready ≠ eligible to run, no kernel entry ≠ no I/O, no CFG edge ≠ it did not happen, disk ≠ running) + the exception-handling tree. Rule out, item by item, **normal mechanisms that this execution model allows**. Write the exclusion process and the basis into the report. **Do not write the conclusion until exclusion is finished**.

The whole analysis follows [[analysis-contract]]: before analysis, collect the context checklist (including the investigation budget, ≤8 tool calls per target per tier); between stages, pass fields by the data contract (do not rescan); before delivering a conclusion, do an independent review (evidence ↔ conclusion, line by line) and emit the structured format with a confidence grade.

## Step 4 (optional): Experience review

After the conclusion is delivered, ask whether this session's pitfalls / new methods should be fed back into the skill library. If yes, call [[re-feedback]] (three tiers: file an issue / store locally / do not store; distillation must be redacted; see that gateway's hard lines).

## When to use / when not to use

- Use: any reverse-engineering / malware / firmware / protocol / mobile / cracking / CTF analysis request
- Do not use: a precise request already triggered by a specific skill (for example `用 Ghidra 分析这段代码` can go straight to [[re-ghidra]])

## Common pitfalls

- The probe is not decoration: memory <4GB but Ghidra was chosen → suggest radare2
- The goal is "see the logic" but a sandbox is started immediately → static first, dynamic only as needed
- Users with no tools installed are the normal case — do not stall on MISS. Follow Tool preparation and guide the install.

- **Search community reverse-engineering results before digging yourself**: Symptom — writing your own parser / algorithm recovery for a similar target (protocol / packer / signature) takes about 10 times as long as porting. Cause — open-source reverse-engineering projects (protocol implementations, unpackers, emulator callback sets) are prior results and can be ported directly. Fix — search GitHub / Gitee / codeload for similar projects first (even if the version differs, structure and patterns can be reused). Dig yourself only after confirming nothing exists. The site name to search is `码云`.

- **After the entry, no further skills are called**: Symptom — after the entry orchestration, the work is ground out alone; a new feature found mid-way (packer / crypto / anti-debug) does not call the matching skill. Cause — reroute was not run. Fix — follow the two tracks in step 3: after each gateway and on each new piece of evidence, check the trigger table in [[rerouting]] and call on a hit.

- **Treating a large goal as one move and demanding a full analysis at once**: Symptom — "analyze this program" (`分析这个程序`) is taken as a request for the whole analysis plus a complete report; tools and skills return a full dump at once; context bloats and scans repeat. Cause — the long task was not split into a chain of small steps; a large complete output sacrifices explorability and trackability. Fix — split into atomic steps (list strings → check xref → decompile one function). Each step's product carries structured fields such as addresses and symbols and feeds the next step directly. Pull large output by line range / page as needed. Never pull a whole large set at once.
(Source: ReVa (cyberkaida), Apache-2.0)

- **Switching paths when tool arguments do not match, instead of normalizing input first**: Symptom — a parameter error (address / symbol-name shape mismatch, type mismatch) is immediately treated as "tool unusable" or a reason to change approach. Cause — the tool's input layer already tolerates common drift; typical LLM mistakes can be absorbed at the input. Fix — before retrying, normalize: try address ↔ symbol name both ways, add type conversion for numeric / boolean parameters, and strip whitespace differences in signature text (for example `char *func(` and `char* func(` are equivalent). If mutually exclusive parameters conflict, drop one as the error says and retry.
(Source: ReVa (cyberkaida), Apache-2.0)

- **Treating an error as a dead end and not reading the next-step hint in the error text**: Symptom — a tool error stops the work or switches paths, ignoring the repair suggestion in the error text. Cause — the error is treated as an endpoint rather than a decision point. Fix — error messages usually carry enough correction context (similar-name suggestions, available lists, precondition hints such as `先反编译再改名` / `先定义函数再修改`). Correct and retry from the hint. A retry costs less than switching paths.
(Source: ReVa (cyberkaida), Apache-2.0)

- **Long-task context bloat: waiting synchronously for the full result vs cursor incremental polling**: Symptom — minute-scale analysis (full auto-analysis, batch compare) is waited on synchronously, or old results are re-queried, and repeated content crowds the context so later judgment is diluted. Cause — long-task context was not managed with a "small slice + increment" mechanism. Fix — hand the long task to a background job, take back the job id + log cursor, and continue immediately. Poll only lines added after the cursor. Take the full result at the terminal state. Run other stages in parallel in between. The same on the output side: count a list before listing it, default to compact mode (name + address + size), and turn on verbose only when detail is needed — never pull a large collection all at once.
(Source: ReVa (cyberkaida), Apache-2.0)

- **Stalling when the preset tools do not cover the need, instead of using the script escape hatch**: Symptom — the standard toolchain lacks the capability (batch work, custom logic) and the work stalls or is abandoned. Cause — a direct script path was not treated as a fallback, or scripts were abused to bypass a dedicated tool. Fix — tools first: confirm there is no dedicated skill / tool before detouring to a script. Script execution has guardrails (output truncation, timeout, exception capture, write only to the registered script directory). Inline code goes through a temp file. Feed script products back into structured fields and continue the later stages.
(Source: ReVa (cyberkaida), Apache-2.0)

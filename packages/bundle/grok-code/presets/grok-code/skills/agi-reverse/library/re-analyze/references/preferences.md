# Preference questions: tiered question set and defaults

Before the entry orchestrates a task, handle preferences by **tier**. Store the result in session state for the whole analysis.

## Tier rules

- **Level 0 quick entry (default)**: the goal is clearly "initial look / what does this file do", or the goal is not yet clear — **do not ask item by item**. Start with the defaults:
  | Item | Default |
  |---|---|
  | Goal | Initial analysis (type / malice / entry / key behavior) |
  | Decompiler | Ghidra |
  | Depth | standard |
  | Report | yes |
  | Platform | auto |
- **Level 1 deep task**: the user's goal is clearly a deep task (unpack, vulnerability research, protocol reverse engineering, deep malware analysis, cracking, forensics, and so on), or the user asks to configure — ask all 5 items below.

## Required question (Level 1, first item)

### 1. Analysis goal (natural language, required)
What should this achieve? Examples:
- Decide whether this sample is malicious and whether it calls home
- Unpack and extract a clean sample
- Find a key / registration code / algorithm
- Recover the logic of a function
- Confirm whether a vulnerability exists

If the goal is unclear, keep asking until it is actionable. The goal selects the path in triage.md.

## Choice questions

### 2. Decompiler
| Option | Basis |
|---|---|
| Ghidra (default recommendation) | Free and open source, cross-platform, smoothest on Linux |
| IDA | Commercial (IDA Free exists: x86/x86-64 only, no SDK/IDAPython, non-commercial), strongest Windows ecosystem, rich plugins; recommend when the user explicitly picks it or the target is closed-source Windows software. **Do not hard-code a version generation here** (it drifts); when a version matters, use the official release |
| radare2/rizin | Lightweight CLI, terminal-friendly, strong scripting; use when memory is tight or the workflow is CLI |

Memory <4GB → warn that Ghidra may struggle; suggest radare2 or more memory.
**The recommendation does not depend on what is already installed** (the general case is that nothing is installed).

### 3. Analysis depth
- Quick conclusion / standard analysis / deep report

### 4. Written report
- Yes (report flow: IOC/YARA and so on) / no

### 5. Platform confirmation
- Auto-detect (from the file format when a file is present) / specify manually

## State handoff

Store the probe.sh results and the answers above in session variables: `RE_OS`, `RE_ARCH`, `RE_MEM_GB`, `RE_TOOLS` (HAVE/MISS lists), `RE_GOAL`, `RE_DECOMPILER`, `RE_DEPTH`, `RE_REPORT`, `RE_TARGET_PLATFORM`. Called skills read these variables (for example `RE_DECOMPILER=ghidra` → the decompile step goes straight to re-ghidra; a tool marked `MISS` → run that skill's Tool preparation install steps first).

---
name: re-ai-triage
type: atomic
description: >
  First entry for AI model analysis (router): identify the input form — a model file goes to file-layer reversing (re-ai-model),
  API only goes to behavior-layer assessment (re-ai-attack), malicious behavior goes to malware analysis.
  Triggers: `AI模型分析`, `AI模型安全`, `模型文件`, `模型泄露`, `模型逆向`, `模型分析入口`.
capabilities: [triage]
---

# AI model analysis entry (router)

## Task classifier (input form → path)

After you have an AI-related target, first judge the input form and hand off to the matching skill:

| Input form | Path |
|---|---|
| Model file in hand (.onnx / .pt / .pth / .safetensors / .tflite) | → **[[re-ai-model]]** (file layer: format parsing / structure recovery / weight extraction / file-level watermark) |
| API only (no file, black-box interface) | → **[[re-ai-attack]]** (behavior layer: extraction / fingerprint / privacy / robustness assessment; guard authorization first) |
| Both file and API | → [[re-ai-model]] first (file-side forensics) → then [[re-ai-attack]] (behavior-side verification) |
| Malicious behavior found (poisoning / backdoor / malicious payload / download-and-execute) | → malware analysis (now: [[re-ai-model]] security-boundary handling + [[re-behavior]]; a future standalone re-ai-malware will take this) |
| Model packed inside an executable (PyInstaller/pyarmor and similar) | → unpack with [[re-binary-core]] first → route the extracted model file back through this skill |

## When to use / when not to use

- Use: the user says "analyze this model / AI model security / model leak" but does not name the input form — route first
- Use: when it is unclear whether the target is file-layer or behavior-layer — identify, then hand off
- Do not use: the input form is already clear (go straight to [[re-ai-model]] or [[re-ai-attack]]; do not detour through this skill)
- Do not use: a non-AI target (use the global entry [[re-analyze]])
- Do not use: training / fine-tuning / deployment (not reverse engineering)

## Tool preparation

This skill only identifies and routes; tools stay light:

### python3 / file — model-file identification

- python3 install and verify: see [[re-python]] tool preparation
- `file`: Linux `apt install file` / `dnf install file` / `pacman -S file` (usually preinstalled); verify `file --version`
- Verify: `python3 -c "import struct"` (stdlib)

### Model-library probe (judge target dependencies; do not load the model)

- `pip list 2>/dev/null | grep -iE 'torch|tensorflow|onnx'` — confirm this machine can parse the target format; if missing, the downstream skill guides the install

## Procedure

1. **Identify the input form**:
   - The user gave a path/file → first `file <path>` + `xxd <path> | head -2` for a rough look, then hand off to [[re-ai-model]]. Reliable signals for several forms (**bytes win, not the extension**; details in [[re-ai-model]] step 1):
     - **onnx**: a protobuf stream with no fixed magic; `file` reports `data`; the first byte is the ir_version tag `0x08`, **the second byte is the version number and increases with the ONNX version (it is not the constant `08`)**; `producer_name` is only SHOULD per the spec
     - **safetensors**: `file` reports `data` — the first 8 bytes are the little-endian header length, and the JSON header follows (`xxd -l 16` shows the length field and `{`)
     - **pytorch**: newer builds are a zip container; `file` reports `Zip archive` (`PK\x03\x04` header); `unzip -l` shows entries such as `data.pkl`; older builds are a raw pickle stream (no `PK` header; `file` often misreports `XENIX 8086 relocatable or i286 small model`) — **do not load directly**; see [[re-ai-model]] pitfall 2
     - **tflite**: a flatbuffers stream; `file` reports `data`; bytes 4–7 are the file identifier ASCII `TFL3`
   - The user has only an API endpoint / query capability → hand off to [[re-ai-attack]]
   - Both → file first, then behavior, per the task classifier
2. **Confirm target ownership**: who holds the file/API and the authorization (owned / authorized test / CTF·research) — must be confirmed before behavior-layer assessment ([[re-ai-attack]] guard precondition; authorization context is triage step 0 `RE_AUTH`)
3. **Hand off and record**: name the destination skill + session variables (`RE_GOAL`, `RE_AUTH`, input-form mark); do not do deep analysis in this skill

## Cross-domain joins

- [[re-managed]]: this skill is the first hop of its AI branch (re-managed → re-ai-triage → re-ai-model / re-ai-attack)
- [[re-ai-model]]: file-layer downstream
- [[re-ai-attack]]: behavior-layer downstream (guard authorization first)
- [[re-binary-core]]: unpack precondition when a model is packed into an executable
- [[re-behavior]]: collaboration on the malicious-behavior side (behavioral judgment of poisoning/backdoors)

## Common pitfalls

- **Guessing the format from the file name**: `.pt` may be pickle or a zip container (newer torch format); `.bin` may be an arbitrary weight dump — trust `file` output and magic, not the extension
- **Routing too deep**: this skill only identifies and hands off; it does not expand the analysis — deep analysis at the routing stage duplicates the downstream skill
- **Missing the authorization precondition**: behavior-layer assessment ([[re-ai-attack]]) has a guard authorization requirement — confirm `RE_AUTH` before handoff; if ownership is unknown, ask first and do not enter the behavior layer directly

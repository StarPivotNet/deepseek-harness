---
name: re-ai-model
description: >
  AI model-file reversing and static analysis: ONNX/PyTorch/Safetensors/TFLite format parsing,
  network-structure recovery, weight extraction, file-level watermark analysis (weight pattern/metadata/tensor hash/embedding anomalies).
  Triggers: `模型文件`, `权重提取`, `ONNX解析`, `safetensors`, `pth分析`, `pt文件`, `模型结构还原`, `文件级水印`
capabilities: [ai-model-analysis]
---

# AI model reversing (ONNX / PyTorch / Safetensors)

## When to use / when not to use

- Use: you have a model file such as .onnx / .pt / .pth / .safetensors / .tflite and need to recover the network structure and extract weights
- Use: **file-level watermark** detection (where the thing is hidden: weight pattern / metadata / tensor hash / embedding anomalies — check the file side first when you suspect the model was copied or fine-tuned from an original)
- Use: the model file itself is the payload — data hidden in weights, malicious pickle packed by torch.save, backdoor/poisoned models (download-and-execute samples)
- Do not use: **behavioral watermarks** (what the model exhibits: trigger response / query response / black-box fingerprint) and API behavior-layer attacks (go to [[re-ai-attack]])
- Do not use: a pure inference script / training code (that is source; go to [[re-script-deob]])
- Do not use: a model packed into an executable (PyInstaller/pyarmor and similar) — unpack with [[re-binary-core]] first, then bring the extracted model file back to this skill
- Boundary: this skill = model-file parsing / structure analysis / weight analysis / file-level watermarks — malicious-model decisions, poisoning/backdoor behavior, and attribution forensics belong to the forensics domain (a future standalone re-ai-malware skill will take them; for now such requests stay in this skill and are handled at the security boundary (pitfall 2 pickle isolation), with the behavior side handed to [[re-ai-attack]])
- Note: **safety — do not torch.load an unknown pkl directly** (pickle deserialization can run arbitrary code; see pitfall 2); any load of an unknown pkl defaults to an isolated environment ([[re-analyze/platform-tips]] sandbox supreme rule); read before you run; model parsing / weight extraction are static steps and can skip the sandbox

## Tool preparation

See [[re-analyze/platform-tips]] — model files of several GB are common. Static analysis follows "static first (large samples)": identify the format and parse the structure first, extract weights on demand, and do not load the whole file into memory (pitfall 1).

### python3 — base for every parsing script

- Linux: `apt install python3` / `dnf install python3` / `pacman -S python`
- macOS: `brew install python3`; Windows: `choco install python`
- Verify: `python3 --version` (every script in this skill is Python 3)

### onnx (pip, Python 3.10+) — primary ONNX parser

- `pip install onnx` (official PyPI; current onnx requires Python 3.10+; the exact version follows PyPI Requires-Python; it vendors the protobuf dependency and `onnx.proto3` type definitions)
- Verify: `python3 -c "import onnx; print(onnx.__version__)"`

### netron (pip, Python 3) — model visualization

- `pip install netron` (official PyPI, no upper Python bound); optional desktop builds: macOS `brew install --cask netron`, Windows `winget install netron`, Linux snap `snap install netron`
- Verify: `netron --help` produces output (`pip show netron` for the version)
- Usage: `netron model.onnx` (starts a local http server and opens a browser visualization; `--no-browser` is headless)

### torch (pip, Python >=3.10) — PyTorch model loading

- Linux/Windows: `pip install torch` (the default PyPI wheel is a full CUDA package, several GB; CPU-only analysis uses `pip install torch --index-url https://download.pytorch.org/whl/cpu`)
- **Python lower bound**: current torch 2.x requires **Python >=3.10** (PyPI `requires-python`; torchvision matches at >=3.10) — a 3.9 environment must pin an older release that still supports 3.9 (2.8.x and earlier). The exact torch / torchvision / Python combination follows the official compatibility matrix; do not generalize it as "3.9+"
- macOS: `pip install torch` (official wheel is CPU/arm64)
- Verify: `python3 -c "import torch; print(torch.__version__)"`
- **Safety note**: torch.load is pickle underneath — do not load an unknown pkl directly; PyTorch 2.6+ defaults to `weights_only=True`; older versions / an explicit `weights_only=False` still risk arbitrary code execution; rough-check an unknown model with `unzip -l`/`xxd` first (pitfall 2), load with `weights_only=True` in an isolated environment, and convert to safetensors when you can

### safetensors (pip, Python 3) — safe-format reader

- `pip install safetensors`; verify: `python3 -c "import safetensors; print(safetensors.__version__)"`
- It is designed for no code execution (pure data + a JSON header) and is an alternative analysis entry for an unknown pkl (one of the pitfall 2 fixes)

### protobuf / protoc (onnx is proto) — underlying format

- Python binding: `pip install protobuf` (current 7.x requires **Python >=3.10**; the floor has been rising since 6.x; 3.8/3.9 must pin a matching older version. onnx already depends on it, so a separate install is usually unnecessary)
- protoc compiler: Debian/Ubuntu `apt install protobuf-compiler`, Fedora `dnf install protobuf-compiler`, Arch `pacman -S protobuf`, macOS `brew install protobuf`
- Verify: `protoc --version`; `python3 -c "import google.protobuf; print(google.protobuf.__version__)"`

## Procedure

Run in order. Archive each step's artifacts (model hash / structure summary / weight inventory) with sha256 + path ([[re-ioc]] evidence chain).

1. **Identify the model format (onnx / safetensors / pytorch pkl / tflite)**:
   ```sh
   file model.bin && sha256sum model.bin > model.sha256 && xxd model.bin | head -2
   ```
   - **ONNX**: no fixed magic — a protobuf stream whose first field is ir_version (tag `0x08` + a varint; **the value increases with the ONNX version**: IR 8 corresponds to ONNX 1.10, and current releases have reached IR 13 — so the second byte is not the constant `08`, and `08 08 12` is not an identification feature); producer_name (tag `0x12`, length-prefixed) is only SHOULD per the spec and is not guaranteed to follow immediately; `onnx.checker.check_model` can validate it
   - **Safetensors**: the first 8 bytes = a **little-endian** u64 header length (`struct.unpack("<Q", data[:8])`), followed by a JSON header (tensor name/shape/dtype/offset)
   - **PyTorch**: `file` shows Zip archive (`PK\x03\x04` header) — `unzip -l model.pt` lists entries (a state_dict contains `data.pkl`; torch.jit.script contains `data.pkl`/`constants.pkl`/`bytecode.pkl`); an older pure pkl is a raw pickle stream (no PK header) — **do not load it directly**; rough-check with xxd/strings first (pitfall 2)
   - **TFLite**: a flatbuffers stream — no fixed magic, but bytes 4–7 are the file identifier `TFL3` (the schema `__model_identifier` field), visible in xxd/strings; structure parsing can use Netron (it visualizes .tflite); the weight-extraction branch follows the same idea as onnx (flatbuffers parsing; when it exceeds this skill's depth, mark "structured dump is authoritative")
   - After the decision, take the branch for that format; if unsure, start with a [[re-triage]] survey (entropy/strings features)

2. **Parse the structure (graph / layers / operators)**:
   ```sh
   netron model.onnx --no-browser          # visualize (open a browser only when a GUI is available)
   python3 - <<'PY'
   import onnx
   m = onnx.load("model.onnx")
   print("producer:", m.producer_name, m.producer_version)   # framework/optimizer fingerprint (see pitfall 3)
   g = m.graph
   print("inputs:", [(i.name, [d.dim_value for d in i.type.tensor_type.shape.dim]) for i in g.input])
   print("nodes:", len(g.node), "initializers:", len(g.initializer), "outputs:", [o.name for o in g.output])
   for n in g.node[:20]:
       print(n.op_type, n.name, list(n.input), "->", list(n.output))
   PY
   ```
   - PyTorch side: `torch.jit.load` yields a ScriptModule whose `model.graph` can be printed (TorchScript structure); a `torch.load` state_dict has tensors **and no network structure** — the structure lives in the training/inference script and must be recovered with source (see cross-domain [[re-script-deob]])
   - What to watch: operator sequence (structural fingerprints such as convolution/attention), input/output tensor shapes, constant-node placement (where the weights hide)

3. **Extract weights (tensor dump)**:
   ```sh
   mkdir -p weights
   # ONNX: land tensors one at a time (large models: see pitfall 1)
   # Note: this is not "streaming" — to_array() fully reads a tensor that uses external data into an ndarray,
   #       one tensor at a time rather than the whole model at once; the memory peak is the largest tensor
   python3 - <<'PY'
   import onnx, numpy as np
   m = onnx.load("model.onnx", load_external_data=False)     # load graph structure only, not external weights
   for init in m.graph.initializer:
       # base_dir defaults to the empty string — if external weights are not in the CWD, pass their directory explicitly
       arr = onnx.numpy_helper.to_array(init, base_dir=".")   # this tensor is fully materialized here
       np.save(f"weights/{init.name.replace('/', '_')}.npy", arr)
       print(init.name, arr.shape, arr.dtype)
       del arr                                                # release promptly so the next tensor can use the memory
   PY
   # Safetensors: lazy per-tensor reads (do not load the whole file into memory)
   python3 - <<'PY'
   from safetensors import safe_open
   with safe_open("model.safetensors", framework="numpy") as f:
       print(len(f.keys()), "tensors")
       for k in list(f.keys())[:10]:
           t = f.get_tensor(k); print(k, t.shape, t.dtype)
   PY
   # PyTorch state_dict (weights_only safe load; see pitfall 2)
   python3 - <<'PY'
   import torch
   sd = torch.load("model.pth", weights_only=True)
   for k, v in list(sd.items())[:10]:
       print(k, tuple(v.shape) if hasattr(v, "shape") else type(v))
   PY
   ```
   - Output: a weight inventory (tensor name/shape/dtype/numeric summary) + npy archives — the raw material for watermark detection and theft decisions

4. **Model watermark / fingerprint detection (embedded in weights)**:
   - Weight level: per-tensor stats (min/max/mean/std, histogram bins) compared with the suspected original; watermarks are often embedded in specific layers (first-conv bias, normalization scale, embedding-matrix rows), usually as low-bit perturbation — check low-bit patterns and numeric-distribution anomalies in key tensors, not exact equality (pitfall 4)
   - Fingerprint level: a sha256 digest of all weights and a per-layer tensor-hash sequence; compare per-layer distance (L2/cosine) with the candidate original and emit a "per-layer distance heatmap"
   - Behavior level: run both models on the same test input set and compare logits and activation distributions — a retrain/distillation thief has different weights but close behavior
   - Output: a similarity matrix + heatmap; the conclusion states the decision basis and the threshold

5. **Model-theft decision (architecture similarity)**:
   ```sh
   python3 - <<'PY'
   import onnx
   from difflib import SequenceMatcher
   m1 = onnx.load("suspect.onnx"); m2 = onnx.load("original.onnx")
   s1 = [n.op_type for n in m1.graph.node]; s2 = [n.op_type for n in m2.graph.node]
   print("op-seq similarity:", SequenceMatcher(None, s1, s2).ratio())   # operator-sequence similarity
   # per-layer weight cosine/L2 distance after layer alignment: see the per-layer distance matrix in step 4
   PY
   ```
   - Dimensions: operator sequence (SequenceMatcher), input/output shapes, per-layer weight cosine/L2, output-logit distance
   - Decision discipline: one dimension is weak evidence (same architecture, different training = normal); claim theft only when several dimensions agree and the weight distributions are very close (for example per-layer cosine >0.99), and record each dimension's number in the conclusion
   - Hidden-payload check: `m.metadata_props` (strings/code hidden in ONNX metadata), extra files among zip entries (related to pitfall 2), anomalous tensors whose shape or numeric distribution stands out

## Cross-domain joins

- [[re-managed]]: after this gateway's "identify the runtime" step recognizes an AI model file, it always calls this skill (a model is the managed-domain branch of "code inside data")
- [[re-binary-core]]: code embedded in a model, or a model packed into an executable (an inference program packed by PyInstaller/pyarmor) — disassemble in the binary domain first (format parsing / decompilation), then bring the extracted model file back to this skill
- [[re-sandbox]]: any load of an unknown pkl defaults to an isolated environment ([[re-analyze/platform-tips]] supreme rule)
- [[re-malware]]: behavior and intelligence side of malicious model payloads (pickle malicious code, backdoor weights, poisoned-model distribution)
- [[re-ioc]]: model fingerprints (sha256 / tensor hash / watermark pattern) enter IOCs; [[re-triage]]: model-file survey entry and hash archive
- [[re-script-deob]]: recover PyTorch inference/training scripts (the completion path when a state_dict has no structure)
- Cites the [[re-analyze/platform-tips]] static-first (large samples) and sandbox-supreme-rule branches
- [[re-ai-attack]]: **file-level evidence → behavioral verification** (one-way data flow) — file-side conclusions from this skill (structure / weights / file-level fingerprint) are inputs to re-ai-attack behavioral-consistency checks. Example: given suspect.pt → this skill extracts structure + weights and builds a fingerprint → hand off to re-ai-attack for behavioral consistency (API-side comparison)
- API-only assessment (no file) goes straight to [[re-ai-attack]] and does not pass through this skill

## Common pitfalls

- **Huge model files (GB scale)**: symptom — `onnx.load`/`torch.load` fills memory and hangs, netron times out opening the file, batched `np.save` fills the disk; cause — weights are several GB and were loaded into memory all at once; fix — before analysis, archive with `du -sh`/`sha256sum`; for ONNX use `onnx.load(..., load_external_data=False)` to load graph structure only, then read **one tensor at a time** — note that `numpy_helper.to_array()` **reads that tensor in full** (it is not streaming), so the peak depends on the largest tensor, and with external data you must **pass `base_dir` explicitly** (the default is the empty string, and it fails immediately when weights are not in the CWD); Safetensors uses `safe_open` for lazy per-tensor reads; large PyTorch models use `torch.load(..., mmap=True)`; the object of analysis is "structure summary + targeted tensors", not the whole file
- **pkl deserialization risk (do not torch.load an unknown pkl directly)**: symptom — after load the process reverse-shells / files are deleted, or you get a strange `AttributeError`/`ModuleNotFoundError`; cause — the pickle protocol can inject arbitrary code (`__reduce__`/`__setstate__`), torch.load is pickle underneath, and a malicious model is a poisoned payload carrier; fix — **safety: never `torch.load` an unknown model directly**; rough-check first with `unzip -l`/`xxd`/`strings` (zip header PK vs raw pickle, and whether entries contain suspicious module names), load with `weights_only=True` (default on PyTorch 2.6+), and when a full-featured load is required run it in an isolated environment ([[re-sandbox]]); samples that can be converted to safetensors should be converted (pure data, no code execution)
- **Graph optimization obscures layer structure**: symptom — after onnx-simplifier/TensorRT/onnxruntime optimization the operator sequence does not match the training graph (Conv+BN fused into one Conv, constant folding, names all rewritten) and structure similarity is misjudged; cause — the optimizer fused operators / folded constants, so the graph differs from training time and the producer field changes; fix — read `m.producer_name`/`m.producer_version` first to identify the optimizer and version (fused ConvBN signature: the BN layer disappears and scale is folded into the conv weights); before architecture comparison, normalize the operator sequence (abstract by operator class; ignore names and constant differences); use onnx-simplifier / onnxruntime `graph_optimization_level` to diff before and after optimization and recover the original layers
- **Watermark robustness (survives pruning)**: symptom — an exact-value comparison misses and you conclude "no watermark", or two unrelated models that happen to be numerically similar in a few layers are misjudged as "theft"; cause — a robust watermark is designed to survive pruning / quantization / retraining, so exact match must miss; models with the same architecture and the same data have similar weight distributions, and a single-layer coincidence is a false positive; fix — detect watermarks by "statistical anomaly" (low-bit perturbation / layers with an unusual numeric distribution) rather than "exact equality", and decide theft with multi-dimension evidence + a threshold (step 5 discipline); the conclusion states confidence and evidence strength

# Analysis contract

Three contracts for the whole analysis: before (context checklist + investigation budget), during (fields passed between stages), after (review format). Every gateway and atomic skill follows this contract while analyzing.
Mid-analysis reroute: evidence triggers follow the two tracks in [[rerouting]] (track 1 required check when a gateway finishes / track 2 check as soon as evidence appears). On a hit, call the matching skill.

## 1. Analysis context checklist (before analysis)

Before analyzing a target, collect the following context, then start. **Expand the four general items by target domain** (domain fields are in section 3.2). Do not force file-domain fields onto other domains:

- Target identity: identifier (path / endpoint / device / package name / model file), hash (sha256), size
- Structure (**taken by domain**): file domain = architecture / format / section table / imports and exports; protocol domain = endpoints / ports / frame samples; automotive domain = arbitration ID / period / DLC; RF domain = center frequency / sample rate / modulation; model domain = format / tensor list; TEE domain = TA / session / SMC number; forensics domain = source device / timeline
- Related information (**taken by domain**): file domain = xrefs / caller / callee / referenced strings; protocol domain = request-response pairs; model domain = inter-layer dependencies and operator sequence; forensics domain = the same record across data sources
- Known leads: already named / recovered structure (symbol table, struct / field semantics, protocol field names), conclusions already reached in this session (passed across stages)

Record items that cannot be collected as `未知`. That does not block the start — but skipping collection and analyzing directly is forbidden.

## 2. Investigation budget (during analysis)

- **Soft budget, not a hard cap**: actively requesting extra evidence (xrefs / decompile / memory read, and other tool calls) is **one tier per 8 calls** — **reaching a tier requires a reassessment** (does the current hypothesis still hold, is the next evidence gain still worth it), **not a ban on continuing**. A complex target (large firmware / kernel / protocol / obfuscated program) may enter the next tier after the reassessment passes
- **At a tier, pick one of three**: continue (state the new evidence hypothesis) / change path (follow the pivot chain) / close out (deliver a partial conclusion + confidence). Record the assessment so it can be reviewed
- Same parameters repeated ≥2 times with no new evidence → change approach; a single command ≥3 times with no progress → stop and assess
- Preload evidence first: give the context checklist in one pass to cut round trips

## 3. Data contract (during analysis, passed between stages)

Fields passed along a chain (entry → domain stage → later stages) have **two layers: core fields (required in every domain) + domain extension fields (chosen by target domain)**. This table used to have only a file-domain field set, which does not fit other domains (protocol / RF / automotive / model / TEE / forensics) — take fields by domain. Do not force a fit.

### 3.1 Core fields (every domain)

| Field | Meaning | Produced by |
|---|---|---|
| target_id | target identifier (path / endpoint / device / package name / model file) | entry / [[re-triage]] |
| sha256 | target hash (evidence archive key; a non-file target uses an equivalent fingerprint — pcap hash, firmware image hash, model-file hash) | entry / [[re-triage]] |
| evidence | evidence chain (path + hash + where the command output is) | each stage |
| findings | conclusion list (each item has a grade confirmed / supported / hypothesis and a confidence, see section 4) | each stage |
| unverified | parts this stage could not confirm (matches "unverified items" in the review format) | each stage |

### 3.2 Domain extension fields (choose by target domain; representative skills are examples only)

| Domain | Extension fields | Representative producing skills |
|---|---|---|
| File / binary (PE/ELF/Mach-O/firmware) | arch, format, entropy, sections, imports_exports, strings_refs, base_addr, symbols_known | [[re-triage]], [[re-format-pe]] / [[re-format-elf]] / [[re-format-macho]], [[re-imports]], [[re-ghidra]] |
| Network / protocol | endpoints (5-tuple and session), frames (frame samples and field offsets), state_machine (state transitions), crypto_layer (crypto layer and key source) | [[re-netcap]], [[re-proto-rev]], [[re-tls]] |
| Bus / automotive (CAN and similar) | arbitration_ids (ID/period/DLC), signals (endianness and bit layout), diagnostic_sessions (UDS service sequence), seed_key (algorithm and key source) | [[re-automotive]], [[re-ics]] |
| RF / SDR | center_freq, sample_rate, modulation, sync_words (frame sync word), demod_chain | [[re-sdr]] |
| AI model (file level) | model_format, tensors (name/shape/dtype), graph_ops (operator sequence), watermark_evidence (weight / metadata anomaly) | [[re-ai-model]] |
| AI model (behavior level / API only) | api_endpoints, query_budget, behavior_fingerprint (response consistency), extraction_evidence | [[re-ai-attack]] |
| Mobile / managed code | package, components (Activity/Service), sandbox_paths, jni_map (native method ↔ address), bytecode_units | [[re-apk]], [[re-android-native]], [[re-dotnet]], [[re-java]] |
| TEE / trusted execution | ta_uuid, smc_ids, secure_storage_items, key_derivation | [[re-tee]], [[re-hardware-io]] |
| Forensics / intelligence | device_source, timeline (time/action/source), integrity (hash chain and partition digest), iocs | [[re-mem-forensics]], [[re-disk-forensics]], [[re-mobile-forensics]], [[re-ioc]] |
| Sandbox / behavior | process_tree, persistence, network_behavior, attck_mapping | [[re-sandbox]], [[re-behavior]] |

### 3.3 Passing rules

- **Core fields are required** (record `未知` if they cannot be collected; do not block); **domain extension fields are filled for the target domain** — do not require cross-domain fill (a CAN target does not need sections; a model target does not need base_addr)
- Each stage **only adds, does not rewrite**: later stages append fields alongside the original fields; a conflict follows the new evidence and records the correction
- Output shape: JSON or a structured table; the next stage consumes it directly and does not rescan

## 4. Review format (after analysis)

Before delivering a conclusion, do an **independent review**: reread the conclusion and the evidence from another angle (another model / another tool / a reread after a gap all count) and check line by line:

1. Every conclusion has matching evidence (file path + sha256). A conclusion with no evidence is grade hypothesis
2. If a conclusion contradicts the evidence → the evidence wins; correct the conclusion
3. Mark the **evidence grade** (inference is common in RE; the grade must be marked):
   - `confirmed`: direct evidence is reproducible (byte-level compare / call chain / official documentation)
   - `supported`: several indirect sources agree (strings + behavior + timing corroborate each other)
   - `hypothesis`: inference / single weak source (a conclusion with no evidence is this grade)
   High / medium / low confidence stays as an auxiliary dimension (alongside the grade)

Review output format:

```
Conclusion: <one sentence>
Evidence: <path + sha256 / command-output location>
Grade: confirmed / supported / hypothesis
Confidence: high / medium / low
Unverified: <parts that could not be confirmed during review; leave empty if none>
```

Example:

```
Conclusion: the sample connects to a fixed C2
Evidence: string (c2.example.com, xref to the connect call) + socket call chain
Grade: supported
Confidence: medium
Unverified: whether the C2 is still online
```

### General method index (applies library-wide; activate by guiding to the source when needed)

The methods below are settled in domain skills and apply library-wide — any skill that hits the matching situation guides to the source and activates it:

| Method | Location | When it applies |
|---|---|---|
| Analysis methods (entry / calls / memory / API / obfuscation / dynamic debug / deep / intel and first look / disassembly method / verification / knowledge acquisition, 11 groups) | [[re-binary-core]] "analysis methods" | general technique for any binary analysis (static first) |
| Anti-debug methods (basic detection / exception mechanisms / timing detection / environment features / hardware traces / threads and debug objects / self-modifying breakpoints / deep detection / method, 9 groups) | [[re-anti-analysis]] "anti-debug methods" | any dynamic analysis that hits anti-debug (gdb / x64dbg / mobile / sandbox) |
| Anti-virtualization methods (instruction level / timing and hardware / environment scoring / virtualization channel, 4 groups) | [[re-anti-analysis]] "anti-virtualization methods" | sandbox / VM countermeasures (detection and bypass) |
| Platform experience (install and behavior differences across OS) | [[platform-tips]] | every tool-preparation and cross-platform execution |

### Order for deep analysis of one function

Deep analysis of one function is a **convergence loop**, not a one-way pipeline. The actual shape is "a rough decompile for leads → recover types / constants / call shape → decompile again → until a fixed point":

```
first decompile (take a rough result first: field use, call shape, switch shape, allocation size)
   → recover four kinds of information in alternation: types / constants / vtables / function identity
   → decompile again
   → review for alignment; if conflict remains, go back one step
```

**What is forbidden is "deliver after decompiling once with no review", not "look at a decompile first"** — type recovery often needs one rough decompile before there are leads (field-use / call-shape / switch / allocation size). The four kinds of information to recover:

1. **types — type definitions**: recover parameter / return types and struct fields. Look for: structs referenced by parameters and locals, enum values in switches / comparisons, function-pointer types (callback signatures)
2. **constants — constant definitions**: identify magic numbers and crypto constants. Look for: numeric literals that look like #define, bit masks and the flags they form, magic numbers with semantics (for example the ELF magic — **the byte sequence is `7f 45 4c 46`**, written as a C literal `"\x7fELF"`; when read as u32, watch endianness: little-endian yields `0x464c457f`, only big-endian is `0x7f454c46`), protocol-specific constants, string constants used as a key / identifier
3. **vtables — vtable recovery**: locate the vtable and infer class relationships and call sites. Look for: virtual methods thunked to vtable dispatch, reads / initialization of the vtable pointer, object construct / destruct sequences, multiple dispatch paths
4. **function identity — function name and signature**: name it against the already-named symbol table / imports and exports / call-site evidence. Look for: demangled import/export symbol names, calling convention inferred from call-site analysis, argument count and types inferred from callee references, return type inferred from how the return value is used
5. **Convergence criterion (fixed point)**: **all four must hold at once** — every type is resolved (no bare ID), constants are replaced with meaningful names, virtual-call targets are identified, and the final signature has parameter names. **Every round of edits must be decompiled again and checked**, so a type change is not left unverified. Remaining conflict means the fixed point is not reached; go back to the matching category and continue

Record provenance for each finding (which evidence supports which conclusion). Tools are not bound: each step has an equivalent in Ghidra / IDA / radare2.

### Standard for a negative conclusion

Before writing a conclusion of the "does not exist / not found / not supported" kind, make at least **3 different attempts** (change tool / change angle / change parameters) and list the attempts in the review output. A negative conclusion defaults to confidence "medium" unless the attempt list covers every reasonable path.

### Pivot hint chain

When analysis stalls, change path along the chain: anti-debug countermeasure → patch / hardware breakpoint → obfuscation → dynamic trace → unpack. Record the reason for each change (tied to the investigation budget: same parameters repeated ≥2 times means change approach).

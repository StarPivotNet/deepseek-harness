---
name: re-ioc
description: >
  IOC extraction, YARA rules, and report structure.
  Triggers: IOC, YARA, `写规则`, `分析报告`, `hash列表`
capabilities: [threat-intel]
---

# IOC extraction and YARA rules

## When to use / when not to use

- Use: after analysis, produce an IOC list (hash/domain/IP/path/mutex); write YARA rules for sample detection; produce an analysis report in the standard structure
- Use: behavior evidence needs to be turned into a reproducible, shareable conclusion
- Do not use: behavior/static analysis is not finished yet (IOC raw material is in the products of [[re-behavior]] / [[re-triage]])
- Do not use: the user only wants a one-sentence conclusion (still give at least the IOCs and evidence paths)

## Tool setup

This skill is mostly static processing (writing rules / scanning files) and does not run the sample; running a sample happens only inside [[re-sandbox]] (default-sandbox top principle; see [[re-analyze/platform-tips]]).

### yara — rule engine

- Linux: `apt install yara` / `dnf install yara` / `pacman -S yara`
- macOS: `brew install yara`
- Windows/WSL: `pip install yara-python` (the Python build, cross-platform fallback)
- Verify: `yara --version`; Python: `python -c "import yara; print(yara.__version__)"`

### pefile — PE structure parsing (for writing PE features)

- All platforms: `pip install pefile`
- Verify: `python -c "import pefile; print(pefile.__version__)"`

### VT / grep.app lookup (optional)

- VirusTotal: look up a hash/domain on the web at https://www.virustotal.com/; API key via environment variable:
  ```sh
  curl -s --request GET \
    --url "https://www.virustotal.com/api/v3/search?query=<sha256>" \
    -H "x-apikey: $VT_API_KEY" | python3 -m json.tool
  ```
  Verify: a request with the key returns JSON (401 means the key is invalid)
- grep.app: https://grep.app/ searches characteristic strings in public code. Nothing to install
- Note: confirm the data policy before uploading a private sample to VT; grep.app lookups are only a reference for strings/features

### sha256sum / md5sum (IOC hashes)

- Install and verify via the tool setup in [[re-triage]] (coreutils / Get-FileHash)

## Procedure

Run in order and record each step.

1. **Extract IOCs (by source class)**:
   - File level: `sha256sum sample.exe` (sha256 primary, md5 only auxiliary); compute one each for the unpacked product and for files the dropper writes to disk
   - Network level: domains, IPs, and ports from behavior logs ([[re-behavior]] step 4) and INetSim records; hardcoded URLs found in config/memory (`strings sample | grep -iE 'http|https'`)
   - System level: file paths (persistence locations, drop paths), mutex names (CreateMutex arguments, looked up with [[re-ghidra]] / [[re-ida]] or recorded by procmon)
   - For each IOC class, record the source evidence (log path + line number/timestamp) so the report can cite it
   - Deduplicate + mark confidence (from behavior evidence > static string only)

2. **Writing YARA rules (feature selection + scoring)**:
   - Feature-selection criteria: uniqueness (appears only in that family/sample), stability (does not change easily across versions), discriminability (avoid common library strings)
   - Common feature types: strings (URL/domain/mutex/machine code), PE structure (section names, imports), byte patterns (`{ 4D 5A 90 00 }` or `$a = { E8 ?? ?? ?? ?? }` wildcards)
   - Scoring (annotate in comments; hit-threshold reference): score each feature by information — a unique long string +2, a generic API name +0.5, a short byte pattern +1; one third of the total is a hit-threshold reference, and the final call follows verification
   - Example:
     ```yara
     rule Win32_FamilyX_Dropper {
         meta:
             description = "FamilyX dropper detection"
             author = "analyst"
             score = 4
         strings:
             $url = "http://c2.example.org" ascii wide
             $mutex = "Global\\FamilyX_mutex" ascii wide
             $pe   = { 4D 5A 90 00 }
         condition:
             uint16(0) == 0x5A4D and (2 of them)
     }
     ```
   - Rule-name convention: platform_family_type (for example `Win32_FamilyX_Dropper`)

3. **Report structure** (write in five sections):
   - Summary: a one-sentence conclusion (what the sample is, whether it is judged malicious, the main behavior)
   - Behavior: process / persistence / file / network behavior from [[re-behavior]] + an ATT&CK mapping table
   - Evidence: path + sha256 for each step's products (sample, logs, memory dump, rule file) — the key to reproducibility
   - IOC: the classified list from step 1 + confidence
   - Conclusion: disposition advice (detect-and-remove / block domain and IP / patch advice)
   - Format follows the RE_REPORT preference in [[re-analyze]] (brief / full)

4. **Rule verification (yara scans the sample)**:
   ```sh
   yara rule.yar sample.exe          # a hit → the rule works
   yara -s rule.yar sample.exe       # show the matched feature strings and check them against the sample
   yara rule.yar benign_samples/*    # false-positive test: a known-benign sample directory should have 0 hits
   ```
   - Positive control: after a hit, `yara -s` confirms the matched strings really are malicious features
   - Negative control: the benign sample directory does not hit; a hit is a false positive, return to step 2 and adjust features
   - Full-corpus check: add the rule to the local rule set, rescan every analyzed sample, and confirm there is no regression

## Cross-domain

- [[re-malware]]: workflow step 6 — this skill is the close of malware-sample analysis (IOCs and the report)
- [[re-behavior]]: IOC raw material for step 1 (network-level / system-level IOCs) comes from behavior-analysis products
- [[re-protocol]]: C2 domains/IPs/protocol fingerprints go into the IOC list and YARA features
- [[re-anti-analysis]]: unpacked products, packer fingerprints, and packing behavior can also be YARA feature sources
- Reports and rules go back to [[re-analyze]] (per RE_REPORT) and are shared with the team

## Common pitfalls

- **A feature that is too generic → false positives**: symptom — the rule hits a mass of unrelated files (for example it only wrote `http://` or a common library string); cause — the feature is not unique, and there was no scoring or verification step; fix — step 2 picks features by uniqueness and scores them, and step 4 must run a benign-sample negative control. A false positive means go back and edit
- **Only a hash, no behavior features**: symptom — hash IOCs all fail on new samples/variants; cause — a hash covers only one sample and cannot generalize to a family; fix — besides the hash, give at least a YARA rule or a behavior feature (mutex/domain/byte pattern). Rule conditions use `2 of them`, not a single feature
- **A report with no evidence paths cannot be reproduced**: symptom — the report's conclusion cannot be traced (no log/sample path and hash); cause — evidence was not archived or not written into the report; fix — the evidence section of the step 3 report must give path + sha256 item by item, and IOCs and behavior must correspond to their sources one to one
- **Poor string-atom quality → slow scans and false positives**: symptom — after the rule is written, a full-corpus scan is strangely slow or hits a mass of unrelated files; cause — YARA uses 4-byte substrings as an Aho-Corasick prefilter, and a single byte or a pattern starting with 0x00/0xFF/0x90 forces a huge verification; fix — check atoms with `yr debug atoms` (YARA-X), anchor regexes on literals (`/mshta\.exe http:\/\/.../` rather than `/http:/`), order conditions cheap to expensive (filesize → magic → strings), and "if uint32 will do, do not load a module"
- **A single-sample rule is fragile**: symptom — the rule hits only the current sample and misses every variant of the family; cause — the rule was written from one sample, and features were written against the encrypted layer (content before unpacking); fix — collect 3+ variants before writing; a packed sample with entropy >7 is unpacked first, or the rule targets the packer's structural features (section names, opaque predicates) rather than the encrypted layer; generate candidate strings with yarGen `--excludegood` / FLOSS, and regress with YARA-CI / VT retrohunt
- **Incomplete metadata cannot be maintained**: symptom — after a rule enters an enterprise rule set it cannot be audited (unknown author, what it detects, what it references, which hash); cause — missing author/date/reference/hash metadata and a naming convention; fix — the meta section must carry description (starting with "Detects"), author, date, reference, and hash; name with a prefix such as `MAL_` / `HKTL_` / `SUSP_` plus platform/family/variant/date (for example `MAL_Win_Emotet_Loader_Jan25`)
- **A `for all` loop not bound to filesize → large-file scans explode**: symptom — the rule is fast on a small sample and hangs or times out on a tens-of-MB file; cause — the iteration cap of `for all i in (1..#a)` is bound to the feature hit count, and on a large file `#a` can reach thousands; a form such as `for all i in (1..filesize)` grows directly with file size; fix — always add a filesize bound to the loop condition first (`filesize < 100KB and for all i in (1..#a): ...`), then the feature conditions
- **A uniformly repeated string → the scan reports "too many matches" immediately**: symptom — `yara` reports `string ... caused too many matches` and the rule cannot run; cause — the feature string is long repeated / uniform content (for example `"2222..."`, wide-character space padding), and the prefilter hit count explodes past YARA's protection cap; fix — do not use stacked repeated characters as a feature. Switch to a wildcarded hex pattern or a string with varying bytes so the atom is discriminative (check it together with the existing atom pitfall)

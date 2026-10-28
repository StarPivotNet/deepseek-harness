---
name: re-attribution
type: atomic
description: >
  Threat-attribution methodology: the diamond model, infrastructure graphs, confidence grading, and attribution reports.
  Triggers: `归因`, APT, attribution, `攻击者身份`, `基础设施图谱`, `钻石模型`, `威胁组织`.
capabilities: [threat-intel]
---

# Threat attribution (APT Attribution)

## When to use / when not to use

- Use: an intelligence attribution request ("who did it"), linking several events (decide whether several incidents are the same activity), infrastructure association analysis, reasoning from a sample/capability to an attacker
- Use: an attacker profile of a victim environment (timeline, TTP, and infrastructure features together)
- Use: hunting same-group activity (one incident → find other incidents with the same infrastructure/capability; associate first, then grade)
- Do not use: a single IOC query (go to [[re-ti]]); a malicious-behavior decision (go to [[re-behavior]])
- Do not use: a judicial evidence chain (the criminal standard is higher than intelligence attribution; this skill's conclusion cannot be used directly as judicial evidence; see [[gotchas]])
- Do not use: organization-level attribution when there is only one corner of evidence (a sample alone, or a domain alone, does not support an attribution statement; branch judgment is in [[decision-tree]])

## Tool preparation

### Association-query tools (Passive DNS / certificate transparency / Whois)

- whois CLI (registration information / ASN ownership): Linux `apt install whois` / `dnf install whois`; macOS `brew install whois`; Windows uses the WSL branch (see [[re-analyze/platform-tips]])
- python-whois (Python module): multi-platform `pip install python-whois`; verify: `python3 -c "import whois"`
- dnsx (DNS enumeration): the official channel is a Go binary — GitHub `projectdiscovery/dnsx` releases, or `go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest`; verify `dnsx -version` (the PyPI package of the same name is unrelated to the official tool; do not mix them)
- Certificate transparency logs: crt.sh web query (a public service; search by domain / certificate fingerprint)
- ASN ownership query: `whois -h whois.cymru.com <IP>` returns the AS number and ownership (the Team Cymru public interface)

### MISP (intelligence association and sharing)

- Docker deployment (the official install script/image; `apt install misp` does not exist in distro sources) or a light alternative (a local CSV/graph file)
- Verify: logging into the MISP UI can create/search events (a light alternative self-checks with a data-import script)

### Graph analysis (infrastructure relationships)

- Multi-platform: `pip install networkx` (python graph analysis); verify: `python3 -c "import networkx"`

## Procedure

Run in order; redact everything (red line: do not point at a concrete organization/victim identity; use only codenames and abstract descriptions).

1. **Place it on the diamond model**:
   - Four corners: victim (already known) / infrastructure (C2 domain/IP/certificate) / capability (tool/sample/exploit) / adversary (to be inferred)
   - Activity line: model an incident as a tuple (time, adversary, capability, infrastructure, victim); link several incidents into an activity line by shared elements
   - Metadata elements: time window, victim domain, industry attribute — used for clustering and the timeline (not evidence on their own)
   - Four-corner information-table fields: for each corner, list (known items / unknown items / source / query time); an unknown item is an attribution gap
   - Output: a table of what is known at the four corners + the missing corner (the attribution target)
   - Rule: reasoning can start only with more than two corners; one corner (a sample only) does not support an attribution statement (the criterion is in [[decision-tree]])
   - One-corner output form: when there is only 1 corner, deliver "intelligence lead" level (an IOC inventory + a feature description), mark "did not enter attribution", and do not write an organization name

2. **Infrastructure graph**:
   ```sh
   # domain/IP/certificate association clustering (an example flow; tools can be swapped)
   # 1) collect C2 domains/IPs → whois registration information (registrant/email/NS/ASN)
   # 2) certificate transparency logs (crt.sh) look up a shared certificate → associate other domains
   # 3) dnsx actively enumerates associated subdomains/NS records (a passive DNS interface shows resolution history)
   # 4) networkx graph clustering: merge nodes that share a registrant/certificate/NS/ASN
   ```
   - Order clustering features by how well they discriminate: a unique registrant email/certificate > a shared NS/ASN > the same hosting provider
   - Passive DNS points to watch: the domain's first resolution time, the history of resolved IP-range switches, historical NS changes (features of the registrant's operating habits)
   - IP-range features: the purpose/registration time of other domains in the range (same-class activity clustering is a weak lead and must rule out bulk registration by a hosting provider)
   - Whois privacy: registration information may be anonymized (common after GDPR) — when the registrant field is unusable, fall back to a cross-check of certificate/NS/behavior features and mark the registration-information blind spot
   - Domain similarity (the same suffix / typosquat) is only a weak lead: both the registrar and the registration time can be forged
   - Coexistence of a jump host / hosting provider cannot be ownership evidence (see pitfall 1 and [[gotchas]])

3. **Capability and sample attribution**:
   - Code reuse: similarity of strings/functions/resources/import tables between samples (unique strings first)
   - TTP comparison: align behavior patterns with known activity (alignment follows [[re-behavior]] and the ATT&CK mapping) — coarse alignment first (technique class), then fine alignment (port/parameters/crypto details)
   - Timeline: align activity windows (normalize to UTC first and check timezone and time source; see pitfall 6)
   - Unique features first: a distinctive string / compile feature / language habit (more discriminating than a generic TTP)
   - A sample family name was named by an analyst and is not attribution evidence (the name is decided by analysis habit; see [[gotchas]])
   - Output: a capability-evidence table (each piece of evidence → supports/opposes a hypothesis, with a traceable source)

4. **Confidence grading**:
   - Low: one class of weak evidence (a generalized feature, such as only a shared hosting provider)
   - Medium: two classes of independent evidence cross-checked, or one class of strong evidence (several uniqueness features)
   - High: three or more classes + a consistent timeline + no contradictory evidence
   - Decision: score by evidence type × strength; rules and counterexamples are in the [[decision-tree]] evidence grading table
   - Wording rules: low → "associated activity"; medium → "suspected same activity"; high → "highly suspected attribution"; do not write an absolute assertion (see the statement boundary in [[gotchas]])
   - Rule: without high-confidence evidence, state "associated activity" rather than "attributed organization"; explicitly list unresolved counter-evidence
   - There is no "confirmed" grade: intelligence attribution has no 100% assertion, and even the highest grade keeps its assumptions (for example "assuming this infrastructure was not hijacked")

5. **Report**:
   - Structure: conclusion (a graded statement) → evidence chain (evidence at each corner + source) → confidence basis → counter-evidence and unresolved items → method boundary (what cannot be decided)
   - Template (redacted):
     ```
     # Attribution report (internal)
     - Conclusion: <grade> — the same activity party as the <codename> activity (confidence: medium)
     - Evidence chain: 1) unique registrant email (whois, query time) 2) shared certificate (crt.sh) 3) unique code string (sample comparison)
     - Counter-evidence / unresolved: a timeline gap; anonymized registration information (GDPR)
     - Method boundary: C2 behavior was not verified; a list of items that cannot be decided
     ```
   - Cross-check the conclusion and the evidence against the [[re-analyze/analysis-contract]] review format and archive them (conclusion / evidence / confidence)
   - Redaction: do not publish a victim identity / a real organization name (use a codename), and do not publish an over-attribution statement; separate the external wording from the internal conclusion (layered output)
   - Redaction checklist: replace victim identity / organization name / domain / IP entirely with codenames; mask host names / user names in screenshots; re-check once before citing raw intelligence

## Cross-domain joins

- [[re-ti]]: intelligence input (IOC query and background)
- [[re-ioc]]: indicator extraction (domain/IP/hash)
- [[re-behavior]]: behavior evidence (TTP alignment)
- [[re-protocol]]: C2 protocol analysis (infrastructure features)
- [[re-hunting]]: an attribution hypothesis can become a hunting hypothesis ("if the same activity party entered the environment, what would appear in telemetry")
- [[re-feedback]]: attribution-case lessons (after redaction)
- [[re-analyze/analysis-contract]]: the conclusion delivery format

## Common pitfalls

- **Overlapping infrastructure causes mis-attribution**: symptom — two activities that share C2 infrastructure are merged into one group; cause — shared hosting / hijacked infrastructure; fix — distinguish "shared" evidence from "control" evidence (registration information vs hosting only), and downgrade shared-class evidence to weak evidence
- **A jump host ≠ ownership**: symptom — activity through a third-party jump host is attributed to the jump-host owner; cause — a confused path; fix — count only "control-plane evidence" (registration / configuration / unique features) toward ownership
- **Inflated confidence**: symptom — a single unique trait (a rare string) is treated as high confidence; cause — one piece of evidence is strong but there is no cross-check; fix — grade per step 4; one class of weak evidence is at most "low", and one class of strong evidence is at most "medium"
- **Shared capability is misread**: symptom — two activities that share a tool (a public tool / a rental platform) are attributed as one; cause — capability is a commoditized resource and is not unique; fix — tool-class evidence can only be weak evidence and must be stacked with infrastructure/timeline evidence
- **No evidence ≠ ruled out**: symptom — a timeline that does not line up / a record that cannot be found is judged "unrelated"; cause — missing passive data, or evidence that was not published; fix — mark "not found" rather than "does not exist", and list a timeline gap as counter-evidence
- **Timestamp / log anti-forensics**: symptom — the attacker forged timestamps / deleted logs and shifted the timeline; cause — active confusion; fix — cross-check several time sources (file time / logs / traffic time) and mark trustworthiness
- **Redaction red line**: symptom — a real victim / organization identity appears in the report; cause — raw intelligence was copied without processing; fix — check item by item before the report (the red line is mandatory)
- **Report wording leaks**: symptom — an internal conclusion is cited as an external statement; cause — wording was not layered; fix — keep separate versions of the internal report and the external summary; the external summary keeps only the grade and an evidence overview
- **The reasoning chain cannot be reviewed**: symptom — the conclusion cannot be traced back to evidence; cause — hypotheses and intermediate judgments were not recorded; fix — archive hypotheses / evidence / grades for the whole flow (path + time), and attach an evidence index to the report
- Scenario branches, the evidence grading table, and more counterexamples: [[decision-tree]] / [[gotchas]]

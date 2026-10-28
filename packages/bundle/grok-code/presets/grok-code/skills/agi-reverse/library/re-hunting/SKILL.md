---
name: re-hunting
type: atomic
description: >
  Threat-hunting methodology: hypothesis-driven, telemetry-source selection, baseline comparison, and a verification loop.
  Triggers: `威胁狩猎`, `狩猎`, hunting, `假设驱动`, `遥测分析`, `异常检测`.
capabilities: [threat-intel]
---

# Threat hunting

## When to use / when not to use

- Use: an active hunting request ("is there X activity in the environment"), hypothesis-driven environment checks, landing threat intel (turn an intel lead into an in-environment search)
- Use: baseline-driven anomaly discovery (with no specific intel, build a baseline first, then look for deviations)
- Use: widening the search after an incident (one confirmed hit → search the same TTP / same infrastructure again, looking for what was missed)
- Use: alert-driven traceback (one alert → hunt backward for the same class of unalerted behavior, looking for what was missed)
- Do not use: pure compliance sweeps (a periodic report with no hypothesis is operations, not hunting; the flows differ)
- Do not use: known-sample analysis ([[re-behavior]]); IOC lookup ([[re-ti]]); deep-dive of a single piece of evidence (per-domain skills)
- Do not use: single-point incident-response handling (hunting is the active surface, IR is a passive trigger; conclusions can feed each other but the flows differ)
- Do not use: when there is no telemetry source (missing data sources cannot support hypothesis verification; fill in collection first, then hunt — see [[gotchas]])
- Do not use: device- or host-level single-point checks (that belongs to the per-domain skills; hunting faces the environment as a whole)

## Tool setup

### Log-analysis tools (general)

- Multi-platform: jq / grep / awk (bundled with distros, or `apt install jq` / `brew install jq`)
- Verify: `jq --version`
- python3 (baseline stats / clustering scripts): install via the tool setup in [[re-python]]
- Quick frequency counts: `grep -E` + `sort | uniq -c` (usable for a first baseline)

### Telemetry queries (by environment)

- SIEM/EDR query interfaces (give query guidance for the deployed environment; do not bind a tool)
- Local logs: `journalctl` (Linux, structured filter: `journalctl -o json --since "24 hours ago" | jq ...`); PowerShell `Get-WinEvent` (Windows, for example `Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4624} -MaxEvents 100`)
- Network telemetry: traffic / firewall logs (deep dive in [[re-netcap]])
- Common Windows event IDs (check what is actually enabled in the environment): 4624/4625 logon success/failure, 4688 process creation, Sysmon 1 process creation, Sysmon 11 file creation

### ATT&CK navigation (hypothesis-alignment reference)

- Web tool (public access); Navigator layer files can be downloaded locally; for a rule-match format, Sigma is a reference (public rule format, adapted to the environment)
- Coverage check: at the end, mark covered techniques on a Navigator layer and produce a coverage statement (paired with blind spots)

## Procedure

Run in order. Do not start until the hypothesis is explicit (pitfall 5). Archive each step's products (path + sha256, see [[re-triage]]).

1. **Generate hunting hypotheses**:
   - Inputs: threat intel ([[re-ti]]), known attack patterns (experience from [[re-behavior]]), environment traits (exposure / business / past incidents), red-team / exercise reports (known successful paths are searched first)
   - Hypothesis sentence: "the attacker may have done Y in the environment via technique X" — X aligns to an ATT&CK technique, Y is an observable telemetry trace
   - Falsifiability check: for each hypothesis, write "what you should see if it is false" (the counterevidence form). If you cannot write it, do not investigate
   - Intel detectability mapping: every IOC/TTP in the intel must answer "which telemetry trace does this correspond to in the environment"; ones that do not map become blind-spot hypotheses
   - Priority: impact × likelihood × detectability (if all three are low, it is not worth investigating)
   - Hypothesis count: 3-5 high-priority hypotheses per round (more than that cannot be verified in depth)
   - Hypothesis card: id / sentence / source intel / telemetry trace / counterevidence form / priority
   - Output: a hypothesis list (each hypothesis = a falsifiable search target; cover multiple hypotheses by technique family, avoid a single point)

2. **Select telemetry sources**:
   - Pick data sources by hypothesis: process behavior → EDR / process logs (Windows 4688 / Sysmon 1); network → traffic / firewall logs; logon → auth logs (4624/4625); files → filesystem monitoring (Sysmon 11)
   - A missing data source → mark a blind spot (the validity boundary of the conclusion; see the blind-spot pitfall in [[gotchas]])
   - When one hypothesis has several data sources, query the best-covered one first, then cross-check
   - Verify the telemetry pipeline is healthy first (ingest one known test event) before trusting "no alerts"
   - Time normalization: unify timestamps across data sources to UTC and one format (ISO8601) before cross-source comparison
   - Data-source mapping example (check actual event IDs in the environment):

     | Hypothesis focus | Data source | Event / log | If missing |
     |---|---|---|---|
     | Process / execution | EDR, process logs | 4688, Sysmon 1 | Cannot verify the execution chain |
     | Network egress | Traffic / firewall / proxy | connection logs / NetFlow | Cannot verify egress behavior |
     | Logon / credentials | Auth logs | 4624/4625 | Cannot verify stuffing / lateral movement |
     | File drop | Filesystem audit | Sysmon 11 | Cannot verify delivery |

3. **Baseline vs anomaly**:
   - Baseline: the statistical distribution of a normal window (frequency / source / target features) — pick a known-clean period that covers the business cycle (see pitfall 1)
   - Statistics: frequency distribution / percentile baseline / period-over-period jumps (compare with the previous window); use a python3 script for the distribution
   - Anomaly detection: behavior that departs from the baseline (new process chains, unusual hours, unusual targets), rule matches (known patterns)
   - Heuristic anomaly examples: a process/domain seen for the first time, logon outside working hours, egress on a rare port
   - Clustering: cluster anomalous entries by feature (process name / path / target domain / time window) to cut one-by-one manual review
   - Clustering output: an anomaly-group list (each group: features / count / time range / linked hypothesis id)
   - Baseline products: per-entity frequency tables (top N processes / domains / logon sources) + threshold suggestions

4. **Verification loop**:
   - Confirm hits: anomaly → deep dive ([[re-behavior]] behavior analysis, [[re-variant]] sample correlation, [[re-netcap]] network-side check)
   - Drop false positives: whitelist check, environment explanation (legitimate change / maintenance window), confirm with the business owner
   - Keep a record after exclusion: why it was excluded, so a re-check does not re-analyze it
   - The whitelist is a living asset: once confirmed legitimate, add it (with a reason) and re-check it when the environment changes
   - Archive evidence: review format from [[re-analyze/analysis-contract]] (conclusion / evidence / confidence)
   - Loop output: confirmed hit → incident report (including IOC deposit, which can go to [[re-ioc]]); miss → archive the hypothesis (rerunnable, blind spots marked)
   - After a hit, widen the re-check: scan the same TTP / same origin again (hunting is iterative, not one-shot)
   - Review product: hypothesis hit-rate stats (priority input for the next round)
   - Delivery structure: hypothesis list (including blind spots) → hit list (graded) → evidence-pack path → recommendations (rules / collection hardening)
   - Verdict grades and stop conditions are in [[decision-tree]] (four levels: confirmed / suspicious / unconfirmed / miss)

## Cross-domain

- [[re-forensics]] gateway: this skill belongs there
- [[re-ti]]: intel input (hypothesis source)
- [[re-behavior]]: deep-dive a hit (behavior evidence)
- [[re-variant]]: sample correlation
- [[re-netcap]]: network-telemetry deep dive
- [[re-ioc]]: deposit hit indicators (YARA / rules)
- [[re-triage]]: product-archive rules (path + sha256)
- [[re-analyze/analysis-contract]]: deliver conclusions in the review format

## Common pitfalls

- **Baseline contamination**: symptom — anomalies are treated as normal; cause — the environment itself was already compromised (the baseline contains malicious activity); fix — pick the baseline window from a known-clean period and state the baseline assumption
- **Telemetry-gap blind spots**: symptom — a "no anomaly" conclusion while the environment has activity; cause — a key data source was never collected; fix — mark blind spots explicitly in step 2, and limit the conclusion to "within collected telemetry"
- **False-positive fatigue**: symptom — a mass of hits that nobody deep-dives; cause — rules too wide / threshold too low; fix — cluster first, then review; calibrate the threshold from the baseline
- **Hypothesis too narrow**: symptom — only one technique was checked; cause — a single hypothesis; fix — generate multiple hypotheses by ATT&CK technique family (coverage statement)
- **Conclusion too strong**: symptom — a claim that "the environment is clean"; cause — blind spots and hypothesis boundaries were not marked; fix — qualify the conclusion (see pitfall 2)
- **Confirmation bias**: symptom — only evidence that supports the hypothesis is collected, counterevidence is ignored; cause — the conclusion came before the evidence; fix — for each hypothesis list "what you should see if it is false", and record counterevidence the same way
- **Clock skew / timezone**: symptom — the event sequence does not line up; cause — the endpoint clock was not calibrated; fix — normalize to UTC first and mark the time source
- **No alert ≠ no activity**: symptom — an empty rule match is declared "safe"; cause — monitoring blind spots / rule evasion / degraded alerting; fix — state "collected + covered techniques" separately from "not covered"
- **Checked once and never again**: symptom — after handling a hit, the scope is not widened; cause — treating the hunt as a one-shot task; fix — after a hit, search again by the same TTP / same infrastructure, two iterative rounds
- **Insufficient query permission**: symptom — the conclusion has blind spots that were not marked; cause — only some data-source permissions were granted; fix — list unauthorized data sources and limit the conclusion to the authorized scope
- **Baseline window includes a maintenance period**: symptom — a legitimate large action in a maintenance window is treated as an anomaly / contaminates the baseline; cause — a coarse window choice; fix — exclude maintenance periods from the baseline window and mark that
- **A hit is treated as a verdict**: symptom — a single log hit is reported as an incident; cause — no environment explanation was done; fix — pass the "environment explanation" gate before labeling (decision-tree grading table)
- Task-type selection, hit grading, and archive rules: [[decision-tree]] / [[gotchas]]

# Hunting decision tree and evidence grading

Hunting is a closed loop of "hypothesis → verify → archive", not a log trawl. Use this document with steps 1-4 of SKILL.md.

## Task-type decision tree

```
Hunting request
├─ Concrete intel lead (new threat / new technique) → hypothesis-driven (intel → technique → telemetry → verify)
├─ No lead, looking for the unknown → baseline-driven (build a baseline → find deviations → explain deviations)
└─ Known environment + known technique list → model-assisted (rule match / ATT&CK coverage review)
```

## Hypothesis-generation branches

```
Hypothesis input sources
├─ External intel ([[re-ti]]) → extract technique X → map to in-environment telemetry trace Y
├─ Internal incident review → look for the same class not yet found (hypothesis "there are more")
└─ Environment traits (exposure / new tech going live) → generate against the new attack surface

The hypothesis sentence must be falsifiable: technique X → trace Y → verification method → form of the counterevidence
(A hypothesis with no counterevidence form is not investigated; see the cognitive-bias pitfall in [[gotchas]])
```

## Telemetry-availability branches

```
Telemetry inventory
├─ EDR / process logs → process-chain / command-line hypotheses (4688, Sysmon 1)
├─ Auth logs → login hypotheses (4624/4625, domain auth)
├─ Network traffic → egress / protocol hypotheses (deep dive in [[re-netcap]])
├─ Filesystem monitoring → file-drop hypotheses (Sysmon 11)
└─ All missing → do not enter hunting; output a "collection gap" list (see the blind-spot pitfall in [[gotchas]])
```

## Hit-verdict grading table

| Level | Criterion | Disposition |
|---|---|---|
| Confirmed hit | Multi-source evidence agrees + malicious features are clear (behavior chain is complete) | Incident report + IOC deposit ([[re-ioc]]) |
| Suspicious | Single-source anomaly + cannot be explained by the environment | Deep-dive ([[re-behavior]]) then re-grade; record but do not conclude |
| Unconfirmed | Anomalous but explainable by a legitimate scenario | Whitelist annotation; keep the record (an environment change may later make it suspicious) |
| Miss | No deviation, or every deviation is explained | Archive the hypothesis (rerunnable); mark blind spots |

## Verification closed loop (combined playbook)

1. Hit → pull raw evidence (context ±24h around the time window)
2. Environment explanation: ask the business owner / check change records / compare maintenance windows
3. Check malicious features (behavior chain, TTP alignment)
4. Grade (table above) → disposition
5. Archive: evidence path + conclusion + confidence ([[re-analyze/analysis-contract]] format)
6. Review: is the hypothesis reusable (turn into a rule / deposit via [[re-ioc]])

## Lessons internalized

- Falsifiability is the first quality metric of a hypothesis: do not investigate a hypothesis that cannot state "what you should see if it is false"
- Bind blind spots to the conclusion: delivery always carries the qualifier "within collected telemetry"
- Explain an anomaly before labeling it: most anomalies are environment noise. A confirmed hit must pass the "environment explanation" gate
- Archived hypotheses are assets: keep a miss plus its query so it can be rerun, and reuse it on the next hunt

## Usage notes

- Execute entirely inside the authorized scope (confirm environment / data sources / scope first)
- Deliver conclusions per [[re-analyze/analysis-contract]]; conclusions carry confidence and blind spots
- Sample handling goes to the [[re-behavior]] / [[re-malware]] flow. This skill does not expand into sample analysis

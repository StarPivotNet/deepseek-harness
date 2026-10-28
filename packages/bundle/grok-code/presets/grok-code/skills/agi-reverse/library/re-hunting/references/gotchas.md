# Hunting-methodology pitfalls and boundaries

## Hypothesis and cognitive-bias pitfalls

- **Confirmation bias**: the conclusion "some activity exists" comes first, and the search only collects supporting evidence — force every hypothesis to list "what you should see if it is false", and record counterevidence on equal footing with supporting evidence
- **Hypothesis too narrow or too wide**: checking one technique misses the family; or the hypothesis is too vague ("the attacker may have done something bad") to search — expand by ATT&CK technique family, and limit each hypothesis to an observable trace
- **Hunt before hypothesizing**: with no hypothesis, paging logs for "something weird" drowns in noise and cannot be judged — hunting is verification, not sightseeing. Hypothesis first
- **Over-generalized conclusion**: saying "X was not found" means "the environment is safe" — not found ≠ not present (telemetry blind spots, rule evasion, samples that never land on disk)

## Baseline-construction pitfalls

- **Baseline contamination**: the environment was already compromised, so malicious activity is mixed into the "normal" distribution — pick a baseline window from a known-clean period; state the baseline assumption; on a new environment, declare "no baseline" first
- **Window representativeness**: only weekdays or only daytime, so holiday/night behavior looks anomalous — the baseline should cover the business cycle (week / month / season). Mark the sampling window
- **Noise and thresholds**: threshold too low → false-positive fatigue; too high → misses — calibrate from the baseline distribution (percentiles), wide first and strict on the second pass

## Telemetry and data pitfalls

- **Silent blind spots**: a data source that was never collected will not report an anomaly — at delivery, explicitly list "collected" and "not collected", and limit the conclusion to the collected scope
- **Clock skew / timezone**: an uncalibrated endpoint clock misorders the event sequence (normalize to UTC first); especially common on isolated segments where NTP is unreachable
- **Log truncation / rotation**: a short retention window limits how far back you can look — mark the searchable window; for a long hunt, recommend collection retention
- **Rule evasion ≠ clean**: attackers vary behavior to slip past monitoring rules — when rule hit rate is low, add baseline anomaly detection. Do not trust rules alone
- **Alerting was turned off or degraded**: verify the telemetry pipeline itself is healthy (ingest one known test event) before trusting "no alerts"

## Conclusion-wording boundaries

- Probabilistic wording: confirmed / suspicious / unconfirmed / miss. Ban assertions such as "certain" or "absolutely clean" (wording rules are the grading table in [[decision-tree]])
- Required qualifiers: "within collected telemetry", "as of query time", "against the current baseline"
- Archive counterevidence too: supporting evidence and counterevidence both go into the report. List why open items are unresolved

## Usage notes

- Confirm authorization and scope first (environment, data sources, time window)
- Archive products (queries, evidence, conclusions; path + time + sha256, see [[re-triage]]); deliver conclusions per [[re-analyze/analysis-contract]]
- Deep-dive a hit sample via [[re-behavior]]; deposit indicators via [[re-ioc]]

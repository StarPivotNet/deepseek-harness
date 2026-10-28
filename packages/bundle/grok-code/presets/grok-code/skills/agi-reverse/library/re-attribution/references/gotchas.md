# Attribution methodology pitfalls and boundaries

## Infrastructure mis-attribution

- **Shared ≠ controlled**: a C2 domain/server is often sold, rented, or reused — "the same C2 domain" only means the same resource was used, not the same organization; the criterion is registration information / control-plane traces (whois email, certificate private key, admin-panel features), not the IP or the domain itself
- **Hijacked infrastructure**: a retired or compromised server may be reused by several activity parties; if you cannot prove the control time window, the evidence can only count as weak
- **Hosting-provider clustering**: a large amount of malicious activity clustering at the same datacenter/hosting provider is normal and cannot be association evidence (the same NS/ASN can be weak evidence, and it must be stacked with other corners)
- **Passive DNS data freshness**: resolution history may be cached/poisoned, and different query times give different results; a forensic conclusion must mark the query time and the data source

## Capability / sample evidence pitfalls

- **A tool is a commoditized resource**: anyone can obtain a public tool, framework, or rented service — "used some framework / public tool" cannot attribute; only an in-house/custom feature (a unique string, a private-protocol implementation detail) discriminates
- **Similar code ≠ same origin**: copying code, borrowing an open-source project, and a code generator all produce similarity; calibrate the similarity threshold by "the share of unique content", not overall similarity
- **Language / disguise misleads**: an attacker will deliberately use strings and habits from another language/region to fake attribution (a false flag) — a single language feature can only be weak evidence
- **Compile features change**: the same team's build chain changes (compiler / packaging upgrade), and a missing feature does not mean a different origin; conversely, matching features may only be "the same build tool" rather than "the same team"

## Timeline and anti-forensics

- **Forged timestamps**: file time / log time can be rewritten; cross-check several time sources (files, logs, traffic, third-party passive data)
- **Timezone and clock skew**: times produced by devices across timezones / with uncalibrated clocks must be normalized first (unify on UTC) and then aligned; otherwise "overlapping activity windows" is an illusion
- **An activity gap ≠ the activity ended**: switching infrastructure / a hiding period is normal for an attacker; mark a timeline gap as "not observed" rather than "does not exist"

## Attribution-statement boundaries and counterexamples

- **Intelligence attribution ≠ judicial attribution**: an intelligence conclusion (probabilistic, graded) does not meet the criminal-evidence standard (beyond a reasonable doubt, chain of custody) — this skill's output is an intelligence judgment, and a handoff to a judicial setting must state the limit
- **"Cannot attribute" is a legitimate conclusion**: when evidence is insufficient, output "associated activity" plus an evidence inventory; that is more professional than forcing an attribution; state "cannot decide" and give the reason (a missing corner / counter-evidence / a data blind spot)
- **Organization names themselves mislead**: a public label (a codename given by the media) may be unrelated to the real attribution; the report uses a checkable description (timeline + TTP + infrastructure features) and depends little on labels
- **Counterexamples**: attributing only from "the same domain suffix" (a domain suffix can be registered); attributing only from "the same sample family name" (a family name was given by an analyst and is not attribution evidence)

## Usage notes

- The authorization and redaction red line runs through the whole flow: do not name a real organization/victim; case descriptions use codenames
- Archive each step's artifacts (whois/certificate/graph output, path + query time + sha256; see [[re-triage]])
- Deliver conclusions per [[re-analyze/analysis-contract]]; separate the external wording from the internal conclusion
- Evidence freshness: whois/certificate data expires; the report marks "as of the query time"

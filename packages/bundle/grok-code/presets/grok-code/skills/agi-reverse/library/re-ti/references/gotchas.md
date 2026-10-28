# Threat-intelligence lookup pitfalls and boundaries

## Data quality: no result ≠ clean

- **Private / not-yet-ingested samples are routinely missing**: VT only has a public corpus — detection count 0 or not found is only "no record seen", with the query time noted. Conclude from behavior evidence ([[re-behavior]] / [[re-mem-forensics]])
- **hash false positives**: a single vendor signature is coarse, and aggregate stats are not weighted — a "malicious" call requires multi-vendor agreement + family tags + behavior evidence. An old-hash hit on a renamed/concatenated sample needs a content check (recompute sha256 and compare)
- **Sandbox-report false negatives**: an anti-sandbox sample sleeps or takes the benign branch in a public sandbox — a report of "no malicious behavior" does not mean the real environment has no behavior. Cross-check with dynamic analysis in a real environment

## Privacy and data publication

- **Upload means public**: the free channels of VT/Any.run/hybrid-analysis publish reports by default — confirm ownership and data policy before uploading an internal/customer sample (VT enterprise private API, redact then upload, or choose a private-analysis option)
- **A lookup is also data exposure**: API lookup behavior is tied to the key — assess the exposure surface before batch-querying internal infrastructure
- If unsure, ask the owner first. Do not upload by default (sensitive-data handling principle in [[re-analyze/platform-tips]])

## API quota and rate limits

- **VT free key**: daily quota and per-minute limit; returns 403 (invalid/quota) and 429 (rate limit) — sleep inside the script loop (for example 15 seconds), aggregate with /search to send fewer requests, and have jq take only the needed fields
- **hybrid-analysis**: a restricted key can search but cannot submit/download. The `/search/hash` response body includes the current limit (Api-Limits header) — if over the limit, wait for reset
- **MISP**: quota depends on the instance config (no universal rate limit), but a large result set (no limit) will stall the instance — query with `limit` + `page`

## API version and endpoint drift

- **VT v2 → v3**: v2 `/vtapi/v2/*` and `/graph` are retired. v3 is uniformly `/api/v3/`, auth header `x-apikey` — a 404 from an old script means check whether the endpoint was moved to v3 (for example graphs, plural)
- **MISP response-shape version differences**: restSearch responses evolved from `{"response": [...]}` (old versions have `.response[0].Event` as a direct object; newer versions wrap an array) — jq uses `.response[]?.Event` for a compatible expand. Follow what the instance actually returns
- **hybrid-analysis**: `POST /search/hash` is marked deprecated (replaced by `GET /search/hash`); `/report/summary` is deprecated (use `/report/<id>/summary`); `/report/{id}/dropped-files` is replaced by `-v2` — write scripts against the current v2.x docs
- **Any.run**: API endpoints and auth follow the official docs (any.run/api-documentation). Capabilities differ by plan — check before scripting

## Correlation false-positive boundary

- **graph / related samples are heuristic**: the same C2 / same signature / same mutex hit does not mean the same family — grade link strength in the report (strong = several attributes agree, weak = a single-attribute coincidence)
- **Family names are not consistent**: vendors name the same family differently — use the name that several vendors agree on, and state the basis in the report
- **Time drift**: historical detections / resolution records change over time (taken down / renamed) — record the query time with the conclusion, and pull again on recheck

## Notes

- Query evidence chain: file value + source + query timestamp one by one ([[re-triage]] practice)
- External intelligence corroborates; it is not the conclusion. The final determination follows local static/dynamic evidence ([[re-analyze/analysis-contract]])

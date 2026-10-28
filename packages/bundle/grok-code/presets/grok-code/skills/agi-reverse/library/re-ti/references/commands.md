# Threat-intelligence API endpoint cheat sheet and operation sequences

Source split: VirusTotal (primary detection/correlation source), hybrid-analysis (sandbox-report API), MISP (in-organization matching), Any.run (web report library; API follows the official docs). Every endpoint's final authority is the official docs (VT: docs.virustotal.com; MISP: the instance's own /events/restSearch behavior; HA: hybrid-analysis.com/docs/api/v2).

## Endpoint cheat sheet

### VirusTotal API v3 (auth header `x-apikey`)

| Use | Endpoint |
|---|---|
| General search (hash/domain/IP/URL) | `GET https://www.virustotal.com/api/v3/search?query=<value>` |
| File detection object | `GET https://www.virustotal.com/api/v3/files/<sha256>` |
| Domain object | `GET https://www.virustotal.com/api/v3/domains/<domain>` |
| IP object | `GET https://www.virustotal.com/api/v3/ip_addresses/<ip>` |
| Relation graph (family/infrastructure) | `GET https://www.virustotal.com/api/v3/files/<sha256>/graphs` (plural graphs; v2 /graph is retired) |
| File related objects | `GET https://www.virustotal.com/api/v3/files/<sha256>/related` |
| File behavior summary | `GET https://www.virustotal.com/api/v3/files/<sha256>/behaviour_summary` |

Shared request template (every GET):

```sh
curl -s --request GET --url "<endpoint>" -H "x-apikey: $VT_API_KEY" | jq '.data.attributes | {last_analysis_stats, names, tags, popular_threat_category}'
```

### hybrid-analysis API v2 (auth header `api-key`, base `https://hybrid-analysis.com/api/v2`)

| Use | Endpoint |
|---|---|
| Report by hash | `GET /search/hash?hash=<md5|sha1|sha256>` (returns `{sha256s, reports[]}`; reports include verdict) |
| Overview | `GET /overview/<sha256>` |
| Report summary | `GET /report/<id>/summary` |
| Submit a file | `POST /submit/file` (multipart; needs a default-or-higher key) |

```sh
curl -s -H "api-key: $HA_API_KEY" "https://hybrid-analysis.com/api/v2/search/hash?hash=<sha256>" | jq '{sha256s, verdicts: [.reports[].verdict]}'
```

### MISP (auth header `Authorization: <API_KEY>`)

| Use | Endpoint |
|---|---|
| Search events by attribute value | `POST /events/restSearch` (body: `{"returnFormat":"json","value":"<value>"}`) |
| Search attributes by attribute value | `POST /attributes/restSearch` (same shape) |
| Filter by tag | add `"tags": ["tag1", "!tag2"]` to the body (`!` excludes) |
| Limit count | add `"limit": 20, "page": 1` to the body |

```sh
curl -s --request POST "https://<misp>/events/restSearch" \
  -H "Authorization: <MISP_API_KEY>" -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  --data-binary '{"returnFormat":"json","value":"<sha256>"}' \
  | jq '.response[]?.Event | {info, date, orgc}'
```

### Common jq extracts

```sh
# Detection stats (malicious count and vendor counts)
jq '.data.attributes.last_analysis_stats | {malicious, suspicious, undetected}'
# First/last seen time and submission names
jq '.data.attributes | {first_submission_date, last_submission_date, names: .names[0:3]}'
# graph node-type distribution (relation source)
jq '.data[].type' | sort | uniq -c | sort -rn
```

## Common operation sequences

### 1. Sample hash background lookup (required first step)

```
Recompute sha256 locally (check it against the intelligence value) → VT /search?query=<sha256> → detection count + tags + family
→ no result → search again with hybrid-analysis /search/hash and the Any.run web UI → still none → mark "no record seen" + query time
```

### 2. Domain/IP infrastructure correlation

```
VT /domains/<domain> for resolution records and historical detections → /ip_addresses/<ip> for hosting relations
→ related samples on the VT hash page (same C2 / same signature) → reverse-lookup related domains/samples from the domain → results go into the [[re-ioc]] infrastructure graph
```

### 3. Family attribution (qualify only when several sources agree)

```
VT tags + popular_threat_category + graph relations → compare with the hybrid-analysis verdict
→ multi-vendor agreement + behavior evidence ([[re-behavior]]) → family conclusion; a single vendor's name is only a reference
```

### 4. MISP internal match (organization history)

```
POST /events/restSearch value=<hash|domain|IP> → on a hit, take event ID/date/orgc
→ cite the event id as internal evidence; a miss does not block the external-intelligence conclusion
```

## Lessons (internalized)

- Verify the query value locally first: recompute sha256, then look it up, so a wrong hash does not waste time on an empty result
- Take every field in one request: extract several attributes with one jq pass. Do not request once per field (quota)
- Sleep inside a batch-query loop (for example 15 seconds) and record each query timestamp — the evidence chain requires "what was found at what time"
- Conclude only when web and API agree: the API response shape and the web display fields differ. Sensitive conclusions are checked on both sides

## Notes

- Confirm the data-publication policy before upload/lookup (ask ownership first for a private sample; see [[gotchas]])
- Dynamic execution (sandbox submit) stays inside [[re-sandbox]] (top rule in [[re-analyze/platform-tips]])
- Intelligence into the report: IOC list + source (report id / event ID) + query time ([[re-ioc]] handoff)

---
name: re-ti
description: >
  Threat-intelligence lookup and correlation: VT/Any.run/hybrid-analysis, MISP.
  Triggers: `威胁情报`, VirusTotal, Any.run, `沙箱查询`, MISP, `样本关联`
capabilities: [threat-intel]
---

# Threat-intelligence lookup and correlation

## When to use / when not to use

- Use: you have a sample hash / domain / IP and need known malicious context ("what is this sample", "which family"); sandbox-report reading; family/actor correlation; MISP event correlation; intelligence into the report
- Use: after analysis, use intelligence to check the conclusion (leads from [[re-malware]] / [[re-forensics]] need external corroboration)
- Do not use: you only want to run behavior analysis — that is [[re-sandbox]] / [[re-behavior]]. A sandbox lookup is only one intelligence method
- Do not use: a fully offline environment with no network (only static local matching is possible). No VT result ≠ clean (see pitfall 1)

## Tool setup

This skill is lookup and reading. It does not run the sample. Dynamic execution of an upload to a sandbox must stay inside [[re-sandbox]] (default-sandbox top rule; see [[re-analyze/platform-tips]]).

### VirusTotal (primary lookup, web + API)

- Web: https://www.virustotal.com/ — look up hash/domain/IP, no install
- API key: generate at https://www.virustotal.com/gui/my-apikey; store in `VT_API_KEY` (`export VT_API_KEY=...`; Windows uses `setx`)
- Verify: `[ -n "$VT_API_KEY" ] && echo ok`; a request with the key returns JSON (401/403 means the key is invalid or the quota is exhausted)
- Privacy: confirm the data policy before looking up a private sample — VT is shared intelligence, and an upload is public to a third party. For an internal sample, ask ownership/permission first (see pitfall 2)

### curl — API requests

- Linux: `apt install curl` / `dnf install curl` / `pacman -S curl` (usually already present)
- macOS: built in
- Windows/WSL: Windows 10+ includes curl.exe; WSL uses the Linux package
- Verify: `curl --version`

### Any.run / hybrid-analysis (sandbox reports, web)

- Any.run: https://any.run/ — register to search/submit (interactive web sandbox, public report library)
- hybrid-analysis: https://www.hybrid-analysis.com/ — register to search/submit (free API quota)
- No install. Confirm the data-publication policy before uploading a sample

### MISP (optional, team-hosted intelligence store)

- Deploy (Linux): `docker run -d --name misp -p 8080:80 harvarditsecurity/misp` (community image; a production deploy follows the official docs)
- Verify: a browser can log in at https://localhost:8080 (default account admin@admin.test / admin)
- If there is no existing MISP instance, skip this part. It does not block the lookup

### jq (optional, parse API JSON)

- Linux: `apt install jq` / `dnf install jq` / `pacman -S jq`
- macOS: `brew install jq`
- Windows: `winget install jqlang.jq`
- Verify: `jq --version`

## Steps

Run in order. Run steps 1-3 for every lead (hash/domain/IP) and record the result and query time (evidence).

1. **Hash/domain/IP lookup (VT)**:
   ```sh
   curl -s --request GET \
     --url "https://www.virustotal.com/api/v3/search?query=<sha256_or_domain_or_ip>" \
     -H "x-apikey: $VT_API_KEY" | jq '.data[0].attributes | {last_analysis_stats, names, tags, popular_threat_category}'
   ```
   - The web UI works the same way: on the hash page read the detection count (`malicious` inside `last_analysis_stats`), vendor hits, tags, popular_threat_category
   - On the domain/IP page read resolution records, historical detections, and related samples. No detection is not an immediate "clean" verdict (see pitfall 1)
   - Privacy option: for a private object, use VT's private API (enterprise) or confirm the publication risk first (see pitfall 2)

2. **Sandbox report reading (Any.run / hybrid-analysis)**:
   - Lookup: search the same hash on Any.run/hybrid-analysis and find a public report. Submitting a new sample for execution must happen inside the [[re-sandbox]] isolated environment (network isolation INetSim/fake DNS; top rule in [[re-analyze/platform-tips]])
   - hybrid-analysis API (the key is generated on the API key page of the personal profile; request header `api-key`):
     ```sh
     curl -s -H "api-key: $HA_API_KEY" \
       "https://hybrid-analysis.com/api/v2/search/hash?hash=<sha256>" | jq '{sha256s, verdicts: [.reports[].verdict]}'
     ```
   - Any.run has an API (api.any.run; the key is generated in the profile). Endpoints and auth follow the official docs. Without a key, the web lookup still works
   - Read three blocks:
     - **Behavior**: process tree that started (injection/hollowing or not), persistence actions (Run key / scheduled task / service), file operations (what was written, what was deleted)
     - **Network**: callback domain/IP/port, DNS resolution, request URL (compare with the capture from [[re-behavior]])
     - **File operations**: dropped files and hashes (dropper on-disk products; they go into [[re-ioc]])
   - Record the report id and screenshot timestamp as evidence. Do not trust the report completely (see pitfall 3)

3. **Family/actor correlation (VT graph, tag)**:
   ```sh
   curl -s --request GET \
     --url "https://www.virustotal.com/api/v3/files/<sha256>/graphs" \
     -H "x-apikey: $VT_API_KEY" | jq '.data[].type' | sort -u
   ```
   - Endpoint note: the graph endpoint is `/graphs` (plural) — `/graph` is an API v2 path, and v3 returns 404
   - Relations on the VT hash page: other samples that hit the same C2 domain / same signature / same mutex, `popular_threat_category` (for example "trojan.agent"), and family tags
   - tags and graph place the sample in a family — when writing the report, mark the basis (which vendors assigned it, which attribute the link uses)
   - The family name follows multi-vendor agreement. A single vendor's name is only a reference

4. **MISP event correlation (if an instance exists)**:
   ```sh
   # Search event attributes (hash/domain/IP) — POST + JSON body
   curl -s --request POST "https://<misp>/events/restSearch" \
     -H "Authorization: <MISP_API_KEY>" \
     -H "Accept: application/json" \
     -H "Content-Type: application/json" \
     --data-binary '{"returnFormat":"json","value":"<sha256>"}' | jq '.response[]?.Event | {info, date, orgc}'
   ```
   - The body must be raw JSON (`--data-urlencode` URL-encodes it, and MISP will not parse `value`). Pass `value` as a string
   - The response looks like `{"response": [{"Event": {...}}]}` — jq expands it with `.response[]?.Event`. Response shape differs across MISP versions (see [[gotchas]])
   - A hit means the organization has already marked this sample/infrastructure — cite the event id as internal evidence
   - If there is no instance, skip. This step does not block the conclusion

5. **Intelligence into the report (handoff to [[re-ioc]])**:
   - Summary: one line per lead — type (hash/domain/IP), VT detection count, family/classification, related samples, source (report id / event ID), query time
   - Intelligence goes straight into the [[re-ioc]] report: IOC list (externally confirmed malicious indicators + confidence), the family-determination basis in the summary, and external-intelligence corroboration in the conclusion
   - A conclusion with no source is the same as not having looked it up (evidence-chain requirement; see pitfall 4)

## Related skills

- [[re-forensics]]: step 4 of this gateway workflow — this skill is the intelligence-correlation stage
- [[re-malware]]: use this skill before malicious-sample analysis step 6 to corroborate family/determination. Static intelligence on anti-sandbox samples depends on this skill especially
- [[re-behavior]]: the baseline for reading sandbox reports in step 2 comes from behavior-analysis products (process/network/file comparison)
- [[re-ioc]]: step 5 rolls intelligence into the IOC list and the report (handoff)
- [[re-sandbox]]: dynamic execution for this skill must stay inside it (default-sandbox top rule; see [[re-analyze/platform-tips]])
- Return to [[re-analyze]]: write the intelligence summary into the final report according to the RE_REPORT preference

## Pitfalls

- **No VT result on a private sample ≠ clean**: symptom — a hash has detection count 0 or returns "not found", and that is treated as harmless; cause — VT only has a public corpus, so private/unpublished samples are routinely missing (it may also be a new sample not yet ingested); fix — mark "no record seen" and note the query time. Conclude from actual behavior evidence in [[re-behavior]] / [[re-mem-forensics]]. Cross several channels (Any.run/hybrid-analysis/MISP) before a qualitative call
- **Uploading a private sample leaks intelligence**: symptom — an internal or customer sample is uploaded to VT/Any.run and becomes public, creating a confidentiality problem; cause — sandboxes and VT share data by default (public reports); fix — confirm the data policy before upload: use VT's private API (enterprise) or redact first (strip PII, then upload). On Any.run/hybrid-analysis choose private analysis if it exists. If unsure, ask the owner first
- **Do not fully trust a sandbox report (anti-sandbox sample)**: symptom — the sandbox report says "no malicious behavior / process exited", but the real environment sees a callback; cause — the sample detected sandbox features (VM hardware, debugger, network environment) and then slept or took the benign branch, so the report is a false negative; fix — cross-check [[re-behavior]] results from a real environment with memory residue from [[re-mem-forensics]]. Anti-sandbox samples depend on deep static work ([[re-binary-core]]) and memory leads
- **API quota / rate limit**: symptom — a VT free key returns 403/429, or a batch lookup is throttled midway; cause — a free key has a daily quota and a per-minute limit, and a batch script with no delay will hit it; fix — sleep inside the script loop (for example 15 seconds), aggregate with `/search`, and when the quota is gone switch to the web UI or wait for reset. Use jq to take only the fields you need so you make fewer requests
- **Hash false positives need multiple confirmations**: symptom — one vendor labels a benign file malicious (hash false positive), or a hash hits but the sample contents do not match (an old hash after rename/concatenation); cause — a single vendor signature is coarse, VT aggregate stats are not weighted, and the original hash is not strongly bound to file contents; fix — a "malicious" call needs multi-vendor agreement + family tags + behavior evidence. Do not accept one vendor. Before the lookup, recompute sha256 on the local file and compare it to the queried value (avoid querying the wrong hash)
- Endpoint cheat sheet and operation sequences are in [[commands]]. API-version and data-quality pitfalls are in [[gotchas]]

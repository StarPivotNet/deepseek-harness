# Browser-extension analysis decision tree and evidence grading

## Scenario decision tree (entry → branch)

### 1. Package-format decision (level 1)

```
Extension file
├─ "Cr24" header  → CRX (the Chromium family)
│  ├─ version number 2 → crx2 (old; Chrome stopped supporting install from Chrome 78; analysis still unpacks it)
│  └─ version number 3 → crx3 (the current standard, with a protobuf header + a proof signature)
├─ a plain zip with no Cr24 → may be an xpi (Firefox) or a zip of an unpacked directory
│  └─ after unpack, see whether manifest.json exists
└─ neither Cr24 nor zip → not a standard extension package; go back to [[re-triage]] and identify it again
```

- An extension directory (unpacked) can also be analyzed directly: manifest.json + script files match the packed contents
- Both the crx2 and crx3 headers are only a prefix, and the zip data starts at an offset from the tail — an `unzip` warning of `extra bytes` is the normal unpack signal

### 2. manifest version branch (level 2)

```
manifest_version
├─ 3 (MV3)
│  ├─ background: background.service_worker (Chrome); Firefox uses background.scripts
│  ├─ remote code: forbidden — a remote fetch = a review-bypass signal
│  ├─ site permissions: the independent host_permissions field
│  └─ traffic modification: declarativeNetRequest (webRequest blocking is only an enterprise-policy exception)
├─ 2 (MV2)
│  ├─ background: background.page, a resident page
│  ├─ remote code: allowed (eval / dynamic load) — a remote fetch is a common poisoning technique
│  ├─ site permissions: mixed into permissions (URL match patterns)
│  └─ traffic modification: webRequest blocking
└─ missing/illegal → the manifest is damaged or forged; mark the anomaly
```

### 3. Behavior-location branch (level 3)

```
After statically reading the manifest + scripts
├─ there is network-exfil code (fetch/XHR/sendBeacon/Image.src)
│  └─ the destination address can be decided statically → [[re-ioc]] indicator extraction
│  └─ the destination address is generated dynamically / fetched remotely → capture on the network side ([[re-netcap]]) → sandbox dynamic
├─ there is injection capability (content_scripts/scripting.executeScript/a dynamic script tag)
│  ├─ the injected code is embedded → static recovery ([[re-script-deob]])
│  └─ the injected code is remote → capture and recover the dynamic load
├─ there is sensitive-data collection (tabs/storage/cookies/keydown listeners/clipboard)
│  ├─ a small collection uploaded locally → mark the exfil destination as the focus
│  └─ collection + bulk upload → highly suspicious
├─ there is a self-hosted update_url update → pull a historical-version diff ([[re-variant]]) and locate the poison point
├─ there is nativeMessaging → check the host manifest file (outside the manifest) and the host program
└─ statically all clean → load it dynamically in the sandbox and watch network/storage/permission calls
```

### 4. Dynamic-phase branch

```
Load the extension in the sandbox
├─ the network has abnormal exfil → capture → recover the data format → extract indicators
├─ no exfil but storage has writes → inspect the stored contents and find the exfil trigger (interaction / a timer / a specific site)
├─ it fires only on a specific site → simulate a visit to the target site and watch content-script behavior
└─ no behavior the whole time → check the trigger conditions: user interaction, a permission-grant popup, a host permission that did not match
```

## Evidence grading table

| Level | Evidence form | Example | Use |
|---|---|---|---|
| A strong | Dynamic behavior + a closed network side | data exfil observed in the sandbox, and the capture matches the static-code destination | a "malicious" conclusion is allowed |
| B medium | A closed static code chain | the code plainly collects and uploads, and the manifest over-privilege claim holds | a "highly suspicious" conclusion is allowed |
| C weak | A static feature | only a high-risk permission declaration, or a high degree of obfuscation | supports only "needs a deeper look"; no conclusion |
| Counter-evidence | A benign explanation | the permission use matches the function, and there is no exfil code | record it and archive it |

- Malicious extensions often "ship a clean first version, then poison an update": a single-version conclusion must mark the version range (from which version it is malicious), and a version-chain comparison is a required step
- The conclusion also marks the browser family (Chromium/Firefox) — the same extension can behave differently on the two platforms (Firefox has no service_worker; updates go through the AMO channel)

## Implementation lessons (internalized)

- Fix the MV version before fixing the analysis framework: MV2/MV3 permission semantics, remote-code legality, and the traffic-modification API are completely different, and crossing them necessarily misjudges
- Static location must distinguish "data flow": collection (read API) → aggregation (storage) → exfil (network), and each stage needs a landing point
- Remote code is the strongest malicious signal in MV3, but in MV2 it is a legal capability — the same feature has different evidence strength under different MV versions
- Update-poisoning detection relies on a version diff, not single-version analysis: keep a file inventory / hash baseline and compare the new version file by file
- Before dynamic verification, finish reading the manifest permissions statically — that decides which API calls in the sandbox will be blocked by a permission popup, and avoids misjudging "no behavior"
- Evidence-chain record: file sha256, the original manifest, the exfil destination, the trigger condition (which context / which event)

## Usage notes

- Dynamic loading and triggering happen inside the sandbox ([[re-sandbox]], [[re-analyze/platform-tips]] supreme rule); an extension runs with the browser's privileges, and poor isolation is equivalent to executing malicious code
- Grade analysis conclusions against this table; state a permission-audit conclusion (over-privilege / excessive authorization) separately from a malicious conclusion

---
name: re-browser-ext
type: atomic
description: >
  Browser-extension reversing: the permission manifest, locating malicious behavior, recovering obfuscation, the store-review bypass surface.
  Triggers: `浏览器扩展`, `Chrome扩展`, `Firefox扩展`, `恶意扩展`, extension.
capabilities: [browser-extension]
---

# Browser-extension reversing

## When to use / when not to use

- Use: an extension file (crx/xpi/zip), malicious-extension behavior analysis, an extension permission audit
- Use: decide whether an extension is over-privileged, has remote code, or was poisoned by an update (a clean first version, a later version that is malicious)
- Do not use: web-page JS obfuscation ([[re-script-deob]] covers a pure script)
- Do not use: an exploit of the Chrome/Edge browser itself (an extension and a browser vulnerability are two objects)
- Note: dynamically loading an extension to run malicious behavior is executing unknown code — do it inside the sandbox ([[re-sandbox]], [[re-analyze/platform-tips]] supreme rule)

## Tool preparation

### unzip / 7z / python zipfile (unpack)

- Install and verify: see [[re-doc-malware]] tool preparation (7z)
- A crx = a "Cr24" header (version number + header length; crx2 contains a public key and a signature, crx3 contains a protobuf header and a proof) + zip data at the tail — `unzip`/`7z` unpacking directly reports an `extra bytes at beginning` warning but the result is correct; `python3 -m zipfile -e sample.crx ext/` has no warning
- An xpi is a plain zip; unpack it directly

### jq (manifest parsing)

- Linux: `apt install jq`; macOS: `brew install jq`; Windows: the official build
- Verify: `jq --version`

### node / js-beautify (script recovery)

- Linux: `apt install nodejs`; macOS: `brew install node`; Windows: the official installer from nodejs.org; verify: `node --version`
- js-beautify: `npm install -g js-beautify`, verify `js-beautify --version` (format minified JS before reading it)

### Browser load verification (dynamic, sandbox)

- Chromium family: `chrome://extensions` developer mode → Load unpacked; Edge is the same (`edge://extensions`)
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on (a signature-free temporary load)
- Verify: the extension appears in the extension list, and the background script/page can be opened

## Procedure

Run in order and archive each step's artifacts (path + sha256; see [[re-triage]]).

1. **Unpack and structure**:
   ```sh
   unzip -o sample.crx -d ext/ 2>/dev/null || python3 -m zipfile -e sample.crx ext/
   jq '.manifest_version, .name, .version' ext/manifest.json
   jq '.permissions, .host_permissions' ext/manifest.json
   # host_permissions is an MV3 field; MV2 site permissions are inside permissions (including URL match patterns)
   ```
   - Structure: manifest.json + a background script (MV3 service worker / MV2 background page) + content scripts (content_scripts) + pages (options/popup) + resources (web_accessible_resources)
   - Confirm `manifest_version` first (2 or 3) — the MV2/MV3 permission model and capability differences decide every later judgment (see [[gotchas]])
   - Other key fields: `update_url` (a self-hosted update manifest, a poisoning surface), `key` (extension-ID derivation), `externally_connectable` (an external-page message channel), `oauth2` (tokens), `optional_permissions` (ask for more rights at runtime), `minimum_chrome_version` (the compatibility boundary)
   - Secondary structure: `_locales/` (i18n messages, which can hide strings), `icons/`, `options_page` / `options_ui`, `commands` (shortcuts, a behavior-trigger entry), `incognito` (the incognito-window behavior declaration)

2. **Permission audit (capability boundary)**:
   - High-risk API permissions: `tabs` (read tab URL/title), `storage` (a data-collection cache), `webRequest` (observe traffic; MV3 blocking is only an enterprise-policy-deployment exception, and the usual path is `declarativeNetRequest`), `scripting` (MV3 dynamic injection), `clipboardRead` (clipboard), `cookies` (read site cookies), `history`, `downloads`, `nativeMessaging` (talk to a host program), `debugger`
   - Site permissions (host_permissions / URL patterns inside MV2 permissions) decide which sites' data it can touch — `<all_urls>` or `*://*/*` is a high-risk signal
   - Compare permissions with the declared purpose: it has `storage`+`tabs`+`<all_urls>` but the function is only a theme change — an over-privilege signal
   - Permission-risk cheat sheet (declaring it is the capability; you do not have to read the code):

     | Permission | Capability | Malicious use |
     |---|---|---|
     | `tabs` + `<all_urls>` | Read tab URL/title | Collect browsing habits |
     | `storage` | Local persistence | Cache collected data / push configuration |
     | `webRequest` / `declarativeNetRequest` | Observe traffic / modify rules | Monitor, inject, intercept |
     | `scripting` / `content_scripts` | Page injection | Keylogging, form theft |
     | `clipboardRead` | Read the clipboard | Steal clipboard contents (for example a wallet address) |
     | `cookies` | Read/write site cookies | Session hijacking |
     | `nativeMessaging` | Talk to a host program | Drop an executable / exfiltrate data |
     | `downloads` | Read/write downloads | Download poisoning / tamper with a downloaded file |

3. **Locate malicious behavior**:
   - Data exfil: fetch/XHR/`navigator.sendBeacon`, image-pixel exfil (`new Image().src`), collect into `chrome.storage` and then bulk-upload (join with [[re-netcap]])
   - Injection surface: content_scripts matching sites, dynamic injection (MV3 `chrome.scripting.executeScript`; MV2 `tabs.executeScript`), `web_accessible_resources` opening a page for a third-party site to call
   - Keylogging: a content script listens for keydown/input and exfiltrates it — search for `addEventListener('keydown'` and `value` reads
   - Trigger timing: `chrome.runtime.onInstalled` / `onStartup` (runs on install/startup), `chrome.alarms` / `setInterval` (a scheduled task), `chrome.runtime.onMessage` (message-driven) — recover the call chain from the trigger point; do not look only at top-level code
   - The background script is the core: an MV3 service worker / an MV2 background page; an MV3 service worker is terminated after about 30 seconds idle and woken by an event — state lands in `chrome.storage` or IndexedDB; do not look for persistent state in global variables

4. **Recover obfuscation**:
   - Join [[re-script-deob]] advanced obfuscation countermeasures (bootstrap/string table/CFF); format minified code with js-beautify before reading it
   - Remote code: MV2 allows remote JS (`eval` / dynamic load); MV3 forbids remote code (all code must be packaged) — a remote fetch appearing in MV3 = a review-bypass signal; mark it as a focus
   - A binary payload: analyze a downloaded Wasm/ArrayBuffer (hand off to [[re-binary-core]] for a survey)
   - Locate strings: `grep -rniE 'http|sendBeacon|fetch|XMLHttpRequest|chrome\.' ext/` scans the whole package; i18n strings are in `_locales/*/messages.json` (hiding a real URL under a message wrapper is common)

5. **Update mechanism and version poisoning**:
   - Chromium family: a self-hosted `update_url` update manifest (XML pointing at a new crx) is a poisoning entry; store auto-update is the same idea
   - Version comparison: pull an old extension version and diff it with the current version (file inventory / hashes / manifest / scripts) to locate "when the malicious code was introduced" (the [[re-variant]] approach)
   - Change attribution: classify the diff by file (a manifest permission change / a new script / a rewrite of an existing script); permissions expanding in an update is a poisoning signal
   - Firefox: updates go only through the AMO channel, and `update_url` has no effect — the poisoning surface differs

6. **Dynamic verification** (sandbox):
   - Load it into the browser (tool preparation), set up a proxy/capture ([[re-netcap]]), trigger the function, and watch network and storage changes
   - Analyze by context: background / content script / extension page are three isolated contexts; locate API call sites by context (pitfall 4)
   - An extension page/popup can open DevTools directly (F12 on a `chrome-extension://<id>/` page) — with breakpoints, watch global state and network calls inside the service worker
   - Join behavior records with [[re-ioc]] indicator extraction (C2 domains, command format)

## Cross-domain joins

- The [[re-managed]] gateway: where this skill belongs (the "browser extension" branch of the selection tree)
- [[re-script-deob]]: recover obfuscation
- [[re-netcap]]: join network behavior (exfil / remote fetch)
- [[re-variant]]: compare extension versions (detect malicious code after an update)
- [[re-triage]]: hash/survey archive of the unpacked artifact

## Common pitfalls

- **manifest version differences**: symptom — an MV2 analysis approach fails on MV3; cause — the permission models differ (MV3 forbids remote code / the background becomes a service worker); fix — confirm manifest_version first and analyze by the version branch (see [[gotchas]])
- **Remote-code policy**: symptom — static analysis cannot find the malicious logic; cause — the code is fetched remotely (MV2); fix — capture on the network side ([[re-netcap]]) and then recover it
- **Dynamic injection bypasses static analysis**: symptom — content_scripts have nothing malicious but behavior is abnormal; cause — injection at runtime; fix — hook the injection API (scripting.executeScript / tabs.executeScript)
- **Sandbox and page isolation**: symptom — extension API call sites are hard to locate; cause — the extension context is isolated from the page context; fix — analyze by context (background/content/page) and judge which context it runs in by which API it belongs to
- **Malicious after an update**: symptom — the first version is clean; cause — a version update injected malicious code; fix — a version diff ([[re-variant]])
- **Service-worker state is lost**: symptom — persistent data cannot be found in an MV3 background script; cause — the service worker is terminated when idle, and state is in the storage layer; fix — check data landed in `chrome.storage`/IndexedDB
- **Firefox MV3 differences**: symptom — the manifest writes `background.service_worker` but the background does not run in Firefox; cause — Firefox MV3 does not support the service_worker field and uses a `background.scripts` event page; fix — a two-field spelling (Chrome uses service_worker, Firefox uses scripts) and verify per browser
- More MV2/MV3 differences, crx format details, and the review-bypass boundary: [[gotchas]] and [[decision-tree]]

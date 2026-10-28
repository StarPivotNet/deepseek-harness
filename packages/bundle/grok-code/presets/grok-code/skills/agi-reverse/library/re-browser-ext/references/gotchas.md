# Browser-extension analysis methodology pitfalls and boundaries

## MV2 / MV3 difference group (the easiest to step on)

- **Permission-field semantics differ**: MV3 site permissions stand alone in `host_permissions`; MV2 mixes them into `permissions` (URL match patterns) — reading only one field misses half the permission boundary
- **Remote-code legality is the opposite**: MV2 allows remote JS (dynamic load / `eval`); MV3 forbids it entirely (all code must be packaged and shipped with the extension) — "fetching code remotely" is a common capability in MV2 and a review-bypass signal in MV3, and evidence strength differs by version
- **The background form differs**: MV2 is a resident background page; MV3 is a service worker — an MV3 worker is terminated after about 30 seconds idle and woken by an event, and **global-variable state is lost**; persistent state necessarily lands in `chrome.storage`/IndexedDB, and static analysis should not look for persistent data in global variables
- **The traffic-modification API was replaced**: MV2 `webRequest` blocking can intercept and modify; an MV3 store extension generally has only `declarativeNetRequest` left (declarative rules), and webRequest blocking is only an exception for enterprise-policy deployment — not finding webRequest intercept code in MV3 is normal
- **executeScript moved**: dynamic injection in MV2 is `tabs.executeScript`; in MV3 it is `scripting.executeScript` (needs the `scripting` permission) — search the matching API name for the version
- **action was unified**: MV2 `browser_action`/`page_action` are unified as `action` in MV3 — the page-popup code location differs by version

## Cross-browser difference group (Chromium vs Firefox)

- **Firefox MV3 does not support `background.service_worker`**: declaring it does not run it (ignored after a warning); it actually uses a `background.scripts` event page — the same extension's background may not run at all in Firefox, and dynamic verification must be done per browser
- **Update channels differ**: the Chrome family supports a self-hosted `update_url` update manifest (a poisoning entry); Firefox updates only through the AMO channel, and `update_url` has no effect — "self-hosted update poisoning" holds only for the Chromium family
- **Signature requirements differ**: Firefox AMO requires an extension signature (temporary load is the exception); the Chromium family can load an unpacked directory in developer mode — the dynamic-analysis entry differs
- **Extension ID derivation**: a Chrome extension ID is derived from the manifest `key` field public key / the package signature; a Firefox ID is declared explicitly in `browser_specific_settings.gecko.id` in the manifest — the place to find the ID differs

## Unpack and format group

- **Do not treat a crx unpack warning as an error**: `unzip`/`7z` reporting `extra bytes at beginning or within zipfile` on a crx is normal (the Cr24 header is in front), and the result is usable; for no warning, use `python3 -m zipfile -e`
- **crx2/crx3 header differences**: a crx2 header contains a public key and a signature (variable length); crx3 is a protobuf header + a proof — the header-length field is a LE 4 bytes; read the version number first, then the header length, and do not skip by a fixed offset
- **An xpi and a zip have no header**: a Firefox xpi is just a zip, and unpacking has no warning — "unpack reported an error" can itself be a format-decision clue

## Review-bypass and counterexample group

- **There is a poisoning surface even with no remote code**: the extension update mechanism (self-hosted / the store) is itself a remote-code channel — statically clean on one version ≠ safe; you must look at the update chain (counterexample: a clean first version that is malicious after an update is a common form)
- **Obfuscation is not malicious evidence**: store policy allows reasonable packaging obfuscation, but the combination of high obfuscation + high-risk permissions + little functionality is the suspicious signal — do not conclude from obfuscation alone
- **The `<all_urls>` permission is not necessarily malicious**: some legitimate functions (translation / dictionary / a script manager) really do need all-sites permission — judge by comparing "permissions vs declared function", and combine an over-privilege signal with behavior
- **A content script's isolated context**: a content script shares the DOM with the page but not the JS environment — variables the extension injected are not found in the page, and the extension cannot read page globals either; a cross-context evidence chain is recovered through messaging (runtime.sendMessage)

## Usage notes

- Dynamic loading and behavior triggering stay inside the sandbox ([[re-sandbox]], [[re-analyze/platform-tips]] supreme rule); an extension runs with browser-process privileges, and an unisolated environment does not load it
- Grade analysis conclusions per the [[decision-tree]] evidence table, and note the browser family and version range

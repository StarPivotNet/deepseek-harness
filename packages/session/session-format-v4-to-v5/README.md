---
description: "Restore V4 sessions and retain Automation origin in V5."
kind: package-library
---

# @deepseek-ai/dsh-session-format-v4-to-v5

English | [中文](README.zh.md)

## Summary

Persist Automation sessions with their origin intact and read V4 sessions as V5. The format catalog consumes this library automatically. Historical fork Automation logs enter through a dedicated V0–V3 importer; released V4 admission remains unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Callers use the [format catalog](../session-format-catalog/README.md) for full restoration. This library has no mounted plugin or profile configuration.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

V4-to-V5 changes only the header version. It retains event values, ids, times, sequence references and inherited cuts. V4 delivery acknowledgements retain their original generation and coordinates; the migration validates their V4 ownership before they become historical. A source marker claiming V5 is refused.

The V5 header admits optional `origin: automation` alongside `subagent`. Its codec reuses V2 physical framing and V4 tool-role row checks. Native restoration combines V5 header and delivery rules with V4 message, lifecycle and catalog rules. V5 accepts plugin sources with a nonempty `plugin` and Automation sources with a nonempty `ruleId`; installed Session validation adds current event vocabulary and projections. Unknown required events are refused and unknown ignorable events remain opaque.

The catalog imports historical fork versions 0 through 3, including `automation/start` and `workspace/home` events. It retains optional `origin: automation` separately while decoding the historical header and body, then converts V3 event content directly into a validated V5 artifact. It never publishes an intermediate V4 artifact. Parent-specific child evidence is mandatory. Source generations remain unchanged.

No runtime invariant installer exists because the library owns no independently observable runtime state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Format version status](../../../docs/session-format-status.md)

-----

<a id="model-experience"></a>
## Model Experience

### Historical restoration

#### What the model sees

Restoration preserves recorded message text and tool outcomes. A `step/end` immediately followed by `turn/end` with `reason.kind: error` may retain unresolved tool calls; restoration does not add a result or assert whether those tools executed.

#### Token effect

Restoration does not add request text or token-bearing data.

#### KV Cache effect

The recorded message prefix is preserved. Provider cache availability remains outside this library.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Historical fork vocabulary** — Required fork-specific events outside the released V3 vocabulary may be refused; a header round trip does not establish complete historical-body compatibility.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

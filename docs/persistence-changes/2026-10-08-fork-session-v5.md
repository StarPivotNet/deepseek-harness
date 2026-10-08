---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-08-fork-session-v5

English | [中文](2026-10-08-fork-session-v5.zh.md)

## Summary

Introduces Session V5 for fork Automation origins and records the fork persistence declarations integrated with the upstream tool-role format: plugin and Automation message attribution, content and stream variants, compaction and turn reasons, and Automation, Git worktree and workspace-home events.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-fork-session-v5
baseline: false
changes:
  - root: "JsonlHeaderLine"
    previous: "2026-09-11-initial"
    after: "c38468640f610c3b433e228653ad70dcff8338490cc1322bfc6dfa84a43f9e9c"
    decision: version-bump
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "d58117c1937707bdb7571cfe247ca9d8161240f083ea98ec135fe0a60d30b7f8"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "deb102e1d907fe4f699902ae7983c013aebe7b6bcb6ed3ee83dc148cf5e38000"
    decision: version-bump
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "e00641f970bcff84df572433fd713a5e271271c23f44f29977f0991da3aefa41"
    decision: version-bump
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "556c88600d5b3be215fa10ad5aceafabcc4f1d18b6b67c74b38713eb5b6aded3"
    decision: version-bump
  - root: "event:automation/start"
    previous: null
    after: "9700696484c6d77cedcab6a3399074e6a0b6cbf20aa5b36203586c94830078e5"
    decision: version-bump
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "29a07534084b4565ee154eb9b758e622d1e36cc8e8bdce919eaf65daefa06a11"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "9cb8c67de912cf02402a4d907eb6ba5770ae8099ddbc2f3396b7fc712b6fa619"
    decision: version-bump
  - root: "event:git/worktree"
    previous: null
    after: "8bf78ec58380e8abd6badb0e5ed11e304127943a024be388e51b81ea34a06e4b"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "80ee54c4efca150ae49faf872d5cfd58834b292ea5aedcd07d50ff95291e4ff3"
    decision: version-bump
  - root: "event:system/message"
    previous: "2026-09-16-session-format-v4"
    after: "9e726a19d58f50ad5d4ba09c62c995fbe567564d7fa3a2cd907d64dbf5fb1aa7"
    decision: version-bump
  - root: "event:team/message/queued"
    previous: "2026-09-16-session-format-v4"
    after: "efd1c8a3ab6abef460f57d3bcbab14ec0612443bad8e8eab625a31ad95261cee"
    decision: version-bump
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-16-session-format-v4"
    after: "2725a6dddcfa8b6892c9651bb9f571f54ac7dca0633865396d60fee47e2988ba"
    decision: version-bump
  - root: "event:tool/result"
    previous: "2026-09-16-session-format-v4"
    after: "9b4ea125d16efea64b79e6dd1020dcedc14e964fd0e82f1d91c766357114a467"
    decision: version-bump
  - root: "event:turn/end"
    previous: "2026-09-16-session-format-v4"
    after: "59bd7f2194206cb07b35527add284e39823e05878b20d39a190ea160ab6cb587"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "9e2985f0a328f5edf9d4309061cd0370063829fe03ba49f0a6609c9608ddff5f"
    decision: version-bump
  - root: "event:workspace/home"
    previous: null
    after: "330fdbfc04ff10a78eada922ced3f762fa4256ce91d54453d02fcf1653799d37"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

V4 admission and accepted schemas remain unchanged. The V4-to-V5 edge preserves event content and coordinates. The dedicated historical Automation importer retains origin outside upstream V0–V3 header validation, admits the observed automation/start and workspace/home fork events, and converts event bodies directly to V5. It creates no intermediate V4 artifact. Existing source generations are never overwritten. Required historical extensions outside the admitted fork vocabulary can still be refused.

<a id="verification"></a>
## Verification

Existing V4 migration and Automation tests: 404 passed. Direct probes restored nine copied production logs spanning V0, V2 and V3 ordinary, subagent and Automation sessions, then strictly round-tripped each through V5. Synthetic probes covered new headers and invalid origin refusal. These samples do not establish compatibility of every stored historical session.

<a id="dev-note"></a>
## Dev Note

None.

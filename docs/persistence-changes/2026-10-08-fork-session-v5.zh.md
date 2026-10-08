---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-08-fork-session-v5

[English](2026-10-08-fork-session-v5.md) | 中文

## 概述

引入 Session V5 以支持分支 Automation 来源，并记录与上游工具角色格式集成的分支持久化声明：插件和 Automation 消息归属、内容与流变体、压缩及回合原因，以及 Automation、Git 工作树和工作区主目录事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

V4 接纳规则和已接受模式保持不变。V4 到 V5 边保留事件内容和坐标。专用历史 Automation 导入器在上游 V0–V3 头部校验之外保留来源，接纳已观察到的 automation/start 和 workspace/home 分支事件，并将事件体直接转换为 V5，不创建中间 V4 制品。已有源代际不会被覆盖。超出已接纳分支词汇的历史必读扩展仍可能被拒绝。

<a id="verification"></a>
## 验证

现有 V4 迁移和 Automation 测试：404 项通过。直接探针恢复了九份生产日志副本，覆盖 V0、V2、V3 的普通、子会话和 Automation 会话，再逐份通过 V5 严格往返。合成探针覆盖新头部和非法来源拒绝。这些样本不代表所有已存历史会话都兼容。

<a id="dev-note"></a>
## 开发备注

无。

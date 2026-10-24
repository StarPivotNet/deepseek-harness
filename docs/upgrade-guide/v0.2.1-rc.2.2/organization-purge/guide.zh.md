---
kind: upgrade-guide
description: "组织版 dsh 默认加载 Purge，并移除其独立上游更新接口。"
---

# 内置 Purge 改变 profile 默认值和更新归属

[English](guide.md) | 中文

## 变更

组织版的 `web`、`desktop`、`headless`、`sdk` 和 `acp` profile 现在包含 `@deepseek-ai/dsh-purge`，默认自动应用宿主兼容补丁。已有 profile 会加入该层，除非明确选择退出。`/dsh-purge/update` 已删除；`/redteam/api` 的版本查询只报告内置版本，拒绝单独更新包。Purge 工具、提示词、设置和红队功能默认可用，会改变现有会话的模型可见上下文与工具 schema。

## 迁移

1. 保留升级后的默认行为，或在启动前向 profile 的 `dsh.profile.bundles` 列表添加 `!@deepseek-ai/dsh-purge`。若只需停用插件，在 `cordis.patch.yml` 中用 `config: { enabled: false }` 覆盖 `dsh-purge` 条目。
2. 在 **设置 → Purge** 查看当前宿主补丁状态，并按提示重启。若有未匹配补丁，不要将它应用到另一套安装。
3. 移除调用 `/dsh-purge/update` 的自动化流程。改为升级完整的组织版 dsh，不再从外部下载 `dsh-purge`。已有 `dsh-purge` 设置和红队数据目录保留。
4. 运行 `dsh --profile <name> --dump-config`，确认 Purge 条目存在或退出标记保留，并确认新会话使用预期的提示词和工具集合。

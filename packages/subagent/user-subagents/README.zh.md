# dsh-user-subagents

[English](README.md) | 中文

用户编写的子代理定义库。`UserSubagents` 提供 `ctx.userSubagents`，并从实时 volatile Config 暴露 `user-subagents` settings 命名空间；设置页通过该条目的 settings 命名空间写入定义库。

设置页负责创建、编辑、删除。[`dsh-tool-subagent`](../tool-subagent/README.zh.md) 读取实时库，并在启动时应用所选定义的 persona 与工具过滤。

- `ctx.userSubagents.current()` 返回一份独立的 `{ definitions }` 快照。
- `ctx.userSubagents.get(id)` 返回一条定义；id 缺失时返回 `undefined`。
- 一条定义可以设置 `allow` 和／或 `deny`。两者都省略则不产生工具过滤。

未知 id、重复 id、空名称以及空的过滤名称会在 Settings 写入时失败。

## 模型体验

### 选中的用户定义

#### 模型所见

库非空时，父级 `subagent` 工具会公开可选的 `agent` 枚举，列出定义 id 与简短说明。选中一条后，该定义的 persona 与工具过滤会应用到子代理。省略 `agent` 则沿用该工具实例已配置的组合。

#### Token 影响

每条列出的定义都会把它的 id 与说明加入父级工具 schema。子代理的提示词随后携带该定义的 persona，而不是部署 persona。

#### KV Cache 影响

只要库的 id、说明以及此前的工具 schema 保持相同，前缀就保持稳定。创建、重命名、删除或重排一条定义，可能从第一个变化的工具 schema token 起使复用失效。

## 已知限制与暂缓事项

- 定义是进程范围的，不按会话。每个能调用 `subagent` 的父级都看到同一份库。
- 一条定义不能改变子代理的提供方、模型或深度上限。这些仍由工具实例配置决定。

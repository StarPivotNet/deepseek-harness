# dsh-client-ui-settings-system-prompts

[English](README.md) | 中文

**系统提示词**设置分区。该页列出 Host 已注册的插件段，允许用户编辑或恢复每一段，并拥有额外的用户提示词库和按模型组装：创建、编辑、删除可复用提示词，再为目录中的每个模型选择要用哪些额外提示词、按什么顺序，以及是否替换已组装提示词。

写入走 `user-system-prompts` 命名空间上的 `settings.replace`。已注册段通过 `systemPrompt.list` 加载。Host 插件 [`dsh-user-system-prompts`](../../core/user-system-prompts/README.zh.md) 在下一次组装步骤应用已存储的替换和选择。

导航行位于 Agent 预设之后（`order: 25`）。未暴露该命名空间的部署渲染不可用说明，而不是编辑器。

## 模型体验

无。该分区渲染浏览器配置 UI；它写入的值只通过 `dsh-user-system-prompts` 到达模型。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **模型列表来自主机目录**——已配置但列表失败的路由只出现在目录错误行，不会成为可组装卡片。
- **已注册段是 Host 全局层**——会话作用域的 persona 叠加不会出现在这里。
- **覆盖按模型，不按单条提示词**——该模型选中的全部额外文本一起追加或一起替换已组装提示词。

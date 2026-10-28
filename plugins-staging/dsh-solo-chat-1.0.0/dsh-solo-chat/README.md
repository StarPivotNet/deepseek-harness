# dsh-solo-chat

独立聊天插件。安装并重启后，侧边栏「插件市场」下方出现「独立聊天」。

- 列表里可以新建聊天，点一条进入原来的聊天区域。
- 每条聊天是独立会话，不共享上下文，也不进未分组。
- 这些会话记在 `$DSH_HOME/solo-chat`，不使用当前项目。
- 权限锁定为完全访问（`danger-full-access`）。

```sh
dsh plugin --profile desktop add ./dsh-solo-chat
```

安装后重启 DeepSeek Harness。

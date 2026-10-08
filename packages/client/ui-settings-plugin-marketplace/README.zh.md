# `@deepseek-ai/dsh-client-ui-settings-plugin-marketplace`

[English](README.md) | 中文

web profile 随安装内置的**插件市场**。启动后，设置 → 插件变为发现、已安装，以及随附的配置卡片。发现页会立即读取上次缓存的目录，再在后台从随附 Host 路径 `/plugin-catalog/catalog.json` 刷新（由 [`dsh-host-plugin-catalog`](../../host/plugin-catalog/README.zh.md) 提供）。运营者仍可继续添加更多 http(s) 目录 URL。

Host 半侧（`./host`，Loader id `plugin-marketplace`）在 `/plugin-marketplace` 注册回环 Connection RPC 通道，以及 `/reload`、`/update`、`/reboot` 命令。浏览器半侧（`./client`，Loader id `ui-settings-plugin-marketplace`）通过 `settings.plugins.tab` 槽把发现、已安装两页作为标签注册到插件设置页；其包入口是空的 Host `apply`，因此该行不会把 RPC 通道再注册一次。安装只接受一个 npm 注册表包名。路径、`file:` 和 git spec 会被拒绝。 Host 通过 `profileContext` 读取 CLI 当前配置档。

## 模型体验

无。该市场是 Host／浏览器设置界面；其中没有任何内容会进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

- **自动客户端 HMR 保持关闭**：只要本行已挂载，就会把 `client-hmr.autoReload` 钉为 `false`，并保持 Host `hmr` 行禁用。请改用 `/reload` 或 `/reboot`。
- **安装成功后仍需重启 Host**：写入 profile 并不会把新组合包即时挂载进当前进程。

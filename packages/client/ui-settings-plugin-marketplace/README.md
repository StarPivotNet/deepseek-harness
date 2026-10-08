# `@deepseek-ai/dsh-client-ui-settings-plugin-marketplace`

English | [中文](README.zh.md)

In-box **Plugin marketplace** for the web profile. After boot, Settings → 插件 becomes Discover, Installed, and the shipped configuration cards. Discover reads the last cached catalog immediately, then refreshes in the background from the shipped Host path `/plugin-catalog/catalog.json` (served by [`dsh-host-plugin-catalog`](../../host/plugin-catalog/README.md)). Operators can still add more http(s) catalog URLs.

The Host half (`./host`, Loader id `plugin-marketplace`) reads the active CLI profile from `profileContext` and registers a loopback Connection RPC channel at `/plugin-marketplace` and the `/reload`, `/update`, and `/reboot` commands. The browser half (`./client`, Loader id `ui-settings-plugin-marketplace`) registers its Discover and Installed pages as tabs on the Plugins settings page through the `settings.plugins.tab` slot; its package entry is an empty Host `apply` so that row does not register the RPC channel a second time. Install accepts one npm registry package name. Path, `file:`, and git specs are refused.

## Model Experience

None, as the marketplace is a Host/browser settings surface; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Automatic client HMR stays off** — while this row is mounted it pins `client-hmr.autoReload=false` and keeps the Host `hmr` row disabled. Use `/reload` or `/reboot` instead.
- **A successful install still needs a Host restart** — the profile write is not a live mount of the new bundle.

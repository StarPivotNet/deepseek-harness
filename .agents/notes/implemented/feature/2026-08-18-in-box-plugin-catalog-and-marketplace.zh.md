# Agent Note: 随安装内置的插件目录与市场

Status: implemented

[English](2026-08-18-in-box-plugin-catalog-and-marketplace.md) | 中文

## Problem

发现页依赖 `StarPivotNet/dsh-plugin-catalog` 上的公开 GitHub raw URL，市场本身又以 `@starpivot/dsh-plugin-marketplace` 的形式活在树外。因此全新的 web profile 在额外安装该组合包之前没有发现清单；即便安装了，GitHub 不可达时发现页也会失败。

## Decision

web profile 同时交付两半：

- [`dsh-host-plugin-catalog`](../../../../packages/host/plugin-catalog/README.zh.md) 在具名 Host 路由 `/plugin-catalog/catalog.json` 上提供已 pin 的 StarPivot `catalog.json`。
- [`dsh-client-ui-settings-plugin-marketplace`](../../../../packages/client/ui-settings-plugin-marketplace/README.zh.md) 是原先的公开市场，现在是随安装内置的双面包。Host 行导入 `./host`；包入口是空的 Host `apply`，供浏览器行使用，避免两行都注册 `/plugin-marketplace`。它的默认目录 URL 就是这条 Host 路径。Host 半侧仍接受额外的 http(s) 目录 URL。

市场以标签页方式加入插件设置页：[`dsh-client-ui-settings-plugins`](../../../../packages/client/ui-settings-plugins/README.zh.md) 拥有该分区，并通过 `settings.plugins.tab` 槽组合各功能自有的页面（见 [web 插件配置](../../archived/feature/2026-08-10-web-plugin-configuration.md)）。`ui-settings-plugin-inventory` 行在 web profile 补丁中保持禁用。

## Alternatives considered

- **市场继续留在树外，只把 `catalog.json` vendor 进来。** 已拒绝，因为全新 web profile 仍要二次安装后才有发现页。
- **默认拉取 GitHub，失败再回退到随附文件。** 已拒绝，因为 Host 已有 webserver；具名路由就是目录源，而不是后备。
- **把目录挂到 SPA 回退上。** 已拒绝，因为未命中会变成 `index.html` 而不是 JSON。

## Consequences

新的 web profile 打开发现页时使用随附清单，不必访问 GitHub。运营者仍可添加远程目录。清单编辑是对 `packages/host/plugin-catalog/catalog.json` 的源码变更。当前 pin 与 `StarPivotNet/dsh-plugin-catalog` 同为协议第 1 版的十八行，含从 `StarPivotNet/dsh-plugins-public` 发布的十个 `@starpivot/dsh-*` 分享拷贝。

# Agent Note: 市场发现页等待 Plugins slot 声明

Status: implemented

[English](2026-09-05-marketplace-tab-waits-on-plugins-declaration.md) | 中文

## 问题

随安装内置的市场浏览器半侧用 `ctx.effect` 里的裸 `ctx.slots.register` 把发现页贡献到 `settings.plugins.tab`。该 slot 只作为插件设置分区的子项存在。市场 Loader 项若先激活，register 会抛出 `slot "settings.plugins.tab" is not declared (a parent entry's children table must declare it)`，整个市场 fiber 应用失败。

## 决策

发现页与清单页一样使用 `ctx.slots.inject('settings.plugins.tab', …)`。注入会等待插件分区声明该 slot，在声明被替换时重新注册，并随市场 fiber 离开。该贡献仍不带 `children` 表：发现页不渲染 `settings.plugin.item`，再次声明这个嵌套 slot 会与可配置标签页冲突。

slot 级等待是 [slot 声明注入](../architecture/2026-08-05-slot-declaration-injection.zh.md) 的通用规则。市场仍按 [随安装内置的插件目录与市场](../feature/2026-08-18-in-box-plugin-catalog-and-marketplace.zh.md) 以标签页加入插件设置。

## 备选方案

**在 web 补丁里把市场 Loader 行排到 `ui-settings-plugins` 之后。** 否决。客户端 manifest 的 `inject` 行不决定激活顺序，后续重载仍可能在两边服务都已挂载时颠倒顺序。

**由 SlotMap 拥有方 `ui-settings` 把 `settings.plugins.tab` 声明为根子项。** 否决。插件分区拥有标签栏；该 slot 只在该分区挂载期间存在。

**保留裸 `register` 并捕获未声明 slot 的错误。** 否决。漏掉声明就是损坏的组合；捕获会把真正缺失的插件分区藏起来。

## 测试

`packages/client/ui-settings-plugin-marketplace/tests/client/browser-plugin.client.spec.tsx` 在没有标签声明时挂载浏览器半侧并断言条目为零，随后由父级 children 表声明 `settings.plugins.tab`，并要求出现 `discover` 贡献。撤销声明会去掉该标签；再次声明恢复同一组件；dispose（资源释放）市场 fiber 会移除它。

## 后果

web profile 在市场 fiber 早于插件分区启动时不再让该 Loader 项失败。发现页在分区声明标签 slot 后出现。

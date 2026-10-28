# Agent Note: 桌面标题栏只给 body 留白

Status: implemented

[English](2026-08-15-desktop-titlebar-double-padding.md) | 中文

## 问题

Electron 壳注入 36px 固定标题栏后，又在 `html` 和 `body` 上都用 `padding-top` 预留同一高度。Web GUI 已经设置 `html, body, #root { height: 100% }` 且 `box-sizing: border-box`。两层 padding 叠在一起：固定栏盖住第一段 36px，第二段 36px 露出 `body` 的 `--dsw-alias-bg-base`（浅色主题为白），夹在深色标题栏和 app frame 之间。

## 决策

`titlebarStyles` 只给 `body` 加 padding。Web GUI 的高度链随后把 `#root` 算进 body 内容盒，只留一条预留带，固定栏盖住这段 padding。平台变体、overlay 宽度和红绿灯内边距仍由 [macOS 外观笔记](../feature/2026-08-15-desktop-macos-chrome.zh.md) 记录。

## 备选方案

**改给 `html` 而不是 `body` 留白。** 否决。`body` 才是背景和 `#root` 百分比高度已经描述的画布；给 `html` 留白会空出一段不属于标题栏的背景。

**在 Web GUI 里给 `#root` 自己加 `padding-top` 或 `height: calc(100% - 36px)`。** 否决。预留带归桌面壳。Web GUI 在浏览器里仍是满高文档。

**把多出来的那条涂成标题栏颜色。** 否决。这只是盖住叠层空隙，没有去掉它，app frame 仍会被截短 36px。

## 后果

浅色主题桌面不再在标题栏下露出空白带。加载页仍用 `calc(100vh - var(--dsh-desktop-titlebar))` 相对单层 body padding 给居中提示定高。

## 测试

`apps/desktop/tests/titlebar.spec.ts` 断言注入规则是 `body { padding-top: … }`，并拒绝 `html, body` 的 padding 选择器。

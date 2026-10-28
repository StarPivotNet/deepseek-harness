# Agent Note: 桌面标题栏拖拽需要真实命中盒

Status: implemented

[English](2026-08-19-desktop-titlebar-drag-hitbox.md) | 中文

## 问题

无边框窗口只在 Chromium 登记了 `-webkit-app-region: drag` 的位置才能移动。产品名标签离开预留条后，该区域变成空的 flex 子项。空 flex 项没有命中盒，指针因此无法开始窗口拖拽。同一条规则还在 `did-finish-load` 之后由页面 `<style>` 追加；Chromium 不会登记这种晚到的页面拖拽区。

## 决策

`titlebarStyles` 把 `.dsh-desktop-drag` 画成带明确高度和平台 inset 的绝对定位块：macOS 左侧留 70px 给红绿灯，Windows 右侧留 138px 给标题按钮 overlay。`attachTitlebar` 在 `dom-ready` 用 `webContents.insertCSS` 安装这些样式，并在 `did-finish-load` 只注入 markup。启动页仍把样式写进自己的文档。系统控件 inset 仍由 [macOS 外观笔记](../feature/2026-08-15-desktop-macos-chrome.zh.md) 记录；空白预留条仍由 [省略产品名笔记](../simplification/2026-08-16-desktop-titlebar-omits-product-name.zh.md) 记录。

## 曾考虑的替代方案

**保留空 flex 子项，只为给它尺寸而恢复隐藏标签。** 不予采用：零透明度标签仍是标题栏文案，省略产品名笔记已经禁止这样做。

**调用 `BrowserWindow.setMovable`，或从 mousedown IPC 开始拖拽。** 不予采用：`setMovable` 不能替代无边框窗口上缺失的 `-webkit-app-region`，自定义拖拽循环还会抢走 Web GUI 已在使用的指针捕获。

**继续把样式放在注入的页面 `<style>` 里。** 不予采用：加载后的页面样式表不会登记拖拽区。`insertCSS` 才是 Electron 会登记的路径。

## 后果

拖动预留条会移动窗口。原生红绿灯和 Windows 标题按钮 overlay 留在拖拽盒外，因为 inset 缩小盒子本身，而不是在全宽盒子内部做 padding。双击最大化仍绑定在拖拽节点上。

## 测试

`apps/desktop/tests/titlebar.spec.ts` 断言两个变体都输出绝对定位拖拽盒、平台 inset 和 `-webkit-app-region: drag`，且 `titlebarInjectScript` 不再内嵌样式表。

# Agent Note: ModelSelect drill keeps the menu open after the focused cell unmounts

Status: implemented

[English](2026-09-04-model-select-drill-survives-unmount-blur.md) | 中文

## 问题

composer 模型席位的两级菜单通过把根单元格换成所选列表来钻入「模型」和「推理等级」。指针点击会先聚焦根单元格，再把它卸载。即使指针仍在席位内，Chrome 也会发出没有 `relatedTarget` 的冒泡 `focusout`。`ModelSelect` 把任何没有席位内 `relatedTarget` 的失焦当成离开席位并关闭菜单，因此「推理等级」（以及「模型」）看起来没有反应。

目录选择器已经记录：Safari 在按钮上按下指针时，`relatedTarget` 也可以为空（[目录选择器](../../archived/architecture/2026-07-28-directory-picker-capability-seam.md)）。那篇笔记负责编辑器取消，而不是这个 composer 菜单。

## 决策

`ModelSelect.onBlur` 在 `relatedTarget` 是席位外节点时仍然关闭。当没有下一节点，且事件 `target` 仍在席位内或已经断开连接时，处理函数直接返回、不关闭。这就是钻入卸载：焦点单元格已消失，但离开仍起源于席位内部。文档级 `mousedown` 点在外面，以及之后带席位外 `relatedTarget` 的失焦，仍然会关掉菜单。

## 考虑过的替代方案

**在根单元格的 `mousedown` 上阻止默认行为，使它们永不获得焦点。** 否决，因为键盘用户仍会聚焦这些单元格，之后从已聚焦单元格钻入会再次触发同样的卸载失焦。

**保留根单元格，把钻入列表叠在上面。** 否决，因为两级菜单一次只显示一个窗格；同时保留两者会为了一个焦点缺陷改变卡片高度和键盘条目集合。

**忽略每一个空的 `relatedTarget`。** 否决，因为一次没有点名下一节点的真正离开会让菜单一直开着，直到发生席位外的 mousedown。

## 后果

在 Chrome 中点击「推理等级」或「模型」现在会进入钻入列表。键盘 Tab 带着席位外的具名 `relatedTarget` 离开席位时仍然关闭。`relatedTarget` 为空且 `target` 已在席位外的离开仍然关闭。

## 测试

`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` 先点击「推理等级」，再向席位派发 `relatedTarget: null` 的冒泡 `focusout`，以及一次 `target` 已断开连接的 `focusout`，并断言推理等级单选项仍在。后续用例把焦点移到席位外节点，并断言菜单卸载。

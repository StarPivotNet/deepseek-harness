# Agent Note: 用量指标保持单行且热力图格子可见

Status: implemented

[English](2026-09-17-usage-metrics-heatmap-layout.md) | 中文

## 问题

设置里的使用统计把五张指标卡塞进 800px 面板。中文紧凑量级如 `59.4亿`、`5小时5分` 会在窄列里换行，单位落到第二行。Token 活动热力图用 `--dsw-alias-bg-layer-2` 画空格子，浅色主题下该 token 与白色卡片同色；52 周按固定 10px 列加间距排布，会溢出卡片，最近几周（含今天）被裁掉。

## 决策

指标值使用 `white-space: nowrap`，重置 `dd` 的默认外边距，中文时分文案不加多余空格，让紧凑量级保持单行。空热力格子改用 `--dsw-alias-bg-overlay`（浅色 bluish-150，深色 bluish-700），无用量的日子仍能看出网格。热力图网格为 `repeat(52, minmax(0, 1fr))` 且 `width: 100%`，364 个格子铺满卡片而不溢出。

## 备选方案

**保留换行，把单位改成数字下方的说明。** 否决。紧凑格式化器已经带单位；五列行里的第二行正是截图里的缺陷。

**给空格子写字面灰色。** 否决。功能 CSS 只消费语义别名；overlay 是现成的抬升填充 token，在两种主题下都与 `bg-layer-1` 对比。

**固定 10px 的 GitHub 风格网格并横向滚动。** 否决。该页目前是裁切而不是滚动，今天这一列正是查看者无需平移就应看到的列。

## 后果

极窄列里较长的本地化时长会省略号截断，而不是换行。即使全部为 level 0，空热力日也可见。深色主题空格子仍深于卡片：overlay 为 bluish-700，layer-1 为 bluish-875。

## 测试

`packages/client/ui-settings-usage/tests/usage-section-styles.client.spec.ts` 钉死 nowrap、overlay 空填充和 52 列铺满。`packages/client/ui-settings-usage/tests/components.client.spec.tsx` 断言中文紧凑量级渲染为单个文本节点。

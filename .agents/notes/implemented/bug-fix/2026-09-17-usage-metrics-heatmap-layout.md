# Agent Note: Usage metrics stay one line and heatmap cells stay visible

Status: implemented

English | [中文](2026-09-17-usage-metrics-heatmap-layout.zh.md)

## Problem

The Settings usage page packed five metric cards into the 800px settings panel. Compact Chinese magnitudes such as `59.4亿` and `5小时5分` wrap inside each narrow column, so the unit sits on a second line. The Token activity heatmap paints idle cells with `--dsw-alias-bg-layer-2`, which is white in light theme on a white card, and lays 52 weeks of 10px columns plus gaps at a fixed size that overflows the card. Recent weeks, including today, clip out of view.

## Decision

Metric values use `white-space: nowrap` with a `dd` margin reset, and Chinese hour/minute copy has no extra spaces, so a compact magnitude stays on one line. Idle heatmap cells use `--dsw-alias-bg-overlay`, which is bluish-150 in light theme and bluish-700 in dark theme, so empty days remain a grid. The heatmap grid is `repeat(52, minmax(0, 1fr))` at `width: 100%`, so 364 cells fill the card instead of overflowing it.

## Alternatives considered

**Keep wrapping and drop the unit onto a caption under the number.** Rejected. The compact formatter already owns the unit; a second line inside a five-column row is the defect the screenshot shows.

**Paint idle cells with a literal grey.** Rejected. Feature CSS consumes semantic aliases; overlay is the existing raised-fill token that contrasts with `bg-layer-1` in both themes.

**Horizontally scroll a fixed 10px GitHub-style grid.** Rejected. The page already clips rather than scrolls, and today's column is the one a viewer needs without panning.

## Consequences

Long localized durations may ellipsize in a very narrow column instead of wrapping. Empty heatmap days are visible even when every cell is level 0. Dark theme idle cells remain darker than the card because overlay is bluish-700 against layer-1 bluish-875.

## Testing

`packages/client/ui-settings-usage/tests/usage-section-styles.client.spec.ts` pins the nowrap, overlay idle fill, and 52-column fit. `packages/client/ui-settings-usage/tests/components.client.spec.tsx` asserts a compact Chinese magnitude renders as one text node.

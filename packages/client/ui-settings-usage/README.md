# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

The **Usage** settings section. The page sums provider-reported tokens and model wall time across every visible Session, then charts calendar activity, a daily trend, and model shares. It writes nothing.

The nav row sits after Skills (`order: 35`). The first mount calls `usage.overview` with the browser IANA zone; that RPC inspects Sessions without activating Agents and rebases UTC calendar rows onto the caller zone.

Metric cards show lifetime tokens, peak tokens, longest assembled-message duration, and activity streaks. Compact magnitudes stay on one line. The heatmap, trend, and donut are local viewing state over that snapshot. Idle heatmap cells use the overlay fill so empty days remain a grid, and the 52-week grid fills the card width. Loading, empty, and generic failure states stay on the mounted component; a failed read can be retried without exposing transport details.

## Model Experience

None, as the section renders a browser catalog of already-logged usage.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Read-only snapshot** — the page does not subscribe to live usage updates.
- **Unreadable Sessions are skipped** — a missing, corrupt, or otherwise unreadable Session contributes empty usage instead of failing the page.
- **Personal-plan tab is absent** — only local application usage is shown.
- **UTC days rebase onto the local day that contains UTC midnight** — a late-evening Session in a negative-offset zone can land on the previous local day.

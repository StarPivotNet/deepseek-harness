---
name: market-desk
description: "Use for 币市 quotes, OKX 现货, OKX 永续, 美股 quotes or candles, and a 做多、做空、或等待 stance from those numbers. Call market_quote, market_candles, or market_search. Not order placement, not wallet balances, not A股 or 港股."
---

# Market desk

Public quotes. All three tools are read-only: `market_quote`, `market_candles`, `market_search`. Every number you report must point back to a tool field from this turn. With no result from this turn, do not report a price.

Balances, order placement, wallets, A股, and 港股 are not in this tool set. When the user wants an order, hand back the quote you already fetched and say there is no order API here.

## Pick a market

| User says | venue | symbol |
|---|---|---|
| 现货, coin, BTC | `spot` | `BTC` or `BTC-USDT` |
| contract, 永续, SWAP | `swap` | `BTC` or `BTC-USDT-SWAP` |
| 美股, AAPL | `us` | `AAPL` |

Spot symbols do not include `-SWAP`. The tool expands a contract symbol to `BASE-USDT-SWAP`. For a dotted US ticker, keep only the segment before the dot, so `BRK.B` becomes `BRK`. Strip a lowercase `us` prefix only when uppercase letters follow immediately: `usAAPL` is `AAPL`, and `USO` stays `USO`. On the 永续 board, `volume` is 24h base-coin volume times last price, an approximation of USDT turnover.

Done: venue and symbol are both set, then call the tool.

## Quote

Call `market_quote`.

For 现货 and 美股, report `last`, `change_pct`, `high`, `low`, `quote_volume`, plus `source` and `ts`.

For a contract, also report `funding_rate`, `next_funding_time`, `open_interest`, and `open_interest_ccy`. If `warning` is not empty, say it as-is. Do not fill it in as 0.

`change_pct` is a percent number: `1.2` means 1.2%, not 120%. `funding_rate` is the raw OKX ratio: `0.0001` means 0.01%, not a percent number.

## Candles

Call `market_candles`. Results are oldest first.

OKX `bar`: `1m`, `5m`, `15m`, `1H`, `4H`, `1D`, `1W`, `1M`. Omitted means `1H`. Daily bars cut at 00:00 UTC+8. `time` is still UTC.

US `bar` is only `1D`, `1W`, `1M`. Omitted means `1D`, forward-adjusted. There is no 1-minute bar.

`limit` defaults to 30 and maxes at 100.

## Search

Call `market_search` when the symbol is uncertain.

现货 and 永续 list USDT pairs only. An empty `query` returns the board: `sort=volume` by 24h turnover size, `sort=change` by 24h percent change descending. `limit` maxes at 20.

美股 requires a ticker and returns one name.

## After the numbers

When the user only asks for a price, give the numbers first, then one line: higher, lower, or near the open. When the user asks for analysis, 做多, 做空, or whether to 等待, use the next section.

Done: price, percent change, funding rate, and open interest in the reply match this turn's tool fields.

## Analysis

The stance is only 做多, 做空, or 等待. Fetch first, compare three spans, then write the stance.

1. For 现货 or 美股, call `market_quote`. For crypto, also call 永续 `market_quote`. `market_candles` takes 8 `1D` bars. For crypto, also take 6 `1H` bars. 美股 has no hourly bars; use the daily bar and the 24-hour window only.
Done: each comparison points at some candle's close, or at the quote's last and open.

2. The three spans compare magnitude only. Compute no other indicator. Higher is long, lower is short, equal is flat.
Daily: the close of the last finished candle versus the close five candles before it. If the last candle's `time` falls on today's Beijing midnight (UTC+8 00:00), that candle is unfinished; use the one before it.
24 hours: last versus open.
Hourly: the newest close versus the earliest close among these 6 bars.
Done: each span is written as long, short, or flat, with both numbers.

3. When daily, 24-hour, and hourly are all long, the stance is 做多. When all are short, the stance is 做空. When any span is opposite or flat, the stance is 等待. 美股 compares daily and 24 hours only; both must agree or the stance is 等待.
A positive 永续 `funding_rate` means longs pay shorts; a negative rate is the reverse. When the rate opposes the stance, still write the stance from the three spans and state the rate's direction. The rate does not change the stance by itself.
Done: the reply contains one of 做多、做空、等待.

4. When the user gives capital: quantity = capital / last. 1% of capital is the PnL when price moves 1%. When the stance is 做多 or 做空, write "direction is 做多" or "direction is 做空". Read capital as a spot quantity only. Do not convert capital into a leverage multiple.
Done: quantity and the 1% PnL both use this turn's last.

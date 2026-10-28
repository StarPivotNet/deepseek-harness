# dsh-chart

Registers `render_chart`. One call draws a chart by building an Apache ECharts option and calling `renderToSVGString` on the ECharts common build stored in `lib/vendor/echarts.cjs`. Nothing is loaded from outside the plugin. The chart background is transparent. The model sees a short summary. The chat row loads this bundled runtime and draws a live chart from `presentationMeta.option`, so tooltip, legend, and inside zoom work. An SVG copy is still written under the session workspace.

Kinds: `pie`, `bar`, `line`, `histogram`, `function`, `scatter`, `radar`, `funnel`, `gauge`, `heatmap`, `boxplot`, `candlestick`, `treemap`. `pie`, `bar`, `funnel`, and `treemap` take `labels` and `values`. `line` and `radar` take `labels` with `values`, or `series` of `{ name, values }`. `histogram` takes `samples`, or `edges` plus `counts`. `function` takes `expressions` in `x`, plus `x_min` and `x_max`. `scatter` takes `x` and `y`. `gauge` takes `value`. `heatmap` takes `labels`, `y_labels`, and `data` rows of `[xIndex, yIndex, value]`. `boxplot` takes `labels` and `data` rows of observations. `candlestick` takes `labels` and `data` rows of `[open, close, low, high]`.

Install it yourself:

```
dsh plugin --profile desktop add C:\Users\yuluk\.dsh\plugins\dsh-chart
```

Restart the desktop profile after adding it. Package manifests are cached in-process.

import assert from 'node:assert/strict'
import test from 'node:test'
import { histogramBins, renderChart } from '../lib/chart.js'
import { compileExpression } from '../lib/expr.js'

test('evaluates arithmetic, powers, and functions of x', () => {
  assert.equal(compileExpression('2+3*4')(0), 14)
  assert.equal(compileExpression('x^2')(3), 9)
  assert.equal(compileExpression('2^3^2')(0), 512)
  assert.ok(Math.abs(compileExpression('sin(pi/2)')(0) - 1) < 1e-12)
  assert.throws(() => compileExpression('alert(1)'), /unsupported function/)
})

test('draws a pie from shares and escapes the title', () => {
  const chart = renderChart({
    kind: 'pie',
    title: '爱好 <阅读>',
    labels: ['阅读', '运动', '音乐'],
    values: [30, 25, 45],
  })
  assert.match(chart.svg, /<path /)
  assert.match(chart.svg, /爱好 &lt;阅读&gt;/)
  assert.doesNotMatch(chart.svg, /<script/)
  assert.doesNotMatch(chart.svg, /#f7f4ee/)
  assert.match(chart.summary, /扇形图/)
})

test('draws separated bars and a connected line', () => {
  const bar = renderChart({ kind: 'bar', labels: ['一', '二'], values: [4, -2], y_label: '人数' })
  assert.match(bar.svg, /^<svg width="100%"/)
  assert.match(bar.svg, /人数/)
  const line = renderChart({
    kind: 'line',
    labels: ['一', '二', '三'],
    series: [{ name: '甲', values: [1, 3, 2] }, { name: '乙', values: [2, 2, 4] }],
  })
  assert.match(line.svg, /甲/)
  assert.match(line.svg, /乙/)
})

test('bins samples and keeps unequal histogram bins as density', () => {
  const samples = histogramBins({ samples: [1, 1, 2, 3, 5, 8, 13] })
  assert.equal(samples.edges.length, samples.counts.length + 1)
  assert.equal(samples.counts.reduce((sum, count) => sum + count, 0), 7)
  const density = histogramBins({ edges: [0, 10, 30], counts: [5, 10] })
  assert.equal(density.density, true)
  const chart = renderChart({ kind: 'histogram', edges: [0, 10, 30], counts: [5, 10], title: '成绩' })
  assert.match(chart.svg, /频数\/组距/)
  assert.match(chart.summary, /直方图/)
})

test('plots a function and a scatter of equal length', () => {
  const curve = renderChart({ kind: 'function', expressions: ['x^2', 'sin(x)'], x_min: -2, x_max: 2 })
  assert.match(curve.svg, /<path /)
  assert.match(curve.svg, /y = x\^2/)
  assert.match(curve.svg, />O</)
  assert.match(curve.summary, /y = x\^2/)
  assert.ok(curve.option.xAxis.min < 0 && curve.option.xAxis.max > 0)
  assert.ok(curve.option.yAxis.min < 0 && curve.option.yAxis.max > 0)
  assert.deepEqual(curve.option.xAxis.axisLine.symbol, ['none', 'arrow'])
  assert.deepEqual(curve.option.yAxis.axisLine.symbol, ['none', 'arrow'])
  assert.equal(curve.option.xAxis.axisLine.onZero, true)
  assert.equal(curve.option.yAxis.axisLine.onZero, true)
  assert.equal(curve.option.xAxis.min, -2)
  assert.equal(curve.option.xAxis.max, 2)
  const xs = curve.option.series[0].data.filter(Boolean).map((point) => point[0])
  assert.ok(Math.abs(Math.min(...xs) + 2) < 1e-9)
  assert.ok(Math.abs(Math.max(...xs) - 2) < 1e-9)
  const quadrant = renderChart({ kind: 'function', expressions: ['x^2'], x_min: 0, x_max: 2 })
  assert.equal(quadrant.option.xAxis.min, 0)
  assert.equal(quadrant.option.xAxis.max, 2)
  assert.ok(quadrant.option.yAxis.min < 0)
  const stated = renderChart({
    kind: 'function',
    expressions: ['63/x+37', '37'],
    x_min: -12,
    x_max: 12,
    y_min: -40,
    y_max: 120,
  })
  assert.equal(stated.option.xAxis.min, -12)
  assert.equal(stated.option.xAxis.max, 12)
  assert.equal(stated.option.yAxis.min, -40)
  assert.equal(stated.option.yAxis.max, 120)
  assert.ok(stated.option.series[0].data.some((point) => point === null))
  const auto = renderChart({ kind: 'function', expressions: ['63/x+37'] })
  assert.ok(auto.option.xAxis.min < 0 && auto.option.xAxis.max > 0)
  assert.ok(auto.option.yAxis.min < 0 && auto.option.yAxis.max > 37)
  assert.ok(auto.option.xAxis.max < 40)
  assert.ok(auto.option.yAxis.max < 200)
  const autoX = auto.option.series[0].data.filter(Boolean).map((point) => point[0])
  assert.ok(Math.abs(Math.min(...autoX) - auto.option.xAxis.min) < 1e-6)
  assert.ok(Math.abs(Math.max(...autoX) - auto.option.xAxis.max) < 1e-6)
  assert.throws(() => renderChart({ kind: 'function', expressions: ['nope'], x_min: 0, x_max: 1 }), /unsupported name/)
  const scatter = renderChart({ kind: 'scatter', x: [1, 2, 3], y: [2, 3, 5], x_label: '时间', y_label: '分数' })
  assert.match(scatter.svg, /^<svg width="100%"/)
  assert.match(scatter.svg, /时间/)
  assert.throws(() => renderChart({ kind: 'scatter', x: [1], y: [1, 2] }), /same length/)
})

test('draws the extra ECharts series from inside the plugin', () => {
  const charts = [
    renderChart({ kind: 'radar', labels: ['语文', '数学'], values: [80, 90] }),
    renderChart({ kind: 'funnel', labels: ['访问', '下单'], values: [100, 40] }),
    renderChart({ kind: 'gauge', value: 72, min: 0, max: 100 }),
    renderChart({ kind: 'heatmap', labels: ['一', '二'], y_labels: ['甲', '乙'], data: [[0, 0, 1], [1, 1, 4]] }),
    renderChart({ kind: 'boxplot', labels: ['甲', '乙'], data: [[1, 2, 3, 4], [2, 2, 5, 9]] }),
    renderChart({ kind: 'candlestick', labels: ['周一', '周二'], data: [[20, 34, 10, 38], [40, 35, 30, 50]] }),
    renderChart({ kind: 'treemap', labels: ['甲', '乙'], values: [10, 30] }),
  ]
  for (const chart of charts) {
    assert.match(chart.svg, /^<svg width="100%"/)
    assert.doesNotMatch(chart.svg, /<script/)
  }
  assert.match(charts[0].summary, /雷达图/)
  assert.match(charts[2].svg, /72/)
  assert.match(charts[3].summary, /热力图/)
  const histogram = renderChart({ kind: 'histogram', samples: [1, 2, 2, 3, 8] })
  assert.equal(typeof histogram.option.series[0].renderItem, 'undefined')
  assert.equal(histogram.option.series[0].type, 'custom')
  assert.equal(histogram.option.backgroundColor, 'transparent')
})

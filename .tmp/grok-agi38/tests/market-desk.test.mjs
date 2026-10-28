import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const HUB = join(PRESET_ROOT, 'skills', 'market-desk', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const TOOLS = join(PRESET_ROOT, 'market-tools.mjs')

function marketBlock(cordis) {
  const match = cordis.match(/- id: market-tools\n(?:  .*\n)*/ )
  assert.ok(match, 'agent.cordis.yml must contain id: market-tools')
  return match[0]
}

describe('market desk quotes OKX spot, OKX swap, and US stocks', () => {
  it('ships the skill and the read-only tool module', () => {
    const hub = readFileSync(HUB, 'utf8')
    const tools = readFileSync(TOOLS, 'utf8')
    assert.match(hub, /^---\r?\nname: market-desk\r?\n/)
    assert.match(hub, /market_quote/)
    assert.match(hub, /market_candles/)
    assert.match(hub, /market_search/)
    assert.match(hub, /funding_rate/)
    assert.match(hub, /Spot symbols do not include `-SWAP`/)
    assert.match(hub, /做多、做空、等待/)
    assert.equal(tools.includes('@deepseek-ai/dsh-tools'), false)
    assert.equal(tools.includes('defineTool'), false)
    assert.match(tools, /www\.okx\.com\/api\/v5/)
    assert.match(tools, /push2\.eastmoney\.com/)
  })

  it('is routed from using-superpowers and not named in the persona', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const persona = readFileSync(PERSONA, 'utf8')
    const block = marketBlock(persona)
    assert.match(superpowers, /OKX 现货, OKX 永续, or 美股 quotes and candles \| `market-desk`/)
    assert.match(block, /name: \.\/market-tools\.mjs/)
    assert.equal(/\bisolate\b/.test(block), false)
    assert.equal(persona.includes('market-desk'), false)
  })

  it('normalizes symbols and ranks the board without the network', async () => {
    const mod = await import(pathToFileURL(TOOLS).href)
    assert.equal(mod.normalizeSymbol('spot', 'btc'), 'BTC-USDT')
    assert.equal(mod.normalizeSymbol('spot', 'btcusdt'), 'BTC-USDT')
    assert.equal(mod.normalizeSymbol('swap', '比特币'), 'BTC-USDT-SWAP')
    assert.equal(mod.normalizeSymbol('us', 'usAAPL.OQ'), 'AAPL')
    assert.equal(mod.normalizeSymbol('us', 'USO'), 'USO')
    assert.equal(mod.normalizeSymbol('us', 'USB'), 'USB')
    assert.throws(() => mod.normalizeSymbol('spot', 'BTC-USDT-SWAP'))
    assert.equal(mod.okxBar('1h'), '1H')
    assert.equal(mod.usBar(''), '101')
    assert.throws(() => mod.usBar('1m'))
    const hits = mod.selectTickers([
      { symbol: 'ETH-USDT', base: 'ETH', name: 'ETH', last: 1, change_pct: 2, volume: 9 },
      { symbol: 'BTC-USDT', base: 'BTC', name: 'BTC', last: 3, change_pct: -1, volume: 4 },
      { symbol: 'BTC-USDC', base: 'BTC', name: 'BTC', last: 3, change_pct: 5, volume: 1 },
    ], { query: 'BTC', sort: 'volume', limit: 10 })
    assert.deepEqual(hits.map((hit) => hit.symbol), ['BTC-USDT', 'BTC-USDC'])
    const board = mod.selectTickers([
      { symbol: 'A-USDT', base: 'A', name: 'A', last: 1, change_pct: 1, volume: 5 },
      { symbol: 'B-USDT', base: 'B', name: 'B', last: 1, change_pct: 9, volume: 1 },
    ], { sort: 'change', limit: 1 })
    assert.equal(board[0].symbol, 'B-USDT')
    const swapBtc = mod.tickerRow({ instId: 'BTC-USDT-SWAP', last: '10', open24h: '10', volCcy24h: '100' }, 'swap')
    const swapAlt = mod.tickerRow({ instId: 'ALT-USDT-SWAP', last: '0.001', open24h: '0.001', volCcy24h: '999999' }, 'swap')
    const ranked = mod.selectTickers([swapAlt, swapBtc], { sort: 'volume', limit: 2 })
    assert.equal(swapBtc.volume, 1000)
    assert.equal(ranked[0].symbol, 'BTC-USDT-SWAP')
  })
})

/**
 * Public market tools for this preset. Read-only.
 *
 * OKX v5 public REST: spot and USDT-margined perpetual swap.
 * East Money: US stocks (NASDAQ 105, NYSE 106, AMEX 107).
 * No API key. No orders, balances, or wallets.
 *
 * Registration is ctx.tools.register of a plain definition.
 * output.schema must pass dsh-tools assertSupportedJsonSchema (single type
 * string, oneOf for null, additionalProperties boolean).
 */
export const name = 'market-tools'
export const inject = ['tools']

const OKX = 'https://www.okx.com/api/v5'
const EM_PUSH = 'https://push2.eastmoney.com'
const EM_HIS = 'https://push2his.eastmoney.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const ALIAS = {
  比特币: 'BTC',
  以太坊: 'ETH',
  泰达币: 'USDT',
  狗狗币: 'DOGE',
  瑞波币: 'XRP',
  艾达币: 'ADA',
  波场: 'TRX',
  莱特币: 'LTC',
  币安币: 'BNB',
  索尔: 'SOL',
}

const OKX_BARS = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '1H': '1H',
  '2h': '2H',
  '2H': '2H',
  '4h': '4H',
  '4H': '4H',
  '6h': '6H',
  '6H': '6H',
  '12h': '12H',
  '12H': '12H',
  '1d': '1D',
  '1D': '1D',
  '1w': '1W',
  '1W': '1W',
  '1M': '1M',
}

const US_BARS = { '1d': '101', '1D': '101', '1w': '102', '1W': '102', '1M': '103' }

const numOrNull = (value) => {
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) ? n : null
}

const clampInt = (value, fallback, min, max) => {
  const n = typeof value === 'number' ? value : parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

const nullable = (type) => ({ oneOf: [{ type }, { type: 'null' }] })

const objectSchema = (required, properties) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
})

const QUOTE_KEYS = [
  'venue', 'symbol', 'name', 'last', 'open', 'high', 'low',
  'change_amount', 'change_pct', 'base_volume', 'contract_volume', 'quote_volume',
  'funding_rate', 'next_funding_time', 'open_interest', 'open_interest_ccy',
  'ts', 'source', 'warning',
]

export const QUOTE_SCHEMA = objectSchema(QUOTE_KEYS, {
  venue: { type: 'string', enum: ['spot', 'swap', 'us'] },
  symbol: { type: 'string' },
  name: nullable('string'),
  last: { type: 'number' },
  open: nullable('number'),
  high: nullable('number'),
  low: nullable('number'),
  change_amount: nullable('number'),
  change_pct: nullable('number'),
  base_volume: nullable('number'),
  contract_volume: nullable('number'),
  quote_volume: nullable('number'),
  funding_rate: nullable('number'),
  next_funding_time: nullable('string'),
  open_interest: nullable('number'),
  open_interest_ccy: nullable('number'),
  ts: { type: 'string' },
  source: { type: 'string', enum: ['okx', 'eastmoney'] },
  warning: nullable('string'),
})

const CANDLE_KEYS = ['time', 'open', 'high', 'low', 'close', 'volume']

export const CANDLES_SCHEMA = objectSchema(
  ['venue', 'symbol', 'bar', 'source', 'candles'],
  {
    venue: { type: 'string', enum: ['spot', 'swap', 'us'] },
    symbol: { type: 'string' },
    bar: { type: 'string' },
    source: { type: 'string', enum: ['okx', 'eastmoney'] },
    candles: {
      type: 'array',
      items: objectSchema(CANDLE_KEYS, {
        time: { type: 'string' },
        open: { type: 'number' },
        high: { type: 'number' },
        low: { type: 'number' },
        close: { type: 'number' },
        volume: { type: 'number' },
      }),
    },
  },
)

export const SEARCH_SCHEMA = objectSchema(['venue', 'query', 'sort', 'hits'], {
  venue: { type: 'string', enum: ['spot', 'swap', 'us'] },
  query: { type: 'string' },
  sort: { type: 'string', enum: ['volume', 'change'] },
  hits: {
    type: 'array',
    items: objectSchema(
      ['symbol', 'name', 'last', 'change_pct', 'volume'],
      {
        symbol: { type: 'string' },
        name: nullable('string'),
        last: nullable('number'),
        change_pct: nullable('number'),
        volume: nullable('number'),
      },
    ),
  },
})

export function normalizeSymbol(venue, symbol) {
  if (venue !== 'spot' && venue !== 'swap' && venue !== 'us') {
    throw new Error('venue 只能是 spot、swap 或 us')
  }
  const raw = String(symbol ?? '').trim()
  if (raw === '') throw new Error('symbol 不能为空')
  if (venue === 'us') {
    let body = raw
    if (/^us[A-Z]/.test(body)) body = body.slice(2)
    const ticker = body.toUpperCase().split('.')[0]
    if (!/^[A-Z][A-Z0-9]{0,9}$/.test(ticker)) throw new Error(`无法识别的美股代码 ${raw}`)
    return ticker
  }
  let s = ALIAS[raw] ?? raw
  s = s.toUpperCase().replace(/^CR:/, '').replace(/\s+/g, '').replace(/\//g, '-').replace(/_/g, '-')
  if (venue === 'spot' && s.endsWith('-SWAP')) throw new Error('现货代码不要带 -SWAP')
  const swap = s.endsWith('-SWAP')
  const core = swap ? s.slice(0, -5) : s
  const dashed = core.includes('-') ? core : insertQuote(core)
  const instId = venue === 'swap' ? `${dashed}-SWAP` : dashed
  const pattern = venue === 'swap' ? /^[A-Z0-9]+-[A-Z0-9]+-SWAP$/ : /^[A-Z0-9]+-[A-Z0-9]+$/
  if (!pattern.test(instId)) throw new Error(`无法识别的 OKX 代码 ${raw}`)
  return instId
}

function insertQuote(core) {
  for (const quote of ['USDT', 'USDC']) {
    if (core.endsWith(quote) && core.length > quote.length) {
      return `${core.slice(0, -quote.length)}-${quote}`
    }
  }
  return `${core}-USDT`
}

export function okxBar(bar) {
  const key = bar == null || bar === '' ? '1H' : String(bar)
  const resolved = OKX_BARS[key]
  if (resolved == null) throw new Error('OKX K 线 bar 用 1m、5m、15m、1H、4H、1D、1W、1M')
  return resolved
}

export function usBar(bar) {
  const key = bar == null || bar === '' ? '1D' : String(bar)
  const resolved = US_BARS[key]
  if (resolved == null) throw new Error('美股 K 线只提供 1D、1W、1M')
  return resolved
}

export function selectTickers(rows, options = {}) {
  const query = String(options.query ?? '').trim().toUpperCase()
  const sort = options.sort === 'change' ? 'change' : 'volume'
  const limit = clampInt(options.limit, 10, 1, 20)
  let list = Array.isArray(rows) ? rows.filter((row) => row != null && typeof row.symbol === 'string') : []
  if (query !== '') {
    list = list.filter((row) => {
      const base = String(row.base ?? '')
      const name = String(row.name ?? '').toUpperCase()
      return base === query || row.symbol.includes(query) || name.includes(query)
    })
  }
  const volumeOf = (row) => (Number.isFinite(row.volume) ? row.volume : -1)
  const changeOf = (row) => (Number.isFinite(row.change_pct) ? row.change_pct : -Infinity)
  list.sort((left, right) => {
    if (query !== '') {
      const leftRank = left.base === query ? 0 : left.symbol.startsWith(query) ? 1 : 2
      const rightRank = right.base === query ? 0 : right.symbol.startsWith(query) ? 1 : 2
      if (leftRank !== rightRank) return leftRank - rightRank
    }
    if (sort === 'change') return changeOf(right) - changeOf(left)
    return volumeOf(right) - volumeOf(left)
  })
  return list.slice(0, limit).map((row) => ({
    symbol: row.symbol,
    name: typeof row.name === 'string' ? row.name : null,
    last: numOrNull(row.last),
    change_pct: numOrNull(row.change_pct),
    volume: numOrNull(row.volume),
  }))
}

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms)
  if (signal == null) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  return signal
}

async function getJson(url, signal, headers) {
  const response = await fetch(url, { headers, signal })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  return response.json()
}

async function okxJson(path, signal) {
  const json = await getJson(`${OKX}${path}`, signal, { accept: 'application/json', 'user-agent': UA })
  if (json != null && typeof json.code === 'string' && json.code !== '0') {
    throw new Error(`OKX ${json.code}: ${json.msg ?? ''}`)
  }
  return json
}

async function emJson(url, signal) {
  return getJson(url, signal, {
    accept: 'application/json, text/plain, */*',
    'user-agent': UA,
    referer: 'https://quote.eastmoney.com/',
  })
}

const SECID = new Map()

async function resolveSecid(ticker, signal) {
  if (SECID.has(ticker)) return SECID.get(ticker)
  let lastError = null
  for (const exchange of ['105', '106', '107']) {
    const secid = `${exchange}.${ticker}`
    try {
      const json = await emJson(`${EM_PUSH}/api/qt/stock/get?secid=${secid}&fields=f57,f58&invt=2&fltt=2`, signal)
      if (json?.data?.f57) {
        SECID.set(ticker, secid)
        return secid
      }
    } catch (error) {
      lastError = error
    }
  }
  if (lastError instanceof Error && (lastError.name === 'AbortError' || lastError.name === 'TimeoutError' || lastError.message.startsWith('HTTP '))) {
    throw lastError
  }
  throw new Error(`未找到美股 ${ticker}`)
}

function isoOrNull(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return null
  const date = new Date(n)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function blankQuote(venue, symbol, source) {
  return {
    venue,
    symbol,
    name: null,
    last: 0,
    open: null,
    high: null,
    low: null,
    change_amount: null,
    change_pct: null,
    base_volume: null,
    contract_volume: null,
    quote_volume: null,
    funding_rate: null,
    next_funding_time: null,
    open_interest: null,
    open_interest_ccy: null,
    ts: new Date().toISOString(),
    source,
    warning: null,
  }
}

export function tickerRow(item, venue) {
  const symbol = String(item.instId ?? '')
  const last = numOrNull(item.last)
  const open = numOrNull(item.open24h)
  const changePct = last != null && open != null && open !== 0 ? ((last - open) / open) * 100 : null
  const baseSize = numOrNull(item.volCcy24h)
  const quoteNotional = numOrNull(item.volCcyQuote24h)
  const volume = venue === 'swap'
    ? (quoteNotional != null ? quoteNotional : (baseSize != null && last != null ? baseSize * last : null))
    : baseSize
  return {
    symbol,
    base: symbol.split('-')[0] ?? '',
    name: symbol.split('-')[0] ?? '',
    last,
    change_pct: changePct,
    volume,
    venue,
  }
}

function okxQuoteFromTicker(item, venue, symbol) {
  const last = numOrNull(item.last)
  if (last == null) throw new Error(`OKX 没有 ${symbol} 的最新价`)
  const open = numOrNull(item.open24h)
  const quote = blankQuote(venue, symbol, 'okx')
  quote.name = symbol.split('-')[0] || null
  quote.last = last
  quote.open = open
  quote.high = numOrNull(item.high24h)
  quote.low = numOrNull(item.low24h)
  quote.change_amount = open == null ? null : last - open
  quote.change_pct = open != null && open !== 0 ? ((last - open) / open) * 100 : null
  quote.base_volume = venue === 'spot' ? numOrNull(item.vol24h) : numOrNull(item.volCcy24h)
  quote.contract_volume = venue === 'swap' ? numOrNull(item.vol24h) : null
  const baseSize = numOrNull(item.volCcy24h)
  const quoteNotional = numOrNull(item.volCcyQuote24h)
  quote.quote_volume = venue === 'spot'
    ? baseSize
    : (quoteNotional != null ? quoteNotional : (baseSize != null ? baseSize * last : null))
  quote.ts = isoOrNull(item.ts) ?? quote.ts
  return quote
}

export async function marketQuote(args, signal) {
  const venue = args?.venue
  const symbol = normalizeSymbol(venue, args?.symbol)
  if (venue === 'us') return usQuote(symbol, signal)
  const quote = okxQuoteFromTicker(
    (await okxJson(`/market/ticker?instId=${encodeURIComponent(symbol)}`, signal))?.data?.[0] ?? {},
    venue,
    symbol,
  )
  if (venue !== 'swap') return quote
  const warnings = []
  try {
    const row = (await okxJson(`/public/funding-rate?instId=${encodeURIComponent(symbol)}`, signal))?.data?.[0]
    quote.funding_rate = numOrNull(row?.fundingRate)
    quote.next_funding_time = isoOrNull(row?.nextFundingTime)
    if (quote.funding_rate == null) warnings.push('无资金费率')
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : '资金费率获取失败')
  }
  try {
    const row = (await okxJson(`/public/open-interest?instType=SWAP&instId=${encodeURIComponent(symbol)}`, signal))?.data?.[0]
    quote.open_interest = numOrNull(row?.oi)
    quote.open_interest_ccy = numOrNull(row?.oiCcy)
    if (quote.open_interest == null) warnings.push('无持仓量')
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : '持仓量获取失败')
  }
  quote.warning = warnings.length === 0 ? null : warnings.join('; ')
  return quote
}

async function usQuote(ticker, signal) {
  const secid = await resolveSecid(ticker, signal)
  const json = await emJson(
    `${EM_PUSH}/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170&invt=2&fltt=2`,
    signal,
  )
  const data = json?.data
  const last = numOrNull(data?.f43)
  if (last == null) throw new Error(`未找到美股 ${ticker}`)
  const quote = blankQuote('us', ticker, 'eastmoney')
  quote.name = typeof data.f58 === 'string' && data.f58 !== '' ? data.f58 : null
  quote.last = last
  quote.open = numOrNull(data.f46)
  quote.high = numOrNull(data.f44)
  quote.low = numOrNull(data.f45)
  quote.change_amount = numOrNull(data.f169)
  quote.change_pct = numOrNull(data.f170)
  quote.base_volume = numOrNull(data.f47)
  quote.quote_volume = numOrNull(data.f48)
  const prev = numOrNull(data.f60)
  if (quote.open == null) quote.open = prev
  return quote
}

export async function marketCandles(args, signal) {
  const venue = args?.venue
  const symbol = normalizeSymbol(venue, args?.symbol)
  const limit = clampInt(args?.limit, 30, 1, 100)
  if (venue === 'us') return usCandles(symbol, args?.bar, limit, signal)
  const bar = okxBar(args?.bar)
  const json = await okxJson(
    `/market/candles?instId=${encodeURIComponent(symbol)}&bar=${bar}&limit=${limit}`,
    signal,
  )
  const candles = (json?.data ?? [])
    .map((row) => ({
      time: isoOrNull(row?.[0]),
      open: numOrNull(row?.[1]),
      high: numOrNull(row?.[2]),
      low: numOrNull(row?.[3]),
      close: numOrNull(row?.[4]),
      volume: numOrNull(row?.[5]),
    }))
    .filter((candle) => candle.time != null && candle.open != null && candle.high != null && candle.low != null && candle.close != null && candle.volume != null)
    .sort((left, right) => left.time.localeCompare(right.time))
  if (candles.length === 0) throw new Error(`OKX 没有 ${symbol} ${bar} K 线`)
  return { venue, symbol, bar, source: 'okx', candles }
}

async function usCandles(ticker, barInput, limit, signal) {
  const bar = usBar(barInput)
  const label = bar === '101' ? '1D' : bar === '102' ? '1W' : '1M'
  const secid = await resolveSecid(ticker, signal)
  const json = await emJson(
    `${EM_HIS}/api/qt/stock/kline/get?secid=${secid}&klt=${bar}&fqt=1&lmt=${limit}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56`,
    signal,
  )
  const candles = (json?.data?.klines ?? [])
    .map((line) => {
      const cell = String(line).split(',')
      return {
        time: cell[0] ?? '',
        open: numOrNull(cell[1]),
        close: numOrNull(cell[2]),
        high: numOrNull(cell[3]),
        low: numOrNull(cell[4]),
        volume: numOrNull(cell[5]),
      }
    })
    .filter((candle) => /^\d{4}-\d{2}-\d{2}/.test(candle.time) && candle.open != null && candle.high != null && candle.low != null && candle.close != null && candle.volume != null)
  if (candles.length === 0) throw new Error(`未找到美股 ${ticker} K 线`)
  return { venue: 'us', symbol: ticker, bar: label, source: 'eastmoney', candles }
}

export async function marketSearch(args, signal) {
  const venue = args?.venue
  if (venue !== 'spot' && venue !== 'swap' && venue !== 'us') throw new Error('venue 只能是 spot、swap 或 us')
  const sort = args?.sort === 'change' ? 'change' : 'volume'
  const rawQuery = String(args?.query ?? '').trim()
  const query = ALIAS[rawQuery] ?? rawQuery
  if (venue === 'us') {
    if (query === '') throw new Error('美股搜索要给代码')
    const quote = await marketQuote({ venue: 'us', symbol: query }, signal)
    return {
      venue,
      query,
      sort,
      hits: [{
        symbol: quote.symbol,
        name: quote.name,
        last: quote.last,
        change_pct: quote.change_pct,
        volume: quote.quote_volume,
      }],
    }
  }
  const instType = venue === 'swap' ? 'SWAP' : 'SPOT'
  const json = await okxJson(`/market/tickers?instType=${instType}`, signal)
  const rows = (json?.data ?? [])
    .filter((item) => {
      const instId = String(item?.instId ?? '')
      return venue === 'swap' ? instId.endsWith('-USDT-SWAP') : instId.endsWith('-USDT') && !instId.includes('-SWAP')
    })
    .map((item) => tickerRow(item, venue))
  return { venue, query, sort, hits: selectTickers(rows, { query, sort, limit: args?.limit }) }
}

function renderQuote(_args, value) {
  const lines = [
    `${value.venue} ${value.symbol} ${value.name ?? ''}`.trim(),
    `last ${value.last} open ${value.open} high ${value.high} low ${value.low}`,
    `change_amount ${value.change_amount} change_pct ${value.change_pct}`,
    `base_volume ${value.base_volume} contract_volume ${value.contract_volume} quote_volume ${value.quote_volume}`,
    `funding_rate ${value.funding_rate} next_funding_time ${value.next_funding_time}`,
    `open_interest ${value.open_interest} open_interest_ccy ${value.open_interest_ccy}`,
    `ts ${value.ts} source ${value.source}`,
  ]
  if (value.warning) lines.push(`warning ${value.warning}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

function renderCandles(_args, value) {
  const last = value.candles[value.candles.length - 1]
  const text = [
    `${value.venue} ${value.symbol} ${value.bar} ${value.candles.length} source ${value.source}`,
    `oldest ${value.candles[0]?.time} newest ${last?.time} close ${last?.close}`,
    JSON.stringify(value.candles),
  ].join('\n')
  return [{ type: 'text', text }]
}

function renderSearch(_args, value) {
  const lines = [`${value.venue} query ${value.query || '(none)'} sort ${value.sort} ${value.hits.length}`]
  for (const hit of value.hits) {
    lines.push(`${hit.symbol} ${hit.name ?? ''} last ${hit.last} change_pct ${hit.change_pct} volume ${hit.volume}`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

const parameters = (required, properties) => objectSchema(required, properties)

const TOOLS = [
  {
    name: 'market_quote',
    timeoutMs: 20000,
    description: 'Public quote. venue spot is OKX spot (BTC or BTC-USDT). venue swap is OKX USDT perpetual (BTC or BTC-USDT-SWAP) and also returns funding_rate and open_interest. venue us is a US stock (AAPL). Read-only, no API key.',
    parameters: parameters(['venue', 'symbol'], {
      venue: { type: 'string', enum: ['spot', 'swap', 'us'], description: 'spot=OKX现货, swap=OKX永续, us=美股' },
      symbol: { type: 'string', description: 'BTC, BTC-USDT, BTC-USDT-SWAP, 比特币, AAPL, or usAAPL' },
    }),
    output: { schema: QUOTE_SCHEMA, render: renderQuote },
    async execute(args, exec) {
      return marketQuote(args ?? {}, withTimeout(exec?.signal, 18000))
    },
    presentCall(args) {
      const symbol = args != null && typeof args.symbol === 'string' ? args.symbol : 'market_quote'
      return { card: 'generic', title: 'market_quote', kind: 'other', content: [{ type: 'text', text: symbol }] }
    },
  },
  {
    name: 'market_candles',
    timeoutMs: 20000,
    description: 'Public OHLCV candles, oldest first. OKX bar: 1m 5m 15m 1H 4H 1D 1W 1M (default 1H). US stock bar: 1D 1W 1M (default 1D, forward-adjusted). limit 1-100, default 30. Read-only.',
    parameters: parameters(['venue', 'symbol'], {
      venue: { type: 'string', enum: ['spot', 'swap', 'us'], description: 'spot=OKX现货, swap=OKX永续, us=美股' },
      symbol: { type: 'string', description: 'BTC, BTC-USDT-SWAP, or AAPL' },
      bar: { type: 'string', description: 'OKX: 1m 5m 15m 1H 4H 1D 1W 1M. US: 1D 1W 1M.' },
      limit: { type: 'integer', description: '1-100, default 30' },
    }),
    output: { schema: CANDLES_SCHEMA, render: renderCandles },
    async execute(args, exec) {
      return marketCandles(args ?? {}, withTimeout(exec?.signal, 18000))
    },
    presentCall(args) {
      const symbol = args != null && typeof args.symbol === 'string' ? args.symbol : 'market_candles'
      return { card: 'generic', title: 'market_candles', kind: 'other', content: [{ type: 'text', text: symbol }] }
    },
  },
  {
    name: 'market_search',
    timeoutMs: 25000,
    description: 'Search OKX USDT spot or USDT perpetual tickers, or resolve one US ticker. Empty query on spot or swap returns the board (default sort volume, or sort change for 24h percent). limit 1-20, default 10. US requires a ticker. Read-only.',
    parameters: parameters(['venue'], {
      venue: { type: 'string', enum: ['spot', 'swap', 'us'], description: 'spot=OKX现货, swap=OKX永续, us=美股' },
      query: { type: 'string', description: 'BTC, 比特币, or AAPL. Empty lists the OKX USDT board.' },
      sort: { type: 'string', enum: ['volume', 'change'], description: 'volume=24h quote/base size, change=24h percent descending' },
      limit: { type: 'integer', description: '1-20, default 10' },
    }),
    output: { schema: SEARCH_SCHEMA, render: renderSearch },
    async execute(args, exec) {
      return marketSearch(args ?? {}, withTimeout(exec?.signal, 22000))
    },
    presentCall(args) {
      const query = args != null && typeof args.query === 'string' ? args.query : 'market_search'
      return { card: 'generic', title: 'market_search', kind: 'other', content: [{ type: 'text', text: query }] }
    },
  },
]

export function apply(ctx) {
  for (const definition of TOOLS) ctx.tools.register(definition)
}

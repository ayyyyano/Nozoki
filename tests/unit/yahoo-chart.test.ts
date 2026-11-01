import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { yahooChart, yahooDecimal } from '../../server/adapters/quotes/yahoo-chart.ts'
import { quoteProviders } from '../../server/adapters/quotes/index.ts'
import { yahooSymbol, yahooChartEndpoint } from '../../shared/quotes/yahoo-symbol.ts'
import {
  productionTransport,
  responseTransport,
  serviceEndpoint,
} from '../../server/adapters/transport.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { collectionPlans } from '../../server/collection/plans.ts'
import { DataSchemas } from '../../shared/contracts/snapshots.ts'
import { createDefaultConfig, DecimalSchema } from '../../shared/contracts/config.ts'
import { source } from '../fixtures/adapters.ts'
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/yahoo-chart.json', import.meta.url), 'utf8'),
)
const symbols = [
  { market: 'US', symbol: 'QQQM' },
  { market: 'US', symbol: 'VOO' },
]
const s = { ...source('quotes-custom'), id: 'yahoo', baseUrl: 'https://query1.finance.yahoo.com/' }
const now = new Date('2026-10-31T16:00:00.000Z')
const environment = {
  NOZOKI_PUBLIC_ROUTES: JSON.stringify([
    {
      id: s.id,
      provider: s.provider,
      protocolVersion: s.protocolVersion,
      baseUrl: s.baseUrl,
      authentication: 'none',
    },
  ]),
}
function transport(values: Record<string, unknown> = fixture.responses, quoteSymbols = symbols) {
  return responseTransport(
    s,
    async (endpoint) =>
      Response.json(values[decodeURIComponent(endpoint.split('/').at(-1)!.split('?')[0]!)]),
    { quoteSymbols },
  )
}

test('live-captured Yahoo responses normalize strict quotes, history, UTC and provider source identity', async () => {
  assert.equal(quoteProviders.get('yahoo-chart-v8'), yahooChart)
  assert.match(yahooChart.licenseReference, /Unofficial.*no public license/)
  assert.equal(yahooChart.publicDisplay, false)
  const result = await runAdapter({ source: s, transport: transport(), quoteSymbols: symbols, now })
  assert.equal(result.code, undefined)
  assert.equal(result.status, 'stale')
  const data = DataSchemas.quotes.parse(result.views.quotes!.data)
  assert.equal(data.items.length, 2)
  const quote = data.items[0]!,
    meta = fixture.responses.QQQM.chart.result[0].meta
  assert.equal(quote.price, '284.34')
  assert.equal(quote.previousClose, '294.53')
  assert.equal(quote.change, '-10.19')
  assert.equal(quote.changePercent, '-3.4597')
  assert.equal(quote.currency, 'USD')
  assert.equal(quote.provider, s.id)
  assert.equal(quote.name, meta.shortName)
  assert.equal(quote.volume, String(meta.regularMarketVolume))
  assert.equal(quote.history.length, 5)
  assert.equal(quote.history[0]!.close, '293.26')
  assert.equal(quote.asOf, new Date(meta.regularMarketTime * 1000).toISOString())
  assert.notEqual(
    quote.asOf,
    new Date((meta.regularMarketTime + meta.gmtoffset) * 1000).toISOString(),
  )
  assert.equal(result.observedAt, quote.asOf)
})

test('fixed decimals preserve explicit zero, tiny and large values without exponent notation', () => {
  for (const [input, expected] of [
    [284.3399963378906, '284.34'],
    [0, '0'],
    [-0, '0'],
    [1e21, '1000000000000000000000'],
    [1e-7, '0.0000001'],
    [-1e-7, '-0.0000001'],
  ] as const) {
    assert.equal(yahooDecimal(input), expected)
    assert.ok(DecimalSchema.safeParse(yahooDecimal(input)).success)
  }
  for (const bad of [Infinity, NaN, 1e308, Number.MIN_VALUE])
    assert.throws(() => yahooDecimal(bad), { code: 'INVALID_RESPONSE' })
})

test('US, Shanghai, Shenzhen and Hong Kong symbols use bounded market-specific paths', () => {
  for (const [market, symbol, expected] of [
    ['US', 'QQQM', 'QQQM'],
    ['CN', '600519', '600519.SS'],
    ['CN', '600519.SS', '600519.SS'],
    ['CN', '000001', '000001.SZ'],
    ['HK', '0700.HK', '0700.HK'],
    ['HK', '700', '0700.HK'],
  ])
    assert.equal(yahooSymbol({ market: market!, symbol: symbol! }), expected)
  for (const symbol of [
    '../QQQM',
    'QQQM?url=x',
    'QQQM/VOO',
    'QQQM,VOO',
    '%2f',
    'https://evil.example.com',
    '',
  ])
    assert.throws(() => yahooSymbol({ market: 'US', symbol }))
  assert.throws(() => yahooSymbol({ market: 'UNKNOWN', symbol: 'QQQM' }))
  assert.throws(() => yahooSymbol({ market: 'SH', symbol: '000001.SZ' }))
})

test('transport only allows the selected tickers and fixed chart query; a third ticker is permitted', async () => {
  const inputs = [...symbols, { market: 'CN', symbol: '600519.SS' }],
    paths: string[] = []
  const wire = productionTransport(s, 'MUST-NOT-BE-SENT', {
    environment,
    quoteSymbols: inputs,
    fetch: async (url, init) => {
      paths.push(String(url))
      assert.equal(init?.method, 'GET')
      assert.equal(init?.redirect, 'manual')
      assert.equal(init?.credentials, 'omit')
      assert.deepEqual([...new Headers(init?.headers).keys()], ['accept'])
      const symbol = new URL(String(url)).pathname.split('/').at(-1)!,
        value = structuredClone(fixture.responses.QQQM)
      value.chart.result[0].meta.symbol = symbol
      return Response.json(value)
    },
  })
  const quotes = await yahooChart.read(inputs, wire)
  assert.equal(quotes.length, 3)
  assert.equal(paths.length, 3)
  assert.equal(
    paths[2],
    'https://query1.finance.yahoo.com/v8/finance/chart/600519.SS?range=5d&interval=1d',
  )
  for (const endpoint of [
    'v8/finance/chart/MSFT?range=5d&interval=1d',
    'v8/finance/chart/QQQM?range=1y&interval=1d',
    'v8/finance/chart/QQQM?range=5d&interval=1d&url=http://localhost/',
    'v8/finance/chart/../api/meta',
    'v8/finance/chart/QQQM%2fVOO?range=5d&interval=1d',
  ])
    await assert.rejects(wire.get(endpoint), { code: 'TARGET_NOT_APPROVED' })
  assert.equal(paths.length, 3)
  assert.throws(() => serviceEndpoint(s.baseUrl, 'v8/finance/chart/QQQM?range=5d&interval=1h'), {
    code: 'TARGET_NOT_APPROVED',
  })
  await assert.rejects(wire.get(yahooChartEndpoint(inputs[0]!)), { code: 'REQUEST_BUDGET' })
})

test('symbols sharing the same Yahoo identity reuse the response and probe reads one selected symbol', async () => {
  const inputs = [symbols[0]!, { market: 'NASDAQ', symbol: 'QQQM' }]
  let calls = 0
  const wire = responseTransport(
    s,
    async () => {
      calls++
      return Response.json(fixture.responses.QQQM)
    },
    { quoteSymbols: inputs },
  )
  assert.equal((await yahooChart.read(inputs, wire)).length, 2)
  assert.equal(calls, 1)
  const probe = await runAdapter(
    {
      source: s,
      quoteSymbols: symbols,
      now,
      transport: responseTransport(
        s,
        async () => {
          calls++
          return Response.json(fixture.responses.QQQM)
        },
        { quoteSymbols: symbols },
      ),
    },
    'probe',
  )
  assert.equal(probe.items, 1)
  assert.equal(calls, 2)
})

test('chart errors, missing fields, type errors, response statuses and invalid JSON fail safely', async () => {
  const failures: unknown[] = [
    {
      chart: {
        result: null,
        error: { code: 'Not Found', description: 'private upstream diagnostic' },
      },
    },
  ]
  for (const mutate of [
    (v: any) => delete v.chart.result[0].meta.regularMarketPrice,
    (v: any) => (v.chart.result[0].meta.regularMarketPrice = '284'),
    (v: any) => (v.chart.result[0].meta.symbol = 'OTHER'),
    (v: any) => v.chart.result[0].timestamp.pop(),
    (v: any) => (v.chart.result[0].indicators.quote[0].close[0] = 'bad'),
    (v: any) => (v.chart.result[0].meta.regularMarketDayLow = 9999),
  ]) {
    const value = structuredClone(fixture.responses.QQQM)
    mutate(value)
    failures.push(value)
  }
  for (const value of failures)
    await assert.rejects(yahooChart.read(symbols.slice(0, 1), transport({ QQQM: value })))
  for (const [status, code] of [
    [404, 'NOT_FOUND'],
    [401, 'AUTH_REQUIRED'],
    [429, 'RATE_LIMITED'],
    [503, 'UPSTREAM_UNAVAILABLE'],
  ] as const) {
    const wire = responseTransport(s, async () => new Response('private body', { status }), {
      quoteSymbols: symbols,
    })
    await assert.rejects(yahooChart.read(symbols, wire), { code })
  }
  const invalid = responseTransport(
    s,
    async () => new Response('not json', { headers: { 'content-type': 'application/json' } }),
    { quoteSymbols: symbols },
  )
  await assert.rejects(yahooChart.read(symbols, invalid), { code: 'INVALID_RESPONSE' })
})

test('null history points are skipped and absent optional fields stay unknown', async () => {
  const value = structuredClone(fixture.responses.QQQM),
    meta = value.chart.result[0].meta
  value.chart.result[0].indicators.quote[0].close[0] = null
  delete meta.regularMarketVolume
  delete meta.chartPreviousClose
  delete meta.regularMarketChangePercent
  delete meta.regularMarketDayHigh
  delete meta.regularMarketDayLow
  const [q] = await yahooChart.read(symbols.slice(0, 1), transport({ QQQM: value }))
  assert.equal(q!.history.length, 4)
  assert.equal(q!.volume, null)
  assert.equal(q!.amplitudePercent, null)
  assert.equal(q!.delayedMinutes, null)
})

test('daily changes require a reliable prior session close; range baselines and gaps are not yesterday', async () => {
  const read = async (change: (result: any) => void) => {
    const value = structuredClone(fixture.responses.QQQM)
    change(value.chart.result[0])
    return (await yahooChart.read(symbols.slice(0, 1), transport({ QQQM: value })))[0]!
  }
  const missing = await read((r) => {
    r.indicators.quote[0].close[3] = null
  })
  assert.equal(missing.previousClose, null)
  assert.equal(missing.change, null)
  assert.equal(missing.changePercent, null)
  const explicit = await read((r) => {
    r.meta.previousClose = 280
  })
  assert.equal(explicit.previousClose, '280')
  assert.equal(explicit.change, '4.34')
  assert.equal(explicit.changePercent, '1.55')
  const noZone = await read((r) => {
    delete r.meta.exchangeTimezoneName
    delete r.meta.gmtoffset
  })
  assert.equal(noZone.previousClose, null)
  const offset = await read((r) => {
    delete r.meta.exchangeTimezoneName
  })
  assert.equal(offset.previousClose, '294.53')
  const zero = await read((r) => {
    r.meta.previousClose = 0
  })
  assert.equal(zero.previousClose, '0')
  assert.equal(zero.changePercent, null)
})

test('every quote time is validated even if an earlier symbol is stale; abort sends no request', async () => {
  const value = structuredClone(fixture.responses.VOO)
  value.chart.result[0].meta.regularMarketTime = now.getTime() / 1000 + 100
  const result = await runAdapter({
    source: s,
    quoteSymbols: symbols,
    now,
    transport: transport({ ...fixture.responses, VOO: value }),
  })
  assert.equal(result.code, 'INVALID_RESPONSE')
  assert.deepEqual(result.views, {})
  const c = new AbortController()
  c.abort()
  let calls = 0
  await assert.rejects(
    yahooChart.read(
      symbols,
      {
        get: async () => {
          calls++
          return { value: null, ageSeconds: 0 }
        },
      },
      c.signal,
    ),
    { code: 'ABORTED' },
  )
  assert.equal(calls, 0)
})

test('quote collection plans only include enabled tickers bound to the same source and an enabled quotes module', () => {
  const config = createDefaultConfig()
  config.integrations = [s]
  config.quotes.forEach((q) => (q.provider = s.id))
  const module = config.modules.find((m) => m.id === 'quotes')!
  module.sources.main = { sourceId: s.id, subject: 'default' }
  const state = {
    config,
    integrations: [{ settings: s, envelope: null, revision: 'generation:1' }],
    snapshots: [],
  }
  assert.equal(collectionPlans(state)[0]!.quoteSymbols!.length, 2)
  config.quotes[1]!.enabled = false
  assert.equal(collectionPlans(state)[0]!.quoteSymbols!.length, 1)
  config.quotes[0]!.provider = null
  assert.equal(collectionPlans(state).length, 0)
  config.quotes[0]!.provider = s.id
  module.enabled = false
  assert.equal(collectionPlans(state).length, 0)
})

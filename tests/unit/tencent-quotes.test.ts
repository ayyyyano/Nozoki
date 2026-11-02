import test from 'node:test'
import assert from 'node:assert/strict'
import { tencentQuotes } from '../../server/adapters/quotes/tencent.ts'
import { quoteProviders } from '../../server/adapters/quotes/index.ts'
import { tencentChartEndpoint, tencentSymbol } from '../../shared/quotes/tencent-symbol.ts'
import { createTencentSource, createYahooSource } from '../../shared/quotes/defaults.ts'
import {
  productionTransport,
  responseTransport,
  serviceEndpoint,
} from '../../server/adapters/transport.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { tencentFixtures } from '../fixtures/tencent-quotes.ts'
import { DataSchemas } from '../../shared/contracts/snapshots.ts'

const symbols = [
  { market: 'US', symbol: 'QQQM' },
  { market: 'US', symbol: 'VOO' },
]
const source = createTencentSource()
function transport(values = tencentFixtures) {
  return responseTransport(
    source,
    async (endpoint) =>
      new Response(JSON.stringify(values[endpoint.split('=us')[1]!.split(',')[0]!]), {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      }),
    { quoteSymbols: symbols },
  )
}
test('Tencent observed fixtures produce quotes and five adjusted daily buckets in the existing DTO', async () => {
  assert.equal(quoteProviders.get('tencent-us-v1'), tencentQuotes)
  assert.equal(tencentQuotes.publicDisplay, false)
  const result = await runAdapter({
    source,
    transport: transport(),
    quoteSymbols: symbols,
    now: new Date('2026-10-30T20:05:00.000Z'),
  })
  assert.equal(result.code, undefined)
  assert.equal(result.status, 'ok')
  const items = DataSchemas.quotes.parse(result.views.quotes!.data).items
  assert.deepEqual(
    items.map((q) => [q.price, q.previousClose, q.change, q.changePercent, q.volume]),
    [
      ['284.34', '294.53', '-10.19', '-3.4597', '8519116'],
      ['694.81', '707.32', '-12.51', '-1.7686', '9983836'],
    ],
  )
  assert.equal(items[0]!.asOf, '2026-10-30T20:00:02.000Z')
  assert.equal(items[1]!.asOf, '2026-10-30T20:00:01.000Z')
  assert.ok(
    items.every(
      (q) => q.provider === 'tencent' && q.history.length === 5 && q.delayedMinutes === null,
    ),
  )
  assert.equal(items[0]!.history[0]!.at, '2026-10-26T04:00:00.000Z')
  const stale = await runAdapter({
    source,
    transport: transport(),
    quoteSymbols: symbols,
    now: new Date('2026-11-02T05:00:00.000Z'),
  })
  assert.equal(stale.status, 'stale')
  assert.equal(stale.observedAt, '2026-10-30T20:00:01.000Z')
})
test('Tencent transport sends no credential or Cookie and limits paths to configured symbols', async () => {
  let calls = 0
  const wire = productionTransport(source, 'MUST_NOT_BE_SENT', {
    quoteSymbols: symbols,
    fetch: async (url, init) => {
      calls++
      assert.equal(new URL(String(url)).origin, 'https://web.ifzq.gtimg.cn')
      assert.equal(init?.redirect, 'manual')
      assert.equal(init?.credentials, 'omit')
      assert.equal(new Headers(init?.headers).get('authorization'), null)
      assert.equal(new Headers(init?.headers).get('cookie'), null)
      return new Response(JSON.stringify(tencentFixtures['QQQM.OQ']), {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      })
    },
  })
  await wire.get(tencentChartEndpoint(symbols[0]!))
  for (const endpoint of [
    'appstock/app/usfqkline/get?param=usAAPL.OQ,day,,,5,qfq',
    'appstock/app/usfqkline/get?param=usQQQM.OQ,day,,,5,qfq&callback=evil',
    '../appstock/app/usfqkline/get?param=usQQQM.OQ,day,,,5,qfq',
    'appstock/app/usfqkline/get?param=usQQQM.OQ,day,,,5000,qfq',
  ])
    await assert.rejects(wire.get(endpoint), { code: 'TARGET_NOT_APPROVED' })
  assert.equal(calls, 1)
  assert.throws(() => serviceEndpoint(source.baseUrl!, 'appstock/%2e%2e/evil'), {
    code: 'TARGET_NOT_APPROVED',
  })
  assert.throws(
    () => productionTransport({ ...source, baseUrl: 'https://evil.invalid/' }, undefined),
    { code: 'TARGET_NOT_APPROVED' },
  )
  assert.equal(tencentSymbol(symbols[0]!), 'usQQQM.OQ')
  for (const input of [
    { market: 'US', symbol: 'AAPL' },
    { market: 'CN', symbol: 'QQQM' },
    { market: 'US', symbol: 'QQQM.OQ/evil' },
  ])
    assert.throws(() => tencentSymbol(input))
})
test('Tencent MIME exception still rejects HTML, JSONP, GBK, malformed JSON and HTTP errors', async () => {
  for (const [body, type] of [
    ['<html>blocked</html>', 'text/html; charset=UTF-8'],
    ['callback({})', 'text/html; charset=UTF-8'],
    ['{}', 'text/html; charset=GBK'],
  ]) {
    const wire = responseTransport(
      source,
      async () => new Response(body, { headers: { 'Content-Type': type! } }),
      { quoteSymbols: symbols },
    )
    await assert.rejects(wire.get(tencentChartEndpoint(symbols[0]!)), { code: 'INVALID_RESPONSE' })
  }
  for (const [status, code] of [
    [401, 'AUTH_REQUIRED'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [503, 'UPSTREAM_UNAVAILABLE'],
    [302, 'REDIRECT_REJECTED'],
  ] as const) {
    const wire = responseTransport(
      source,
      async () => new Response('private upstream body', { status }),
      { quoteSymbols: symbols },
    )
    await assert.rejects(wire.get(tencentChartEndpoint(symbols[0]!)), { code })
  }
  const yahoo = createYahooSource()
  const wire = responseTransport(
    yahoo,
    async () => new Response('{}', { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }),
    { quoteSymbols: symbols },
  )
  await assert.rejects(wire.get('v8/finance/chart/QQQM?range=5d&interval=1d'), {
    code: 'INVALID_RESPONSE',
  })
})
test('Tencent missing fields, business errors, wrong identities and invalid times fail without partial views', async () => {
  const altered = () => structuredClone(tencentFixtures) as Record<string, any>
  const mutations = [
    (v: any) => {
      v.code = 1
    },
    (v: any) => {
      delete v.data['usQQQM.OQ']
    },
    (v: any) => {
      v.data['usQQQM.OQ'].qt['usQQQM.OQ'][2] = 'VOO.AM'
    },
    (v: any) => {
      v.data['usQQQM.OQ'].qt['usQQQM.OQ'][3] = '1e3'
    },
    (v: any) => {
      v.data['usQQQM.OQ'].qt['usQQQM.OQ'][6] = '-1'
    },
    (v: any) => {
      v.data['usQQQM.OQ'].qt['usQQQM.OQ'][30] = '2026-02-30 16:00:00'
    },
    (v: any) => {
      v.data['usQQQM.OQ'].qt['usQQQM.OQ'][30] = '2026-11-01 01:30:00'
    },
    (v: any) => {
      v.data['usQQQM.OQ'].qfqday.reverse()
    },
    (v: any) => {
      v.data['usQQQM.OQ'].qfqday[0][2] = null
    },
  ]
  for (const mutate of mutations) {
    const values = altered()
    mutate(values['QQQM.OQ'])
    const result = await runAdapter({
      source,
      transport: transport(values),
      quoteSymbols: symbols,
      now: new Date('2026-11-02T05:00:00.000Z'),
    })
    assert.ok(result.code)
    assert.deepEqual(result.views, {})
  }
})
test('Tencent handles zero values, absent history, DST and duplicate symbols without extra requests', async () => {
  const values = structuredClone(tencentFixtures) as Record<string, any>
  const v = values['QQQM.OQ'].data['usQQQM.OQ']
  delete v.qfqday
  Object.assign(v.qt['usQQQM.OQ'], { 3: '0', 4: '0', 6: '0', 30: '2026-11-02 16:00:00' })
  let calls = 0
  const wire = responseTransport(
    source,
    async () => {
      calls++
      return Response.json(values['QQQM.OQ'])
    },
    { quoteSymbols: [symbols[0]!] },
  )
  const items = await tencentQuotes.read([symbols[0]!, symbols[0]!], wire)
  assert.equal(calls, 1)
  assert.equal(items[0]!.price, '0')
  assert.equal(items[0]!.volume, '0')
  assert.equal(items[0]!.changePercent, null)
  assert.equal(items[0]!.asOf, '2026-11-02T21:00:00.000Z')
  assert.deepEqual(items[0]!.history, [])
  await assert.rejects(tencentQuotes.read(symbols, transport(), AbortSignal.abort()), {
    code: 'ABORTED',
  })
})

import { z } from 'zod'
import { Temporal } from '@js-temporal/polyfill'
import type { Quote } from '../../../shared/contracts/dashboard.ts'
import { DecimalSchema } from '../../../shared/contracts/config.ts'
import { decimalDifference } from '../../../shared/domain/decimal.ts'
import { tencentSymbol, tencentChartEndpoint } from '../../../shared/quotes/tencent-symbol.ts'
import { cap, parse } from '../common.ts'
import { AdapterError, type ReadTransport } from '../types.ts'
import type { QuoteProvider } from './index.ts'
import type { QuoteSymbolInput } from '../../../shared/quotes/yahoo-symbol.ts'

const Chart = z.object({
  code: z.number().int(),
  data: z.record(z.string().max(64), z.unknown()).optional(),
})
const Series = z.object({
  qt: z.record(z.string().max(64), z.unknown()),
  qfqday: z
    .array(z.array(z.string().max(100)).min(6).max(20))
    .max(500)
    .optional(),
})
const QuoteFields = z.array(z.string().max(500)).min(36).max(100)
function decimal(value: string, nonnegative = true): string {
  if (
    !DecimalSchema.safeParse(value).success ||
    value.length > 96 ||
    (nonnegative && value.startsWith('-'))
  )
    throw new AdapterError('INVALID_RESPONSE')
  return value
}
function tradingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AdapterError('INVALID_RESPONSE')
  const date = Temporal.PlainDate.from(value)
  if (date.toString() !== value) throw new AdapterError('INVALID_RESPONSE')
  return date
}
function timestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))
    throw new AdapterError('INVALID_RESPONSE')
  return Temporal.PlainDateTime.from(value.replace(' ', 'T'))
    .toZonedDateTime('America/New_York', { disambiguation: 'reject' })
    .toInstant()
    .toString({ fractionalSecondDigits: 3 })
}
function ratio(value: string, base: string): string | null {
  const denominator = Number(base)
  return denominator > 0
    ? decimal(String(Number(((Number(value) / denominator) * 100).toFixed(4))), false)
    : null
}
export function normalizeTencentQuote(input: QuoteSymbolInput, value: unknown): Quote {
  const code = tencentSymbol(input),
    payload = parse(Chart, value)
  if (payload.code !== 0) throw new AdapterError('UPSTREAM_UNAVAILABLE')
  const series = parse(Series, payload.data?.[code]),
    fields = parse(QuoteFields, series.qt[code])
  if (fields[2] !== code.slice(2) || !['delay', '200', 'real'].includes(fields[0]!))
    throw new AdapterError('INVALID_RESPONSE')
  const price = decimal(fields[3]!),
    previousClose = decimal(fields[4]!),
    high = decimal(fields[33]!),
    low = decimal(fields[34]!),
    volume = decimal(fields[6]!),
    asOf = timestamp(fields[30]!)
  if (Number(low) > Number(high) || !/^\d+$/.test(volume) || !/^[A-Z]{3}$/.test(fields[35]!))
    throw new AdapterError('INVALID_RESPONSE')
  const date = fields[30]!.slice(0, 10),
    change = decimalDifference(price, previousClose)
  let previousDay = ''
  const history = (series.qfqday ?? []).map((row) => {
    const day = row[0]!,
      localDate = tradingDate(day)
    if (day <= previousDay || day > date) throw new AdapterError('INVALID_RESPONSE')
    previousDay = day
    // A daily bar's date is a bucket boundary, not a fabricated last-trade/closing instant.
    const at = localDate
      .toZonedDateTime('America/New_York')
      .toInstant()
      .toString({ fractionalSecondDigits: 3 })
    return { at, close: decimal(row[2]!) }
  })
  return {
    market: input.market,
    symbol: input.symbol,
    provider: 'tencent-us-v1',
    name: fields[1] || input.symbol,
    currency: fields[35]!,
    price,
    previousClose,
    change,
    changePercent: ratio(change, previousClose),
    amplitudePercent: ratio(decimalDifference(high, low), previousClose),
    volume,
    volumeUnit: 'shares',
    asOf,
    delayedMinutes: null,
    history,
    capabilities: { quote: cap(true, true), history: cap(history.length > 0, history.length > 0) },
  }
}
export const tencentQuotes: QuoteProvider = {
  id: 'tencent-us-v1',
  licenseReference:
    'Unofficial Tencent Finance US quote endpoint; public display rights unconfirmed',
  publicDisplay: false,
  capabilities: { quote: cap(true, true) },
  async read(symbols: readonly QuoteSymbolInput[], transport: ReadTransport, signal?: AbortSignal) {
    if (!symbols.length) throw new AdapterError('NOT_CONFIGURED')
    if (symbols.length > 20) throw new AdapterError('REQUEST_BUDGET')
    let endpoints: string[]
    try {
      endpoints = symbols.map(tencentChartEndpoint)
    } catch {
      throw new AdapterError('NOT_CONFIGURED')
    }
    const values = new Map<string, unknown>(),
      items: Quote[] = []
    for (let i = 0; i < symbols.length; i++) {
      if (signal?.aborted) throw new AdapterError('ABORTED')
      const endpoint = endpoints[i]!
      if (!values.has(endpoint)) values.set(endpoint, (await transport.get(endpoint)).value)
      try {
        items.push(normalizeTencentQuote(symbols[i]!, values.get(endpoint)))
      } catch (error) {
        if (error instanceof AdapterError) throw error
        throw new AdapterError('INVALID_RESPONSE')
      }
    }
    return items
  },
}

import { z } from 'zod'
import type { Quote } from '../../../shared/contracts/dashboard.ts'
import { DecimalSchema } from '../../../shared/contracts/config.ts'
import { decimalDifference } from '../../../shared/domain/decimal.ts'
import { yahooChartEndpoint, yahooSymbol } from '../../../shared/quotes/yahoo-symbol.ts'
import { cap, parse, stampSeconds } from '../common.ts'
import { AdapterError } from '../types.ts'
import type { QuoteProvider } from './index.ts'

const number = z.number().finite()
const price = number.nonnegative()
const seconds = number.int().min(0).max(253402300799)
const optionalPrice = price.nullable().optional()
const Chart = z.object({
  chart: z.object({
    error: z.object({ code: z.string().max(200), description: z.string().max(2000) }).nullable(),
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string().min(1).max(32),
            regularMarketPrice: price,
            regularMarketTime: seconds,
            chartPreviousClose: optionalPrice,
            previousClose: optionalPrice,
            regularMarketChangePercent: number.nullable().optional(),
            regularMarketVolume: price.int().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
            regularMarketDayHigh: optionalPrice,
            regularMarketDayLow: optionalPrice,
            currency: z
              .string()
              .regex(/^[A-Z]{3}$/)
              .nullable()
              .optional(),
            shortName: z.string().max(500).nullable().optional(),
            longName: z.string().max(500).nullable().optional(),
            instrumentType: z.string().max(40).optional(),
            gmtoffset: number.int().min(-86400).max(86400).optional(),
            exchangeTimezoneName: z.string().max(100).optional(),
          }),
          timestamp: z.array(seconds).max(500).nullable().optional(),
          indicators: z
            .object({
              quote: z.array(z.object({ close: z.array(optionalPrice).max(500) })).length(1),
            })
            .optional(),
        }),
      )
      .length(1)
      .nullable(),
  }),
})

/** Yahoo supplies binary floats. Round ordinary prices to four decimals and expand exponent notation. */
export function yahooDecimal(value: number): string {
  if (!Number.isFinite(value)) throw new AdapterError('INVALID_RESPONSE')
  const rounded = Math.abs(value) >= 0.0001 ? Number(value.toFixed(4)) : value
  const sign = rounded < 0 ? '-' : ''
  const [coefficient, exp] = String(Math.abs(rounded)).toLowerCase().split('e')
  let decimal = coefficient!
  if (exp !== undefined) {
    const [whole, fraction = ''] = coefficient!.split('.')
    const digits = whole! + fraction,
      point = whole!.length + Number(exp)
    decimal =
      point <= 0
        ? '0.' + '0'.repeat(-point) + digits
        : point >= digits.length
          ? digits + '0'.repeat(point - digits.length)
          : digits.slice(0, point) + '.' + digits.slice(point)
  }
  const result = sign + decimal
  if (result.length > 96 || !DecimalSchema.safeParse(result).success)
    throw new AdapterError('INVALID_RESPONSE')
  return result
}

function previousSessionClose(
  meta: {
    previousClose?: number | null
    regularMarketTime: number
    exchangeTimezoneName?: string
    gmtoffset?: number
  },
  history: { at: string; close: string | null }[],
): string | null {
  if (meta.previousClose != null) return yahooDecimal(meta.previousClose)
  let day: (time: number) => string
  if (meta.exchangeTimezoneName) {
    try {
      const format = new Intl.DateTimeFormat('en-CA', {
        timeZone: meta.exchangeTimezoneName,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      day = (time) => {
        const parts = format.formatToParts(new Date(time))
        return ['year', 'month', 'day']
          .map((type) => parts.find((p) => p.type === type)!.value)
          .join('-')
      }
    } catch {
      return null
    }
  } else if (meta.gmtoffset !== undefined) {
    day = (time) => new Date(time + meta.gmtoffset! * 1000).toISOString().slice(0, 10)
  } else return null
  const currentDay = day(meta.regularMarketTime * 1000)
  // chartPreviousClose is the baseline of the requested five-day range, not yesterday's close.
  return history.filter((point) => day(Date.parse(point.at)) < currentDay).at(-1)?.close ?? null
}

function normalizedQuote(input: { market: string; symbol: string }, value: unknown): Quote {
  const chart = parse(Chart, value).chart
  if (chart.error)
    throw new AdapterError(chart.error.code === 'Not Found' ? 'NOT_FOUND' : 'UPSTREAM_UNAVAILABLE')
  if (!chart.result) throw new AdapterError('INVALID_RESPONSE')
  const result = chart.result[0]!,
    meta = result.meta
  if (meta.symbol !== yahooSymbol(input)) throw new AdapterError('INVALID_RESPONSE')
  const times = result.timestamp ?? [],
    closes = result.indicators?.quote[0]?.close ?? []
  if (
    times.length !== closes.length ||
    times.some((at, i) => at > meta.regularMarketTime + 60 || (i > 0 && at <= times[i - 1]!))
  )
    throw new AdapterError('INVALID_RESPONSE')
  const points = times.map((time, i) => ({
    at: stampSeconds(time),
    close: closes[i] == null ? null : yahooDecimal(closes[i]!),
  }))
  const history = points.flatMap((point) =>
    point.close === null ? [] : [{ at: point.at, close: point.close }],
  )
  const current = yahooDecimal(meta.regularMarketPrice)
  const previousClose = previousSessionClose(meta, points)
  const change = previousClose === null ? null : decimalDifference(current, previousClose)
  const previous = previousClose === null ? null : Number(previousClose)
  const high = meta.regularMarketDayHigh,
    low = meta.regularMarketDayLow
  if (high != null && low != null && low > high) throw new AdapterError('INVALID_RESPONSE')
  return {
    market: input.market,
    symbol: input.symbol,
    provider: 'yahoo-chart-v8',
    currency: meta.currency ?? null,
    name: meta.shortName || meta.longName || input.symbol,
    price: current,
    previousClose,
    change,
    changePercent:
      previous && change !== null ? yahooDecimal((Number(change) / previous) * 100) : null,
    amplitudePercent:
      high != null && low != null && previous
        ? yahooDecimal(((high - low) / previous) * 100)
        : null,
    volume: meta.regularMarketVolume == null ? null : yahooDecimal(meta.regularMarketVolume),
    volumeUnit:
      meta.regularMarketVolume != null && ['EQUITY', 'ETF'].includes(meta.instrumentType ?? '')
        ? 'shares'
        : null,
    asOf: stampSeconds(meta.regularMarketTime),
    delayedMinutes: null,
    history,
    capabilities: { quote: cap(true, true), history: cap(history.length > 0, history.length > 0) },
  }
}

export const yahooChart: QuoteProvider = {
  id: 'yahoo-chart-v8',
  licenseReference: 'Unofficial Yahoo Finance v8 chart endpoint; no public license',
  publicDisplay: false,
  capabilities: { quote: cap(true, true) },
  async read(symbols, transport, signal) {
    if (!symbols.length) throw new AdapterError('NOT_CONFIGURED')
    if (symbols.length > 20) throw new AdapterError('REQUEST_BUDGET')
    let endpoints: string[]
    try {
      endpoints = symbols.map(yahooChartEndpoint)
    } catch {
      throw new AdapterError('NOT_CONFIGURED')
    }
    const responses = new Map<string, unknown>(),
      quotes: Quote[] = []
    for (let i = 0; i < symbols.length; i++) {
      if (signal?.aborted) throw new AdapterError('ABORTED')
      const endpoint = endpoints[i]!
      if (!responses.has(endpoint)) responses.set(endpoint, (await transport.get(endpoint)).value)
      quotes.push(normalizedQuote(symbols[i]!, responses.get(endpoint)))
    }
    return quotes
  },
}

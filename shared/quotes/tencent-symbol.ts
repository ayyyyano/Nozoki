import type { QuoteSymbolInput } from './yahoo-symbol.ts'

/** Exchange suffixes observed in the Tencent quote response, not inferred from ticker spelling. */
const knownSymbols: Readonly<Record<string, string>> = { QQQM: 'QQQM.OQ', VOO: 'VOO.AM' }
export function tencentSymbol({ market, symbol }: QuoteSymbolInput): string {
  if (!['US', 'NASDAQ', 'NYSE', 'AMEX', 'ARCA'].includes(market))
    throw new Error('UNSUPPORTED_QUOTE_SYMBOL')
  const code = knownSymbols[symbol] ?? symbol
  if (!/^[A-Z][A-Z0-9-]{0,24}\.(?:OQ|N|AM)$/.test(code)) throw new Error('UNSUPPORTED_QUOTE_SYMBOL')
  return 'us' + code
}
export function tencentChartEndpoint(input: QuoteSymbolInput): string {
  return `appstock/app/usfqkline/get?param=${tencentSymbol(input)},day,,,5,qfq`
}
export function isTencentChartEndpoint(endpoint: string): boolean {
  return /^appstock\/app\/usfqkline\/get\?param=us[A-Z][A-Z0-9-]{0,24}\.(?:OQ|N|AM),day,,,5,qfq$/.test(
    endpoint,
  )
}

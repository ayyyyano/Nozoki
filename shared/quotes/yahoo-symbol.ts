export interface QuoteSymbolInput {
  market: string
  symbol: string
}
export function yahooSymbol(input: QuoteSymbolInput): string {
  const { market, symbol } = input
  if (
    ['US', 'NASDAQ', 'NYSE', 'AMEX', 'ARCA'].includes(market) &&
    /^[A-Z][A-Z0-9.-]{0,31}$/.test(symbol) &&
    !/\.(?:SS|SZ|HK)$/.test(symbol)
  )
    return symbol
  if (['HK', 'HKEX'].includes(market) && /^\d{1,5}(?:\.HK)?$/.test(symbol)) {
    const code = String(Number(symbol.replace(/\.HK$/, '')))
    if (Number(code) > 0) return code.padStart(4, '0') + '.HK'
  }
  if (['CN', 'SH', 'SSE', 'SZ', 'SZSE'].includes(market)) {
    if (/^\d{6}\.(?:SS|SZ)$/.test(symbol)) {
      if (['SH', 'SSE'].includes(market) && !symbol.endsWith('.SS'))
        throw new Error('UNSUPPORTED_QUOTE_SYMBOL')
      if (['SZ', 'SZSE'].includes(market) && !symbol.endsWith('.SZ'))
        throw new Error('UNSUPPORTED_QUOTE_SYMBOL')
      return symbol
    }
    if (/^\d{6}$/.test(symbol)) {
      if (['SH', 'SSE'].includes(market) || (market === 'CN' && /^[569]/.test(symbol)))
        return symbol + '.SS'
      if (['SZ', 'SZSE'].includes(market) || (market === 'CN' && /^[0123]/.test(symbol)))
        return symbol + '.SZ'
    }
  }
  throw new Error('UNSUPPORTED_QUOTE_SYMBOL')
}
export function yahooChartEndpoint(symbol: QuoteSymbolInput): string {
  return 'v8/finance/chart/' + encodeURIComponent(yahooSymbol(symbol)) + '?range=5d&interval=1d'
}
export function isYahooChartEndpoint(endpoint: string): boolean {
  return /^v8\/finance\/chart\/[A-Z0-9][A-Z0-9.-]{0,31}\?range=5d&interval=1d$/.test(endpoint)
}

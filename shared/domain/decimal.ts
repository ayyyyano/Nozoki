// Exact decimal arithmetic for balance changes; no conversion through binary floating point.
function parts(value: string) {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 100)
    throw new Error('INVALID_DECIMAL')
  const negative = value.startsWith('-'),
    [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  return { value: BigInt(whole! + fraction) * (negative ? -1n : 1n), scale: fraction.length }
}
function format(value: bigint, scale: number) {
  const negative = value < 0n
  let digits = (negative ? -value : value).toString().padStart(scale + 1, '0')
  if (scale)
    digits = (digits.slice(0, -scale) + '.' + digits.slice(-scale))
      .replace(/0+$/, '')
      .replace(/\.$/, '')
  return (negative ? '-' : '') + digits
}
export function decimalDifference(a: string, b: string) {
  const x = parts(a),
    y = parts(b),
    scale = Math.max(x.scale, y.scale)
  return format(
    x.value * 10n ** BigInt(scale - x.scale) - y.value * 10n ** BigInt(scale - y.scale),
    scale,
  )
}

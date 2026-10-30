export const COLOR_PRESETS = [
  { name: '经典紫', color: '#6750A4' },
  { name: '天空蓝', color: '#0061A4' },
  { name: '青绿色', color: '#006A60' },
  { name: '草木绿', color: '#42691B' },
  { name: '樱花粉', color: '#984061' },
  { name: '暖橙色', color: '#9A4D00' },
] as const
export function parseSourceColor(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const input = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(input)) return input.toUpperCase()
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(input)
  if (!match) return null
  const channels = match.slice(1).map(Number)
  if (channels.some((n) => n > 255)) return null
  return (
    '#' +
    channels
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

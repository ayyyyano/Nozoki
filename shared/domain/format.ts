export function decimalText(value: string | null | undefined): string {
  if (value == null || !/^-?\d+(\.\d+)?$/.test(value)) return '—'
  const [whole = '', fraction] = value.split('.')
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction !== undefined ? `.${fraction}` : '')
  )
}
export function signedDecimal(value: string | null): string {
  const text = decimalText(value)
  return text === '—' || value?.startsWith('-') ? text : `+${text}`
}
export function formatTimestamp(value: string | null, timezone = 'Asia/Shanghai'): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '尚无记录'
  const p = zonedParts(new Date(value), timezone)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}
export function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (name: string) => parts.find((p) => p.type === name)?.value ?? '00'
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

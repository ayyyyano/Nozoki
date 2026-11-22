import type { Quote } from '../contracts/dashboard.ts'
import { decimalText } from './format.ts'
import {
  HISTORY_HOURS,
  type HistoryStatus,
  type MonitorHistoryPoint,
} from '../contracts/service-history.ts'

export interface ChartPoint {
  key: string
  label: string
  value: number | null
  display: string
  detail?: string
  at?: number
}

export function decimalPoint(
  key: string,
  label: string,
  raw?: string | null,
  unit?: string,
): ChartPoint {
  const value = raw == null || !raw.trim() ? NaN : Number(raw)
  return {
    key,
    label,
    value: Number.isFinite(value) ? value : null,
    display: Number.isFinite(value) ? decimalText(raw!) + (unit ? ' ' + unit : '') : '尚无记录',
  }
}

export function quoteSeries(quote: Quote, label: (at: string) => string): ChartPoint[] {
  return [
    ...new Map(
      (quote.history ?? [])
        .filter((point) => Number.isFinite(Date.parse(point.at)))
        .map((point) => [point.at, point] as const),
    ).values(),
  ]
    .toSorted((a, b) => a.at.localeCompare(b.at))
    .map(({ at, close }) => decimalPoint(at, label(at), close, quote.currency ?? undefined))
}

export const MONITOR_HISTORY_LABELS = {
  up: '正常',
  down: '异常',
  maintenance: '维护中',
  pending: '等待检测',
  unknown: '未知',
  missing: '缺测',
} as const
export interface StatusBucket {
  start: number
  end: number
  focusAt: number
  state: HistoryStatus
  count: number
}
const priority: Record<HistoryStatus, number> = {
  down: 5,
  maintenance: 4,
  pending: 3,
  unknown: 2,
  up: 1,
  missing: 0,
}

export function historyWindowStart(until: number) {
  return until - HISTORY_HOURS * 3600000
}

export function historyBucketIndex(buckets: readonly StatusBucket[], at: number) {
  return buckets.findIndex(
    ({ start, end }, i) => at >= start && (at < end || (i === buckets.length - 1 && at === end)),
  )
}

export function statusBuckets(
  points: readonly MonitorHistoryPoint[],
  count: number,
  until: number,
): StatusBucket[] {
  const origin = historyWindowStart(until)
  const step = (until - origin) / count
  const buckets: StatusBucket[] = Array.from({ length: count }, (_, i) => {
    const start = origin + i * step
    const end = i === count - 1 ? until : origin + (i + 1) * step
    return { start, end, focusAt: (start + end) / 2, state: 'missing', count: 0 }
  })
  for (const { at: stamp, state } of points) {
    const at = Date.parse(stamp)
    if (state === null || !Number.isFinite(at) || at < origin || at > until) continue
    const bucket = buckets[Math.min(count - 1, Math.floor((at - origin) / step))]!
    bucket.count++
    if (
      priority[state] > priority[bucket.state] ||
      (state === bucket.state && at > bucket.focusAt)
    ) {
      bucket.state = state
      bucket.focusAt = at
    }
  }
  return buckets
}

export function latencySeries(
  points: readonly MonitorHistoryPoint[],
  gapMs?: number,
): ChartPoint[] {
  const result: ChartPoint[] = []
  for (const point of points) {
    const at = Date.parse(point.at)
    const previous = result.at(-1)?.at
    if (previous !== undefined && gapMs && at - previous > gapMs)
      result.push({
        key: String(Math.floor((previous + at) / 2)),
        at: Math.floor((previous + at) / 2),
        label: '',
        value: null,
        display: '缺测',
      })
    result.push({
      key: point.at,
      label: '',
      at,
      value: point.latencyMs,
      display: point.latencyMs === null ? '无响应时间' : point.latencyMs + ' ms',
    })
  }
  return result
}

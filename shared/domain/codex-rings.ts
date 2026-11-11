export const CODEX_RINGS = [
  'fiveHourRemaining',
  'weeklyRemaining',
  'fiveHourResetProgress',
  'weeklyResetProgress',
] as const
export type CodexRingId = (typeof CODEX_RINGS)[number]
export const RING_LABELS: Record<CodexRingId, string> = {
  fiveHourRemaining: '5 小时额度剩余',
  weeklyRemaining: '周额度剩余',
  fiveHourResetProgress: '5 小时重置进度',
  weeklyResetProgress: '周重置进度',
}
export const DISPLAY_POLICIES = ['full', 'masked', 'hidden'] as const
export type DisplayPolicy = (typeof DISPLAY_POLICIES)[number]
export const DEFAULT_CODEX_SLOTS = ['fiveHourRemaining', 'weeklyRemaining'] as const
export const DEFAULT_CODEX_GUEST = {
  fiveHourRemaining: 'masked',
  weeklyRemaining: 'masked',
  fiveHourResetProgress: 'masked',
  weeklyResetProgress: 'masked',
} as const
type RingStatus = 'masked' | 'unknown' | 'stale' | 'unconfigured' | 'unsupported'
export type CodexRing = { id: CodexRingId } & (
  | { state: RingStatus }
  | { state: 'remaining'; percent: number; validUntil: number }
  | { state: 'progress'; startAt: number; resetAt: number; validUntil: number }
)
export interface CodexRingView {
  home: CodexRingId[]
  rings: CodexRing[]
}
export function ringMinutes(id: CodexRingId) {
  return id.startsWith('fiveHour') ? 300 : 10080
}
export function resetRing(id: CodexRingId) {
  return id.endsWith('ResetProgress')
}

export function presentRing(ring: CodexRing, now: number) {
  if (ring.state !== 'remaining' && ring.state !== 'progress')
    return { state: ring.state, percent: null, resetIn: null, resetAt: null }
  if (now >= ring.validUntil)
    return { state: 'stale' as const, percent: null, resetIn: null, resetAt: null }
  if (ring.state === 'remaining')
    return { state: ring.state, percent: ring.percent, resetIn: null, resetAt: null }
  if (now < ring.startAt || now >= ring.resetAt)
    return { state: 'unknown' as const, percent: null, resetIn: null, resetAt: null }
  return {
    state: ring.state,
    percent: ((now - ring.startAt) / (ring.resetAt - ring.startAt)) * 100,
    resetIn: ring.resetAt - now,
    resetAt: ring.resetAt,
  }
}

export function resetCountdown(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  if (minutes >= 1440)
    return `${Math.floor(minutes / 1440)} 天 ${Math.floor((minutes % 1440) / 60)} 小时`
  if (minutes >= 60) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
  return `${minutes} 分钟`
}

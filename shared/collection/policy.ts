// Portable scheduling rules; timestamps and counters are ordinary values supplied by the host.
export const COLLECTION_BUDGET = {
  maxSources: 10,
  concurrency: 1,
  maxRequests: 50,
  sourceTimeoutMs: 10000,
  leaseMs: 60000,
  cronSeconds: 300,
  cleanupSeconds: 3600,
  cleanupRows: 100,
} as const
export const COLLECTION_CODES = [
  'NOT_CONFIGURED',
  'SOURCE_DISABLED',
  'UNSUPPORTED_PROTOCOL',
  'TARGET_NOT_APPROVED',
  'ACCESS_NOT_APPROVED',
  'CONNECTOR_UNAVAILABLE',
  'DESTINATION_BLOCKED',
  'AUTH_REQUIRED',
  'CREDENTIAL_UNAVAILABLE',
  'CREDENTIAL_INVALID',
  'TIMEOUT',
  'ABORTED',
  'REDIRECT_REJECTED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'UPSTREAM_UNAVAILABLE',
  'INVALID_RESPONSE',
  'RESPONSE_TOO_LARGE',
  'REQUEST_BUDGET',
  'SOURCE_CHANGED',
  'LEASE_LOST',
  'LEASE_EXPIRED',
  'RESULT_OLDER',
  'DATABASE_ERROR',
  'ENVIRONMENT_CHANGED',
] as const
export type CollectionCode = (typeof COLLECTION_CODES)[number]
export function safeCollectionCode(value: unknown): CollectionCode {
  return COLLECTION_CODES.includes(value as CollectionCode)
    ? (value as CollectionCode)
    : 'INVALID_RESPONSE'
}
export function failureStatus(code: CollectionCode) {
  return code === 'NOT_CONFIGURED'
    ? ('unconfigured' as const)
    : ['TARGET_NOT_APPROVED', 'UNSUPPORTED_PROTOCOL'].includes(code)
      ? ('unsupported' as const)
      : ('error' as const)
}
export function retryPlan(
  now: number,
  interval: number,
  failures: number,
  code: CollectionCode,
  retryAfter?: number,
  priorLimit?: string | null,
) {
  const normal = Math.max(COLLECTION_BUDGET.cronSeconds, interval)
  const exponential = Math.min(21600, normal * 2 ** Math.min(6, Math.max(0, failures)))
  const delay = ['AUTH_REQUIRED', 'CREDENTIAL_INVALID', 'CREDENTIAL_UNAVAILABLE'].includes(code)
    ? Math.max(3600, exponential)
    : exponential
  // Preserve the vendor's longer declared window (bounded to one year by Transport).
  const limit =
    code === 'RATE_LIMITED' && retryAfter
      ? now + Math.min(31536000, Math.max(1, retryAfter)) * 1000
      : 0
  const cooldown = Math.max(limit, priorLimit ? Date.parse(priorLimit) : 0)
  return {
    nextRunAt: new Date(Math.max(now + delay * 1000, cooldown)).toISOString(),
    retryAfterUntil: cooldown > now ? new Date(cooldown).toISOString() : null,
  }
}
export function successfulSchedule(now: number, interval: number) {
  return new Date(now + Math.max(COLLECTION_BUDGET.cronSeconds, interval) * 1000).toISOString()
}
export function expiresAt(collectedAt: string, interval: number) {
  return new Date(Date.parse(collectedAt) + Math.max(600, interval * 2) * 1000).toISOString()
}
export function quotaExpired(
  window: { status?: string; resetAt: string | null; observedAt?: string | null },
  now: number,
) {
  return window.status === 'stale' || (window.resetAt !== null && Date.parse(window.resetAt) <= now)
}

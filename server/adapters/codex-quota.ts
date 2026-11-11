import { z } from 'zod'
import type { CodexData } from '../../shared/contracts/dashboard.ts'
import { decimalDifference } from '../../shared/domain/decimal.ts'
import { AdapterError, type ReadResponse } from './types.ts'

export type CodexQuotaAccount = NonNullable<CodexData['quota']>['accounts'][number]
type Window = CodexQuotaAccount['windows'][number]
export const CODEX_QUOTA_CALL = 'v8/management/requests/api-call'
const QuotaURL = 'https://chatgpt.com/backend-api/wham/usage'
export const QuotaAuthIndex = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
export const QuotaAccountId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const Envelope = z.object({ status_code: z.number().int(), body: z.unknown() })
const Payload = z.object({
  account_id: QuotaAccountId.nullish(),
  rate_limit: z.object({ primary_window: z.unknown(), secondary_window: z.unknown() }),
})
const UsageWindow = z.object({
  used_percent: z.number().min(0).max(100),
  limit_window_seconds: z.union([z.literal(18000), z.literal(604800)]),
  reset_at: z.number().int().nullish(),
  reset_after_seconds: z.number().int().nullish(),
})

export function quotaRequestBody(authIndex: string, accountId?: string) {
  return JSON.stringify({
    auth_index: QuotaAuthIndex.parse(authIndex),
    method: 'GET',
    url: QuotaURL,
    header: {
      Authorization: 'Bearer $TOKEN$',
      Accept: 'application/json',
      ...(accountId ? { 'ChatGPT-Account-Id': QuotaAccountId.parse(accountId) } : {}),
    },
  })
}

export function quotaWindows(response: ReadResponse, now: Date, accountId?: string): Window[] {
  const outer = Envelope.safeParse(response.value)
  if (!outer.success || (response.ageSeconds ?? 0) > 0) throw new AdapterError('INVALID_RESPONSE')
  const { status_code: status, body } = outer.data
  if (status === 401 || status === 403) throw new AdapterError('AUTH_REQUIRED')
  if (status === 429) throw new AdapterError('RATE_LIMITED')
  if (status !== 200) throw new AdapterError('UPSTREAM_UNAVAILABLE')
  const payload = Payload.parse(typeof body === 'string' ? JSON.parse(body) : body)
  if (accountId && payload.account_id && accountId !== payload.account_id)
    throw new AdapterError('INVALID_RESPONSE')
  const observed = now.getTime()
  const windows: Window[] = []
  for (const raw of [payload.rate_limit.primary_window, payload.rate_limit.secondary_window]) {
    const parsed = UsageWindow.safeParse(raw)
    if (!parsed.success) continue
    const w = parsed.data
    const end = w.reset_at ? w.reset_at * 1000 : observed + (w.reset_after_seconds ?? 0) * 1000
    if (
      (w.reset_at || w.reset_after_seconds) &&
      !(end > observed && end <= observed + w.limit_window_seconds * 1000)
    )
      continue
    const minutes = w.limit_window_seconds / 60
    windows.push({
      id: minutes === 300 ? 'five-hour' : 'weekly',
      label: minutes === 300 ? '5 小时额度' : '周额度',
      windowMinutes: minutes,
      remainingPercent: decimalDifference('100', w.used_percent.toFixed(12)),
      observedAt: now.toISOString(),
      resetAt:
        end > observed && end <= observed + w.limit_window_seconds * 1000
          ? new Date(end).toISOString()
          : null,
      basis: 'quota_read',
      status: 'ok',
    })
  }
  return windows.filter((w) => windows.filter((other) => other.id === w.id).length === 1)
}

/** Keep each window's own timestamp when a later poll is unavailable or partial. */
export function mergeQuotaWindows(previous: Window[], ...incoming: Window[][]): Window[] {
  const byWindow = new Map<string, Window>()
  for (const group of [previous, ...incoming]) {
    const keys = group.map((w) => (w.windowMinutes ? String(w.windowMinutes) : w.id))
    const ambiguous = new Set(keys.filter((key, index) => keys.indexOf(key) !== index))
    for (const w of group) {
      const key = w.windowMinutes ? String(w.windowMinutes) : w.id
      if (ambiguous.has(key)) continue
      const current = byWindow.get(key)
      if (
        !current ||
        (w.observedAt ?? '') > (current.observedAt ?? '') ||
        ((w.observedAt ?? '') === (current.observedAt ?? '') && w.basis === 'quota_read')
      )
        byWindow.set(key, w)
    }
  }
  return [...byWindow.values()].slice(0, 30)
}

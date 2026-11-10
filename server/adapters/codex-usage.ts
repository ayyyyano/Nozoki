import { z } from 'zod'
import type { CodexData } from '../../shared/contracts/dashboard.ts'
import { hex, mac } from '../services/auth-crypto.ts'
import { AdapterError } from './types.ts'

export const CODEX_USAGE_QUEUE = 'v8/management/observability/usage/queue?count=50'
export const isCodexUsageQueueEndpoint = (value: string) => value === CODEX_USAGE_QUEUE
export const USAGE_RETENTION_DAYS = 400
export const UsageCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const UsageDaySchema = z
  .strictObject({
    day: z.iso.date(),
    input: UsageCount,
    output: UsageCount,
    reasoning: UsageCount,
    cached: UsageCount,
    total: UsageCount,
    requests: UsageCount,
    failed: UsageCount,
  })
  .refine((day) => day.failed <= day.requests)
export type UsageDay = z.infer<typeof UsageDaySchema>
export const UsageQueueSchema = z
  .array(
    z.strictObject({
      timestamp: z.iso.datetime({ offset: true }),
      latency_ms: z.number().finite().min(0),
      source: z.string().max(500),
      auth_index: z.string().max(500),
      tokens: z.strictObject({
        input_tokens: UsageCount,
        output_tokens: UsageCount,
        reasoning_tokens: UsageCount,
        cached_tokens: UsageCount,
        total_tokens: UsageCount,
      }),
      failed: z.boolean(),
      provider: z.string().max(80),
      model: z.string().max(500),
      alias: z.string().max(500),
      endpoint: z.string().max(2048),
      auth_type: z.string().max(80),
      request_id: z.string().max(500),
    }),
  )
  .max(50)
export const usageCutoff = (now: Date) =>
  new Date(now.getTime() - (USAGE_RETENTION_DAYS - 1) * 86400000).toISOString().slice(0, 10)
const counters = ['input', 'output', 'reasoning', 'cached', 'total', 'requests', 'failed'] as const
export function mergeUsageDays(
  prior: readonly UsageDay[],
  delta: readonly UsageDay[],
  now: Date,
): UsageDay[] {
  const days = new Map<string, UsageDay>(),
    cutoff = usageCutoff(now)
  for (const raw of [...prior, ...delta]) {
    const parsed = UsageDaySchema.safeParse(raw)
    if (!parsed.success) throw new AdapterError('INVALID_RESPONSE')
    const day = parsed.data
    if (day.day < cutoff || Date.parse(day.day) > now.getTime() + 60000) continue
    const sum = days.get(day.day) ?? {
      day: day.day,
      input: 0,
      output: 0,
      reasoning: 0,
      cached: 0,
      total: 0,
      requests: 0,
      failed: 0,
    }
    for (const key of counters) {
      const next = sum[key] + day[key]
      if (!Number.isSafeInteger(next)) throw new AdapterError('INVALID_RESPONSE')
      sum[key] = next
    }
    days.set(day.day, sum)
  }
  return [...days.values()].toSorted((a, b) => a.day.localeCompare(b.day)).slice(-500)
}
export async function aggregateUsage(
  value: unknown,
  identityKey: CryptoKey,
  sourceId: string,
  accounts: ReadonlySet<string>,
  now: Date,
) {
  const parsed = UsageQueueSchema.safeParse(value)
  if (!parsed.success) throw new AdapterError('INVALID_RESPONSE')
  const days: UsageDay[] = []
  for (const record of parsed.data) {
    if (record.provider.toLowerCase() !== 'codex' || !record.auth_index) continue
    const account = hex(
      await mac(identityKey, ['nozoki-codex-account-v1', sourceId, record.auth_index]),
    )
    if (!accounts.has(account)) continue
    const stamp = new Date(record.timestamp)
    if (stamp.getTime() > now.getTime() + 60000) throw new AdapterError('INVALID_RESPONSE')
    days.push({
      day: stamp.toISOString().slice(0, 10),
      input: record.tokens.input_tokens,
      output: record.tokens.output_tokens,
      reasoning: record.tokens.reasoning_tokens,
      cached: record.tokens.cached_tokens,
      total: record.tokens.total_tokens,
      requests: 1,
      failed: Number(record.failed),
    })
  }
  return mergeUsageDays([], days, now)
}
export function usageView(days: UsageDay[]): CodexData['usage'] {
  return {
    scope: 'cproxy-queue-v8',
    coverageStart: days[0] ? `${days[0].day}T00:00:00.000Z` : null,
    days,
  }
}

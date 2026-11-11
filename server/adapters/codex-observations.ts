import { z } from 'zod'
import type { AdapterContext } from './types.ts'
import type { CodexData } from '../../shared/contracts/dashboard.ts'
import { decimalDifference } from '../../shared/domain/decimal.ts'
import { stampISO, stampSeconds, staleAt, parse } from './common.ts'
type Window = NonNullable<CodexData['quota']>['accounts'][number]['windows'][number]
/** Passive response headers are an observation, never a new quota query or billing record. */
export function passiveWindows(value: unknown, context: AdapterContext): Window[] {
  if (value === undefined || value === null) return []
  const q = parse(
    z.object({
      observed_at: z.string().optional(),
      signals: z.record(z.string().max(100), z.string().max(512)).optional(),
    }),
    value,
  )
  if (!q.observed_at || !q.signals || q.observed_at.startsWith('0001-')) return []
  const observedAt = stampISO(q.observed_at),
    old = staleAt(observedAt, context)
  const signals: Record<string, string> = {}
  for (const [k, v] of Object.entries(q.signals)) {
    const key = k.toLowerCase()
    if (Object.hasOwn(signals, key)) return []
    signals[key] = v
  }
  const windows: Window[] = []
  for (const kind of ['primary', 'secondary']) {
    const used = signals[`x-codex-${kind}-used-percent`]
    if (used === undefined) continue
    if (!/^(?:0|[1-9]\d?)(?:\.\d{1,12})?$|^100(?:\.0{1,12})?$/.test(used)) continue
    const reset = signals[`x-codex-${kind}-reset-at`]
    const minutes = signals[`x-codex-${kind}-window-minutes`]
    const windowMinutes = minutes && /^[1-9]\d{0,5}$/.test(minutes) ? Number(minutes) : 0
    let resetAt: string | null = null
    if (reset !== undefined && /^[1-9]\d{0,11}$/.test(reset)) {
      try {
        resetAt = stampSeconds(Number(reset))
      } catch {
        /* Unusable reset remains unknown. */
      }
    }
    windows.push({
      id: kind,
      label: kind === 'primary' ? '主窗口' : '次窗口',
      remainingPercent: decimalDifference('100', used),
      resetAt,
      ...(windowMinutes > 0 && windowMinutes <= 525600 ? { windowMinutes } : {}),
      observedAt,
      basis: 'passive_headers',
      status:
        old || (resetAt !== null && Date.parse(resetAt) <= context.now.getTime()) ? 'stale' : 'ok',
    })
  }
  return windows
}
/** Parser for an independently reviewed plugin. No plugin invocation is registered here. */
export function pluginWindows(value: unknown): Window[] {
  const q = parse(
    z.object({
      groups: z
        .array(
          z.object({
            displayName: z.string().max(100).optional(),
            buckets: z
              .array(
                z.object({
                  window: z.string().min(1).max(80),
                  remainingFraction: z.number().finite().min(0).max(1),
                  resetTime: z.string().optional(),
                }),
              )
              .max(30),
          }),
        )
        .max(10),
    }),
    value,
  )
  const windows = q.groups.flatMap((g, i) =>
    g.buckets.map((b) => ({
      id: `${i}/${b.window}`,
      label: b.window,
      remainingPercent: String(Number((b.remainingFraction * 100).toFixed(8))),
      resetAt: b.resetTime ? stampISO(b.resetTime) : null,
      observedAt: null,
      basis: 'reviewed_plugin' as const,
    })),
  )
  if (windows.length > 30 || new Set(windows.map((w) => w.id)).size !== windows.length)
    throw new Error('INVALID_PLUGIN_WINDOWS')
  return windows
}

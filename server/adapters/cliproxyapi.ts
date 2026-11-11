import { z } from 'zod'
import { ADAPTER_PROTOCOLS } from '../../shared/contracts/adapter.ts'
import { cap, parse, putView, sourceResult } from './common.ts'
import type { Adapter, AdapterContext } from './types.ts'
import { AdapterError } from './types.ts'
import { stampISO, staleAt } from './common.ts'
import { passiveWindows } from './codex-observations.ts'
import { hex, mac } from '../services/auth-crypto.ts'
import { CODEX_USAGE_QUEUE, aggregateUsage, mergeUsageDays, usageView } from './codex-usage.ts'
import {
  QuotaAccountId,
  QuotaAuthIndex,
  mergeQuotaWindows,
  quotaWindows,
  type CodexQuotaAccount,
} from './codex-quota.ts'
const AccountMetadata = z.object({ chatgpt_account_id: QuotaAccountId.optional() })
const Cooldown = z.object({
  scope: z.string().max(40),
  reason: z.string().max(80),
  retry_at: z.string(),
  http_status: z.number().int().optional(),
})
const Credentials = z.object({
  observed_at: z.string().optional(),
  files: z
    .array(
      z.object({
        id: z.string().max(500).optional(),
        auth_index: z.string().max(500).optional(),
        provider: z.string().max(80),
        status: z.string().max(40).optional(),
        disabled: z.boolean().nullable().optional(),
        unavailable: z.boolean().nullable().optional(),
        success: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        failed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        cooldowns: z.array(Cooldown).max(200).nullable().optional(),
        quota: z.unknown().optional(),
        id_token: z.unknown().optional(),
        chatgpt_account_id: z.unknown().optional(),
      }),
    )
    .max(100),
})
async function readAccounts(context: AdapterContext, consume = true) {
  if (!context.identityKey) throw new AdapterError('CREDENTIAL_UNAVAILABLE')
  const response = await context.transport.get('v8/management/credentials'),
    value = parse(Credentials, response.value)
  const result = sourceResult(context, {
    accounts: cap(true, true),
    executionCounts: cap(false),
    quota: cap(false),
    usage: cap(false),
    estimatedCost: cap(false),
  })
  result.observedAt = value.observed_at ? stampISO(value.observed_at) : null
  if (staleAt(result.observedAt, context, response.ageSeconds)) result.status = 'stale'
  const accounts = [],
    quotas: CodexQuotaAccount[] = [],
    targets: { id: string; authIndex: string; accountId?: string; ready: boolean }[] = []
  let invalidQuota = false
  for (const file of value.files) {
    if (file.provider.toLowerCase() !== 'codex') continue
    const rawId = file.auth_index || file.id
    if (!rawId) throw new AdapterError('INVALID_RESPONSE')
    const id = hex(
      await mac(context.identityKey, ['nozoki-codex-account-v1', context.source.id, rawId]),
    )
    const cooldowns = (file.cooldowns ?? [])
      .filter((c) => c.scope === 'credential')
      .map((c) => ({ ...c, at: stampISO(c.retry_at) }))
      .filter((c) => Date.parse(c.at) > context.now.getTime())
    const authenticationFailure = cooldowns.some(
      (c) => c.reason === 'unauthorized' || c.reason === 'invalid_grant' || c.http_status === 401,
    )
    const disabled = file.disabled ?? null,
      unavailable = file.unavailable ?? null
    const state =
      disabled === true || file.status === 'disabled'
        ? 'disabled'
        : authenticationFailure
          ? 'auth_error'
          : cooldowns.length && unavailable === true
            ? 'cooldown'
            : file.status === 'error'
              ? 'error'
              : unavailable === true
                ? 'unavailable'
                : file.status === 'pending'
                  ? 'pending'
                  : file.status === 'refreshing'
                    ? 'refreshing'
                    : disabled === false &&
                        unavailable === false &&
                        ['active', 'ready'].includes(file.status ?? '')
                      ? 'ready'
                      : 'unknown'
    accounts.push({
      id,
      provider: 'codex' as const,
      state,
      disabled,
      unavailable,
      retryAt:
        cooldowns
          .map((c) => c.at)
          .toSorted()
          .at(-1) ?? null,
      observedAt: result.observedAt,
      executionCounts:
        file.success !== undefined && file.failed !== undefined
          ? {
              success: file.success,
              failed: file.failed,
              scope: 'source_runtime' as const,
              since: null,
            }
          : null,
    })
    const previous = context.previousCodexQuota?.find((a) => a.id === id)?.windows ?? []
    let passive: CodexQuotaAccount['windows'] = []
    try {
      passive = passiveWindows(file.quota, context)
    } catch {
      invalidQuota = true
    }
    const windows = mergeQuotaWindows(previous, passive).map((w) =>
      state === 'disabled' || state === 'auth_error' ? { ...w, status: 'stale' as const } : w,
    )
    if (windows.length) quotas.push({ id, windows })
    const index = QuotaAuthIndex.safeParse(file.auth_index)
    if (index.success && state !== 'disabled' && state !== 'auth_error') {
      const idToken = AccountMetadata.safeParse(file.id_token)
      const accountId =
        QuotaAccountId.safeParse(file.chatgpt_account_id).data ?? idToken.data?.chatgpt_account_id
      targets.push({ id, authIndex: index.data, accountId, ready: state === 'ready' })
    }
  }
  if (new Set(accounts.map((a) => a.id)).size !== accounts.length)
    throw new AdapterError('INVALID_RESPONSE')
  let quotaFailure: string | undefined = invalidQuota ? 'INVALID_QUOTA_OBSERVATION' : undefined
  const target = targets.toSorted(
    (a, b) => Number(b.ready) - Number(a.ready) || a.id.localeCompare(b.id),
  )[0]
  if (consume && target && context.readCodexQuota) {
    try {
      const response = await context.readCodexQuota(target.authIndex, target.accountId)
      const observed = quotaWindows(response, context.now, target.accountId)
      if (!observed.length) throw new AdapterError('INVALID_RESPONSE')
      const existing = quotas.find((a) => a.id === target.id)
      if (existing) {
        existing.windows = mergeQuotaWindows(existing.windows, observed).map((w) =>
          w.basis === 'quota_read' &&
          !observed.some((item) => item.windowMinutes === w.windowMinutes)
            ? { ...w, status: 'stale' }
            : w,
        )
      } else quotas.push({ id: target.id, windows: observed })
      quotaFailure = undefined
    } catch {
      quotaFailure = 'QUOTA_READ_UNAVAILABLE'
      const existing = quotas.find((a) => a.id === target.id)
      if (existing)
        existing.windows = existing.windows.map((w) =>
          w.basis === 'quota_read' ? { ...w, status: 'stale' } : w,
        )
    }
  }
  result.capabilities.quota = {
    ...cap(quotas.length > 0, quotas.length > 0),
    ...(quotaFailure ? { reason: quotaFailure } : {}),
  }
  const hasCounts = accounts.some((a) => a.executionCounts !== null)
  result.capabilities.executionCounts = cap(hasCounts, hasCounts)
  result.items = accounts.length
  let usage = context.codexUsageDays?.length
    ? usageView(mergeUsageDays(context.codexUsageDays, [], context.now))
    : null
  if (consume) {
    try {
      // Destructive GET: exactly once per leased collection; never called by probes.
      const queue = await context.transport.get(CODEX_USAGE_QUEUE)
      result.usageDelta = await aggregateUsage(
        queue.value,
        context.identityKey,
        context.source.id,
        new Set(accounts.map((a) => a.id)),
        context.now,
      )
      usage = usageView(
        mergeUsageDays(context.codexUsageDays ?? [], result.usageDelta, context.now),
      )
      result.capabilities.usage = cap(true, true)
    } catch (error) {
      const disabled =
        error instanceof AdapterError &&
        (error.code === 'NOT_FOUND' || error.upstreamStatus === 400)
      if (!disabled && !context.readCodexQuota) throw error
      result.capabilities.usage = {
        ...cap(false),
        reason: disabled ? 'USAGE_STATISTICS_DISABLED' : 'USAGE_QUEUE_UNAVAILABLE',
      }
    }
  }
  putView(result, 'codex', {
    accounts,
    usage,
    quota: quotas.length ? { accounts: quotas } : null,
    estimatedCost: null,
    capabilities: result.capabilities,
  })
  return result
}
async function read(context: AdapterContext) {
  if (context.source.protocolVersion === 'cliproxy-v8-accounts') return readAccounts(context)
  // Explicit v8 config leaf, not the consuming usage queue, auth-files or upstream proxy API.
  const { value } = await context.transport.get(
    'v8/management/config/observability/usage/usage-statistics-enabled',
  )
  const publishing = parse(z.boolean(), value)
  const result = sourceResult(context, {
    telemetryPublishing: cap(true, true),
    usage: cap(false),
    quota: cap(false),
    estimatedCost: cap(false),
  })
  result.status = 'unsupported'
  result.facts = { telemetryPublishing: publishing }
  putView(result, 'codex', {
    usage: null,
    quota: null,
    estimatedCost: null,
    capabilities: { usage: cap(false), quota: cap(false), estimatedCost: cap(false) },
  })
  return result
}
export const cliproxy: Adapter = {
  provider: 'cliproxy-bridge',
  versions: ADAPTER_PROTOCOLS['cliproxy-bridge'],
  expectedCapabilities: ['accounts', 'telemetryPublishing', 'usage', 'quota', 'estimatedCost'],
  probe: (context) =>
    context.source.protocolVersion === 'cliproxy-v8-accounts'
      ? readAccounts(context, false)
      : read(context),
  read,
}

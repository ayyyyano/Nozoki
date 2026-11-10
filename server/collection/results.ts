import type { AdapterRead } from '../adapters/types.ts'
import type { CollectionClaim, ViewCommit, BalanceCommit } from '../repositories/collection.ts'
import { snapshotSchema } from '../../shared/contracts/snapshots.ts'
import { expiresAt } from '../../shared/collection/policy.ts'
import { AdapterError } from '../adapters/types.ts'
import { UsageDaySchema } from '../adapters/codex-usage.ts'
export function collectionPayload(c: CollectionClaim, result: AdapterRead, now: string) {
  if (
    result.sourceId !== c.plan.source.id ||
    result.provider !== c.plan.source.provider ||
    result.protocolVersion !== c.plan.source.protocolVersion ||
    result.code
  )
    throw new AdapterError(result.code ?? 'INVALID_RESPONSE')
  if (!['ok', 'stale', 'offline'].includes(result.status))
    throw new AdapterError(
      result.status === 'unconfigured' ? 'NOT_CONFIGURED' : 'UNSUPPORTED_PROTOCOL',
    )
  const views: ViewCommit[] = [],
    balances: BalanceCommit[] = []
  for (const ref of c.plan.references) {
    const raw = result.views[ref.moduleId]
    if (!raw) continue
    const parsed = snapshotSchema(ref.moduleId).safeParse(raw)
    if (
      !parsed.success ||
      parsed.data.sourceId !== c.plan.source.id ||
      !parsed.data.data ||
      !['ok', 'stale', 'offline'].includes(parsed.data.status)
    )
      throw new AdapterError('INVALID_RESPONSE')
    const snapshot = parsed.data,
      collectedAt = now
    snapshot.collectedAt = collectedAt
    if (snapshot.observedAt && Date.parse(snapshot.observedAt) > Date.parse(now) + 60000)
      throw new AdapterError('INVALID_RESPONSE')
    snapshot.expiresAt = expiresAt(collectedAt, c.plan.source.refreshInterval)
    snapshot.lastSuccessAt = now
    views.push({
      moduleId: ref.moduleId,
      subject: ref.subject,
      snapshot,
      orderAt: snapshot.observedAt ?? collectedAt,
      collectedAt,
    })
    if (ref.moduleId === 'deepseek') {
      const data = result.views.deepseek!.data!
      if (new Set(data.balances.map((b) => b.currency)).size !== data.balances.length)
        throw new AdapterError('INVALID_RESPONSE')
      for (const b of data.balances)
        balances.push({
          currency: b.currency,
          observedAt: snapshot.observedAt,
          collectedAt,
          total: b.total,
          granted: b.granted,
          toppedUp: b.toppedUp,
        })
    }
  }
  if (!views.length) throw new AdapterError('UNSUPPORTED_PROTOCOL')
  if (new TextEncoder().encode(JSON.stringify(views)).length > 500000)
    throw new AdapterError('RESPONSE_TOO_LARGE')
  const usage = (result.usageDelta ?? []).map((day) => {
    const parsed = UsageDaySchema.safeParse(day)
    if (
      !parsed.success ||
      c.plan.source.provider !== 'cliproxy-bridge' ||
      c.plan.source.protocolVersion !== 'cliproxy-v8-accounts' ||
      !views.some((v) => v.moduleId === 'codex')
    )
      throw new AdapterError('INVALID_RESPONSE')
    return parsed.data
  })
  if (usage.length > 50 || new Set(usage.map((d) => d.day)).size !== usage.length)
    throw new AdapterError('INVALID_RESPONSE')
  return { views, balances, usage }
}

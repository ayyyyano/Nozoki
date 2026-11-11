import type { ModuleSettings } from '../../shared/contracts/config.ts'
import type { CodexData, DataSnapshot } from '../../shared/contracts/dashboard.ts'
import {
  CODEX_RINGS,
  DEFAULT_CODEX_GUEST,
  DEFAULT_CODEX_SLOTS,
  queriedQuotaLifetime,
  resetRing,
  ringMinutes,
  type CodexRing,
  type CodexRingId,
  type CodexRingView,
} from '../../shared/domain/codex-rings.ts'

export function tailnetIpPolicy(module: ModuleSettings, admin: boolean) {
  if (module.ipVisibility === 'hidden') return 'hidden'
  if (admin) return 'full'
  return module.presentation?.tailnetIp ?? (module.ipVisibility === 'public' ? 'full' : 'masked')
}

/** Apply presentation privacy only to fields that survived the ordinary field ACL. */
export function tailnetNodeProjection<T>(
  node: Record<string, T>,
  original: Record<string, T>,
  admin: boolean,
  module: ModuleSettings,
) {
  const ipPolicy = tailnetIpPolicy(module, admin)
  const namePolicy = admin ? 'full' : (module.presentation?.tailnetName ?? 'full')
  const addresses = Array.isArray(node.addresses) ? node.addresses.map(String) : null
  if (typeof node.name === 'string') {
    if (namePolicy === 'hidden') delete node.name
    else if (namePolicy === 'masked') node.name = '名称已遮蔽' as T
    else if (
      ipPolicy !== 'full' ||
      !addresses ||
      (Array.isArray(original.addresses) && original.addresses.length > addresses.length)
    ) {
      // A hostname can include an address. Use a constant placeholder, even for alternate IP forms.
      if (/(?:\d{1,3}\.){3}\d{1,3}|(?:[\da-f]*:){2,}[\da-f:.]*/i.test(node.name))
        node.name = '名称已遮蔽' as T
    }
  }
  if (ipPolicy !== 'full' || !addresses) {
    if (ipPolicy === 'masked' && addresses) node.addressLabel = 'IP 已遮蔽' as T
    delete node.addresses
    node.addressesHidden = true as T
  } else {
    // A literal IP used as a node name is also an alias in the address list.
    if ((namePolicy !== 'full' || node.name === undefined) && typeof original.name === 'string') {
      const name = original.name.toLowerCase()
      node.addresses = addresses.filter((address) => address.toLowerCase() !== name) as T
    }
    node.addressesHidden = false as T
  }
  return node
}

type Window = NonNullable<CodexData['quota']>['accounts'][number]['windows'][number]
const guestLifetime = 45_000 // The visible dashboard refreshes every 30 seconds.

export function codexRingProjection(
  data: Partial<CodexData> | null,
  snapshot: Pick<DataSnapshot<unknown>, 'status' | 'expiresAt'>,
  module: ModuleSettings,
  now: number,
  admin: boolean,
  refreshInterval = 300,
): CodexRingView {
  const settings = module.presentation?.codex
  const lifetime = Math.max(600, refreshInterval * 2) * 1000
  function evidence(w: Window) {
    if (
      (w.basis !== 'passive_headers' && w.basis !== 'quota_read') ||
      !w.status ||
      !w.windowMinutes ||
      !w.observedAt ||
      !w.resetAt
    )
      return null
    const observed = Date.parse(w.observedAt),
      resetAt = Date.parse(w.resetAt)
    const startAt = resetAt - w.windowMinutes * 60_000
    if (
      !Number.isFinite(observed) ||
      !(startAt <= observed && observed < resetAt) ||
      observed > now ||
      now < startAt
    )
      return null
    const validUntil = Math.min(
      resetAt,
      observed + lifetime,
      snapshot.expiresAt ? Date.parse(snapshot.expiresAt) : Infinity,
    )
    return { startAt, resetAt, validUntil }
  }
  const classified = (w: Window) => w.windowMinutes === 300 || w.windowMinutes === 10080
  const accounts = data?.quota?.accounts ?? []
  const lastQuery = (windows: Window[]) =>
    windows.reduce(
      (latest, w) =>
        classified(w) && w.basis === 'quota_read'
          ? Math.max(latest, Date.parse(w.observedAt ?? '') || 0)
          : latest,
      0,
    )
  const queried = accounts.filter((a) => lastQuery(a.windows ?? []) > 0)
  const account =
    queried.toSorted((a, b) => lastQuery(b.windows) - lastQuery(a.windows))[0] ??
    accounts.find((a) =>
      a.windows?.some(
        (w) => classified(w) && w.status === 'ok' && (evidence(w)?.validUntil ?? 0) > now,
      ),
    ) ??
    accounts.find((a) => a.windows?.some(classified))

  function observedRing(id: CodexRingId, w: Window): CodexRing {
    const queried = w.basis === 'quota_read'
    const observedAt = Date.parse(w.observedAt ?? '')
    const resetAt = Date.parse(w.resetAt ?? '')
    const timing = evidence(w)
    const validUntil = queried
      ? Math.min(
          Number.isFinite(resetAt) ? resetAt : Infinity,
          observedAt + queriedQuotaLifetime(refreshInterval),
        )
      : (timing?.validUntil ?? Infinity)
    const isStale =
      snapshot.status === 'error' ||
      snapshot.status === 'offline' ||
      (!queried && snapshot.status === 'stale') ||
      w.status === 'stale' ||
      validUntil <= now
    let percent = NaN
    if (w.status && Number.isFinite(observedAt) && observedAt <= now) {
      if (resetRing(id) && timing)
        percent = ((observedAt - timing.startAt) / (timing.resetAt - timing.startAt)) * 100
      else if (!resetRing(id) && (timing || queried) && typeof w.remainingPercent === 'string')
        percent = Number(w.remainingPercent)
    }
    const last =
      admin && Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? { percent, observedAt }
        : undefined
    if (isStale) return last ? { id, state: 'stale', last } : { id, state: 'stale' }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return { id, state: 'unknown' }
    if (resetRing(id) && timing)
      return {
        id,
        state: 'progress',
        startAt: timing.startAt,
        resetAt: timing.resetAt,
        validUntil,
        ...(last ? { last } : {}),
      }
    if (!admin && validUntil < now + guestLifetime) return { id, state: 'unknown' }
    return {
      id,
      state: 'remaining',
      percent,
      validUntil: admin ? validUntil : now + guestLifetime,
      ...(last ? { last } : {}),
    }
  }

  function ring(id: CodexRingId): CodexRing[] {
    const policy = admin ? 'full' : (settings?.guest[id] ?? DEFAULT_CODEX_GUEST[id])
    if (policy === 'hidden') return []
    if (policy === 'masked') return [{ id, state: 'masked' }]
    if (snapshot.status === 'unconfigured' || snapshot.status === 'unsupported')
      return [{ id, state: snapshot.status }]
    const candidates = account?.windows?.filter((w) => w.windowMinutes === ringMinutes(id)) ?? []
    if (
      candidates.length === 1 &&
      (candidates[0]!.basis === 'quota_read' || candidates[0]!.basis === 'passive_headers')
    )
      return [observedRing(id, candidates[0]!)]
    if (snapshot.status === 'stale') return [{ id, state: 'stale' }]
    return [{ id, state: 'unknown' }]
  }
  const rings = CODEX_RINGS.flatMap(ring)
  return {
    home: (settings?.slots ?? DEFAULT_CODEX_SLOTS).filter((id) => rings.some((r) => r.id === id)),
    rings,
  }
}

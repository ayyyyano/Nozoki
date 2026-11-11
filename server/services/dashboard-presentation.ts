import type { ModuleSettings } from '../../shared/contracts/config.ts'
import type { CodexData, DataSnapshot } from '../../shared/contracts/dashboard.ts'
import {
  CODEX_RINGS,
  DEFAULT_CODEX_GUEST,
  DEFAULT_CODEX_SLOTS,
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
      w.basis !== 'passive_headers' ||
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
  // Pick one account in stable source order: prefer the first with a fresh, classified window.
  const account =
    accounts.find((a) =>
      a.windows?.some(
        (w) => classified(w) && w.status === 'ok' && (evidence(w)?.validUntil ?? 0) > now,
      ),
    ) ?? accounts.find((a) => a.windows?.some(classified))

  function ring(id: CodexRingId): CodexRing[] {
    const policy = admin ? 'full' : (settings?.guest[id] ?? DEFAULT_CODEX_GUEST[id])
    if (policy === 'hidden') return []
    if (policy === 'masked') return [{ id, state: 'masked' }]
    if (snapshot.status === 'unconfigured' || snapshot.status === 'unsupported')
      return [{ id, state: snapshot.status }]
    if (snapshot.status === 'stale') return [{ id, state: 'stale' }]
    if (snapshot.status !== 'ok') return [{ id, state: 'unknown' }]
    const candidates = account?.windows?.filter((w) => w.windowMinutes === ringMinutes(id)) ?? []
    if (candidates.length !== 1) return [{ id, state: 'unknown' }]
    const w = candidates[0]!
    const timing = evidence(w)
    if (w.status === 'stale' || (timing && timing.validUntil <= now))
      return [{ id, state: 'stale' }]
    if (!timing) return [{ id, state: 'unknown' }]
    if (resetRing(id)) return [{ id, state: 'progress', ...timing }]
    const percent = Number(w.remainingPercent)
    if (
      typeof w.remainingPercent !== 'string' ||
      !Number.isFinite(percent) ||
      percent < 0 ||
      percent > 100
    )
      return [{ id, state: 'unknown' }]
    // A public allowance does not authorize its reset timestamp. Use a constant expiry
    // horizon for guests and withhold any observation that cannot stay valid throughout it.
    if (!admin && timing.validUntil < now + guestLifetime) return [{ id, state: 'unknown' }]
    return [
      {
        id,
        state: 'remaining',
        percent,
        validUntil: admin ? timing.validUntil : now + guestLifetime,
      },
    ]
  }
  const rings = CODEX_RINGS.flatMap(ring)
  return {
    home: (settings?.slots ?? DEFAULT_CODEX_SLOTS).filter((id) => rings.some((r) => r.id === id)),
    rings,
  }
}

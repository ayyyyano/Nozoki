import type { DataSnapshot, TailscaleData } from '../contracts/dashboard.ts'

export const TAILNET_HOME_LIMIT = 8
export function primaryTailnetAddress(addresses: readonly string[]) {
  return addresses.find((address) => !address.includes(':')) ?? addresses[0] ?? null
}
export function tailnetState(
  connected: boolean | null,
  snapshot: Pick<DataSnapshot<unknown>, 'status' | 'expiresAt'>,
  now: number,
): 'up' | 'down' | 'stale' | 'unknown' {
  if (snapshot.status === 'stale' || (snapshot.expiresAt && Date.parse(snapshot.expiresAt) <= now))
    return 'stale'
  if (snapshot.status !== 'ok' || connected == null) return 'unknown'
  return connected ? 'up' : 'down'
}
export function tailnetSummary(nodes: TailscaleData['devices']) {
  return nodes.slice(0, TAILNET_HOME_LIMIT)
}

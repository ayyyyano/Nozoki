export const STANDARD_COLLECTION_SECONDS = 300
export const UPTIMEFLARE_COLLECTION_SECONDS = 180
export const MAX_COLLECTION_SECONDS = 86400
export const STANDARD_COLLECTION_CRON = '*/5 * * * *'
export const UPTIMEFLARE_COLLECTION_CRON = '1-58/3 * * * *'
const FAST_OFFSET_MS = 60_000

type SourceInterval = { provider: string; refreshInterval: number }

export function usesFastCollection(source: SourceInterval) {
  return (
    source.provider === 'uptimeflare' && source.refreshInterval === UPTIMEFLARE_COLLECTION_SECONDS
  )
}

export function validCollectionInterval(source: SourceInterval) {
  return (
    Number.isInteger(source.refreshInterval) &&
    source.refreshInterval <= MAX_COLLECTION_SECONDS &&
    (source.refreshInterval >= STANDARD_COLLECTION_SECONDS || usesFastCollection(source))
  )
}

export function collectionInterval(source: SourceInterval) {
  return usesFastCollection(source)
    ? UPTIMEFLARE_COLLECTION_SECONDS
    : Math.max(STANDARD_COLLECTION_SECONDS, source.refreshInterval)
}

export type CollectionCadence = 'standard' | 'uptimeflare'

export function collectionTick(now: number, cadence: CollectionCadence) {
  const fast = cadence === 'uptimeflare'
  const period = (fast ? UPTIMEFLARE_COLLECTION_SECONDS : STANDARD_COLLECTION_SECONDS) * 1000
  const offset = fast ? FAST_OFFSET_MS : 0
  return Math.floor((now - offset) / period) * period + offset
}

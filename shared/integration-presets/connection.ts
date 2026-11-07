import type { ConfigWrite, IntegrationSettings } from '../contracts/config.ts'
import { canonical } from '../contracts/admin.ts'
import { normalizeServiceTarget } from '../contracts/service-target.ts'

type Draft = ConfigWrite['integrations'][number]
export function sourceConnection(source: Draft | IntegrationSettings) {
  return canonical([
    source.id,
    source.provider,
    source.protocolVersion,
    normalizeServiceTarget(source.baseUrl),
    source.access?.mode,
    source.access && source.access.mode !== 'legacy' ? source.access.authentication : null,
    source.fieldMappings,
  ])
}
export function requiresSourceTest(next: Draft, old?: IntegrationSettings) {
  try {
    if (!old || sourceConnection(next) !== sourceConnection(old)) return true
  } catch {
    return true
  }
  if (next.credential.operation === 'clear') return false
  const access = next.access
  if (!access || access.mode === 'legacy' || !access.approved) return false
  return (
    !old.access ||
    old.access.mode === 'legacy' ||
    !old.access.approved ||
    (access.authentication !== 'none' && next.credential.operation !== 'keep')
  )
}

import type { IntegrationSettings, IntegrationWriteSchema } from '../../shared/contracts/config.ts'
import type { z } from 'zod'
import type { AuthSession } from './sessions.ts'
import type { StoredIntegration } from '../repositories/config.ts'
import { canonical } from '../../shared/contracts/admin.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { normalizeServiceTarget } from './service-target.ts'
import { mac, hex, unhex, verifyMac } from './auth-crypto.ts'

type Draft = z.infer<typeof IntegrationWriteSchema>
function connection(source: Draft | IntegrationSettings) {
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
  if (!old || connection(next) !== connection(old)) return true
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
async function parts(
  draft: Draft,
  old: StoredIntegration | undefined,
  session: AuthSession,
  version: number,
  expires: string,
) {
  const access = draft.access
  if (!access || access.mode !== 'public') return null
  // A keyed digest binds the exact submitted secret without embedding a secret verifier in the token.
  const fingerprint = hex(
    await mac(session.settings.rateKey, [
      'nozoki-source-test-input-v1',
      connection(draft),
      canonical(draft.credential),
      canonical(old?.envelope ?? null),
    ]),
  )
  return [
    'nozoki-source-test-proof-v1',
    session.settings.fingerprint,
    session.hash,
    String(version),
    sourceTargetKey(draft, access),
    fingerprint,
    expires,
  ]
}
export async function issueSourceTestProof(
  draft: Draft,
  old: StoredIntegration | undefined,
  session: AuthSession,
  version: number,
  now = Date.now(),
) {
  const expires = String(now + 10 * 60 * 1000)
  const message = await parts(draft, old, session, version, expires)
  if (!message) return undefined
  return expires + '.' + hex(await mac(session.settings.rateKey, message))
}
export async function verifySourceTestProof(
  draft: Draft,
  old: StoredIntegration | undefined,
  session: AuthSession,
  version: number,
  now = Date.now(),
) {
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(draft.connectionProof ?? '')
  if (!match || Number(match[1]) <= now || Number(match[1]) > now + 10 * 60 * 1000) return false
  const message = await parts(draft, old, session, version, match[1]!)
  return !!message && verifyMac(session.settings.rateKey, message, unhex(match[2]!))
}

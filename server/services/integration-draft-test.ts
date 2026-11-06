import { issueSourceTestProof } from './source-test-proof.ts'
import { DraftIntegrationTestSchema } from '../../shared/contracts/integration-test.ts'
import { ProbeResultSchema, type ProbeResult } from '../../shared/contracts/adapter.ts'
import { integrationWriteIssue } from '../../shared/integration-presets/index.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { readStoredState } from '../repositories/config.ts'
import { credentialState, decryptCredential } from './credentials.ts'
import { credentialKeys } from './credential-keys.ts'
import { normalizeServiceTarget } from './service-target.ts'
import { AuthError } from './auth-settings.ts'
import type { AuthSession } from './sessions.ts'
import type { Database } from '../types/database.ts'
import { assertManagedSource } from '../adapters/source-connector.ts'
import { managedTransport } from '../adapters/managed-transport.ts'
import { runAdapter } from '../adapters/registry.ts'
import { declaredCapabilities } from '../adapters/capabilities.ts'
import { AdapterError } from '../adapters/types.ts'
import { hmacKey, randomToken } from './auth-crypto.ts'
import {
  reserveIntegrationTest,
  releaseIntegrationTest,
  deferIntegrationTest,
} from './integration-test-limits.ts'
import { collectionEnvironmentMatches } from '../collection/environment.ts'
import { applyProbeResult } from './integration-test.ts'

/** Tests transient admin input through the existing restricted transport; never saves configuration. */
export async function testIntegrationDraft(
  db: Database,
  id: string,
  value: unknown,
  session: AuthSession,
  env: Record<string, unknown>,
): Promise<ProbeResult> {
  const parsed = DraftIntegrationTestSchema.safeParse(value)
  if (!parsed.success || parsed.data.draft.id !== id) throw new AuthError(400, 'INVALID_REQUEST')
  const { draft, expectedVersion, quoteSymbols } = parsed.data
  const current = await readStoredState(db)
  if (current.config.site.configVersion !== expectedVersion)
    throw new AuthError(409, 'CONFIG_CONFLICT')
  const old = current.integrations.find((s) => s.settings.id === id)
  draft.baseUrl = normalizeServiceTarget(draft.baseUrl)
  const issue = integrationWriteIssue(
    draft,
    current.config.integrations.find((s) => s.id === id),
  )
  if (issue) throw new AuthError(400, issue)
  const {
    credential: operation,
    identityCredential: _identity,
    connectionProof: _proof,
    ...settings
  } = draft
  // Explicit testing is allowed while disabled. This flag exists only in this request's copy.
  const source = { ...settings, enabled: true, credentialState: credentialState(null) }
  if (source.access?.mode === 'public') {
    source.access = { ...source.access, approved: true, approvedTarget: null }
    source.access.approvedTarget = sourceTargetKey(source, source.access)
  }
  const now = new Date()
  const response: ProbeResult = {
    sourceId: id,
    provider: source.provider,
    protocolVersion: source.protocolVersion,
    configVersion: expectedVersion,
    status: 'error',
    reachable: null,
    protocolMatched: false,
    authentication: 'unverified',
    capabilities: declaredCapabilities(source.provider),
    observedAt: null,
    collectedAt: now.toISOString(),
    summary: { items: 0, views: 0 },
  }
  let secret: string | undefined
  let slot: Awaited<ReturnType<typeof reserveIntegrationTest>> | undefined
  try {
    const access = assertManagedSource(source)
    if (access.mode !== 'public') throw new AdapterError('DESTINATION_BLOCKED')
    if (source.provider === 'quotes-custom' && !quoteSymbols.length)
      throw new AdapterError('NOT_CONFIGURED')
    // Keep may only decrypt for the identical source identity, protocol, address and auth scheme.
    if (operation.operation === 'keep' && old?.envelope) {
      const before = old.settings.access
      if (
        !before ||
        before.mode !== 'public' ||
        sourceTargetKey(old.settings, before) !== sourceTargetKey(source, access)
      )
        throw new AdapterError('CREDENTIAL_INVALID')
    }
    if ((await collectionEnvironmentMatches(db, env)) === false)
      throw new AdapterError('CONNECTOR_UNAVAILABLE')
    // Hash a stable target, rather than the random draft ID, for per-target throttling.
    slot = await reserveIntegrationTest(
      db,
      session,
      'draft:' +
        JSON.stringify([
          source.provider,
          source.protocolVersion,
          source.baseUrl,
          access.authentication,
        ]),
      now,
    )
    if (access.authentication !== 'none') {
      if (operation.operation === 'replace') secret = operation.value
      else if (operation.operation === 'keep' && old?.envelope) {
        try {
          secret = await decryptCredential(
            id,
            source.provider,
            old.envelope,
            await credentialKeys(env),
          )
        } catch {
          throw new AdapterError('CREDENTIAL_UNAVAILABLE')
        }
      }
      if (!secret) throw new AdapterError('AUTH_REQUIRED')
    }
    // Probe responses expose only counts/capabilities, so account IDs need no persisted identity key.
    const identityKey =
      source.provider === 'cliproxy-bridge' ? await hmacKey(randomToken()) : undefined
    const result = await runAdapter(
      {
        source,
        transport: managedTransport(source, secret, env, { quoteSymbols }),
        now,
        quoteSymbols,
        identityKey,
      },
      'probe',
    )
    applyProbeResult(response, result, access.authentication !== 'none')
    if (result.code === 'RATE_LIMITED' && result.retryAfterSeconds)
      await deferIntegrationTest(db, slot.sourceHash, result.retryAfterSeconds)
    if ((await readStoredState(db)).config.site.configVersion !== expectedVersion) {
      response.status = 'stale'
      response.code = 'SOURCE_CHANGED'
      response.protocolMatched = false
      response.capabilities = declaredCapabilities(source.provider)
      response.summary = { items: 0, views: 0 }
    } else if (
      !response.code &&
      response.protocolMatched &&
      ['ok', 'stale', 'offline'].includes(response.status)
    ) {
      response.connectionProof = await issueSourceTestProof(
        { ...draft, access: source.access },
        old,
        session,
        expectedVersion,
      )
    }
  } catch (e) {
    if (e instanceof AuthError) throw e
    if (!(e instanceof AdapterError)) throw new AuthError(503, 'TEST_UNAVAILABLE')
    response.code = e.code
    response.status = e.code === 'UNSUPPORTED_PROTOCOL' ? 'unsupported' : 'error'
  } finally {
    secret = undefined
    // Release references to the submitted replacement; never include input in an error or response.
    draft.credential = { operation: 'keep' }
    if (slot) await releaseIntegrationTest(db, slot)
  }
  return ProbeResultSchema.parse(response)
}

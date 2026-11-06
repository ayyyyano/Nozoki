import { ProbeResultSchema, type ProbeResult } from '../../shared/contracts/adapter.ts'
import { IdSchema } from '../../shared/contracts/config.ts'
import { readIntegration } from '../repositories/integrations.ts'
import type { Database } from '../types/database.ts'
import { credentialState } from './credentials.ts'
import { selectedAdapter } from '../adapters/registry.ts'
import { AdapterError, type AdapterRead } from '../adapters/types.ts'
import { readConfig } from './config.ts'
import { declaredCapabilities } from '../adapters/capabilities.ts'
import {
  reserveIntegrationTest,
  releaseIntegrationTest,
  deferIntegrationTest,
} from './integration-test-limits.ts'
import type { AuthSession } from './sessions.ts'
import { AuthError } from './auth-settings.ts'
import { readManagedSource } from '../collection/managed-read.ts'
import { collectionEnvironmentMatches } from '../collection/environment.ts'
export function applyProbeResult(
  response: ProbeResult,
  result: AdapterRead,
  requiresAuthentication: boolean,
) {
  response.status = result.status
  response.capabilities = result.capabilities
  response.observedAt = result.observedAt
  response.code = result.code
  response.retryAfterSeconds = result.retryAfterSeconds
  response.protocolMatched = !result.code
  response.reachable =
    !result.code ||
    [
      'AUTH_REQUIRED',
      'NOT_FOUND',
      'RATE_LIMITED',
      'REDIRECT_REJECTED',
      'RESPONSE_TOO_LARGE',
      'INVALID_RESPONSE',
    ].includes(result.code)
      ? true
      : null
  response.authentication =
    result.code === 'AUTH_REQUIRED'
      ? 'rejected'
      : result.code
        ? 'unverified'
        : requiresAuthentication
          ? 'accepted'
          : 'not_required'
  response.summary = { items: result.items, views: Object.keys(result.views).length }
}
export async function testIntegration(
  db: Database,
  id: string,
  session: AuthSession,
  env: Record<string, unknown>,
): Promise<ProbeResult> {
  if (!IdSchema.safeParse(id).success) throw new AuthError(400, 'INVALID_REQUEST')
  const record = await readIntegration(db, id)
  if (!record) throw new AuthError(404, 'INTEGRATION_NOT_FOUND')
  const source = { ...record.settings, credentialState: credentialState(record.envelope) },
    now = new Date()
  const response: ProbeResult = {
    sourceId: id,
    provider: source.provider,
    protocolVersion: source.protocolVersion,
    configVersion: record.configVersion,
    status: 'error',
    reachable: null,
    protocolMatched: false,
    authentication: 'unverified',
    capabilities: declaredCapabilities(source.provider),
    observedAt: null,
    collectedAt: now.toISOString(),
    summary: { items: 0, views: 0 },
  }
  let slot: Awaited<ReturnType<typeof reserveIntegrationTest>> | undefined
  let requiresAuthentication = source.provider === 'cliproxy-bridge'
  try {
    if (!source.enabled) throw new AdapterError('SOURCE_DISABLED')
    if (!source.baseUrl) throw new AdapterError('NOT_CONFIGURED')
    slot = await reserveIntegrationTest(db, session, id, now)
    selectedAdapter(source)
    const quoteSymbols =
      source.provider === 'quotes-custom'
        ? (await readConfig(db)).quotes
            .filter((q) => q.enabled && q.provider === source.id)
            .map(({ market, symbol }) => ({ market, symbol }))
            .slice(0, 1)
        : undefined
    let result: AdapterRead
    if (source.access && source.access.mode !== 'legacy') {
      if ((await collectionEnvironmentMatches(db, env)) === false)
        throw new AdapterError('CONNECTOR_UNAVAILABLE')
      requiresAuthentication = source.access.authentication !== 'none'
      result = await readManagedSource(
        source,
        record.envelope,
        record.identityEnvelope,
        env,
        now,
        'probe',
        { quoteSymbols },
      )
    } else {
      throw new AdapterError('ACCESS_NOT_APPROVED')
    }
    applyProbeResult(response, result, requiresAuthentication)
    if (result.code === 'RATE_LIMITED' && result.retryAfterSeconds)
      await deferIntegrationTest(db, slot.sourceHash, result.retryAfterSeconds)
    const current = await readIntegration(db, id)
    if (!current || current.configVersion !== record.configVersion) {
      response.status = 'stale'
      response.code = 'SOURCE_CHANGED'
      response.protocolMatched = false
      response.capabilities = declaredCapabilities(source.provider)
      response.summary = { items: 0, views: 0 }
    }
  } catch (error) {
    if (error instanceof AuthError) throw error
    if (!(error instanceof AdapterError)) throw new AuthError(503, 'TEST_UNAVAILABLE')
    const e = error
    response.code = e.code
    response.status = ['UNSUPPORTED_PROTOCOL', 'TARGET_NOT_APPROVED'].includes(e.code)
      ? 'unsupported'
      : ['SOURCE_DISABLED', 'NOT_CONFIGURED'].includes(e.code)
        ? 'unconfigured'
        : 'error'
  } finally {
    if (slot) await releaseIntegrationTest(db, slot)
  }
  return ProbeResultSchema.parse(response)
}

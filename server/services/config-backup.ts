import type { Database } from '../types/database.ts'
import { readConfig } from './config.ts'
import { createConfigBackup } from '../../shared/domain/config-backup.ts'
import {
  backgroundImageHash,
  decodeBackgroundImage,
} from '../../shared/contracts/background-image.ts'
import { AuthError } from './auth-settings.ts'
import { DataLayerError } from '../types/database.ts'
import { readStoredState } from '../repositories/config.ts'
import { credentialKeys } from './credential-keys.ts'
import { decryptCredential } from './credentials.ts'
import type { BackupHistory } from '../../shared/contracts/config-backup.ts'

export async function exportConfigBackup(
  db: Database,
  options: { includeCredentials?: boolean; includeHistory?: boolean } = {},
  env: Record<string, unknown> = {},
) {
  const state = await readStoredState(db)
  const config = state.config
  const credentials = new Map<string, { credentialPlain?: string; identityPlain?: string }>()
  if (
    options.includeCredentials &&
    state.integrations.some((i) => i.envelope || i.identityEnvelope)
  ) {
    try {
      const keys = await credentialKeys(env)
      for (const source of state.integrations) {
        const { id, provider, protocolVersion } = source.settings
        const entry: { credentialPlain?: string; identityPlain?: string } = {}
        if (source.envelope)
          entry.credentialPlain = await decryptCredential(id, provider, source.envelope, keys)
        if (
          source.identityEnvelope &&
          (provider !== 'cliproxy-bridge' || protocolVersion !== 'cliproxy-v8-accounts')
        )
          throw new Error('INVALID_IDENTITY_ENVELOPE')
        if (
          source.identityEnvelope &&
          provider === 'cliproxy-bridge' &&
          protocolVersion === 'cliproxy-v8-accounts'
        )
          entry.identityPlain = await decryptCredential(
            id,
            provider + ':identity',
            source.identityEnvelope,
            keys,
          )
        credentials.set(id, entry)
      }
    } catch {
      throw new AuthError(500, 'CREDENTIAL_DECRYPT_FAILED')
    }
  }
  let image: string | undefined
  if (config.site.background.source === 'uploaded') {
    const hash = config.site.background.url.slice('/api/background/'.length)
    const row = await db
      .prepare('SELECT data FROM site_background_images WHERE hash=?')
      .bind(hash)
      .first()
    if (!row?.data) throw new DataLayerError('CONFIG_BASELINE_INVALID')
    const bytes =
      row.data instanceof ArrayBuffer
        ? new Uint8Array(row.data)
        : new Uint8Array(row.data as number[])
    let raw = ''
    for (let i = 0; i < bytes.length; i += 8192)
      raw += String.fromCharCode(...bytes.subarray(i, i + 8192))
    image = btoa(raw)
    if (!decodeBackgroundImage(image) || (await backgroundImageHash(bytes)) !== hash)
      throw new DataLayerError('CONFIG_BASELINE_INVALID')
  }
  if ((await readConfig(db)).site.configVersion !== config.site.configVersion)
    throw new AuthError(409, 'CONFIG_CONFLICT')
  const history = options.includeHistory ? await readCollectedHistory(db) : undefined
  return createConfigBackup(config, image, undefined, credentials, history)
}

/** Aggregated, non-secret history rows only; raw snapshots and credentials never join the archive. */
async function readCollectedHistory(db: Database): Promise<BackupHistory> {
  const balances = (
    await db
      .prepare(
        'SELECT source_id,series_revision,currency,observed_at,collected_at,total,granted,topped_up FROM balance_observations ORDER BY collected_at LIMIT 20000',
      )
      .all()
  ).results as {
    source_id: string
    series_revision: string
    currency: string
    observed_at: string | null
    collected_at: string
    total: string
    granted: string
    topped_up: string
  }[]
  const usage = (
    await db
      .prepare(
        'SELECT source_id,day,timezone,currency,dimension,amount,updated_at FROM daily_usage ORDER BY day LIMIT 20000',
      )
      .all()
  ).results as {
    source_id: string
    day: string
    timezone: string
    currency: string
    dimension: string
    amount: string
    updated_at: string
  }[]
  const codex = (
    await db
      .prepare(
        'SELECT source_id,day,input,output,reasoning,cached,total,requests,failed,updated_at FROM codex_usage_days ORDER BY day LIMIT 20000',
      )
      .all()
  ).results as {
    source_id: string
    day: string
    input: number
    output: number
    reasoning: number
    cached: number
    total: number
    requests: number
    failed: number
    updated_at: string
  }[]
  if (balances.length >= 20000 || usage.length >= 20000 || codex.length >= 20000)
    throw new DataLayerError('CONFIG_BASELINE_INVALID')
  return {
    exportedAt: new Date().toISOString(),
    balanceObservations: balances.map((r) => ({
      sourceId: r.source_id,
      seriesRevision: r.series_revision,
      currency: r.currency,
      observedAt: r.observed_at,
      collectedAt: r.collected_at,
      total: r.total,
      granted: r.granted,
      toppedUp: r.topped_up,
    })),
    dailyUsage: usage.map((r) => ({
      sourceId: r.source_id,
      day: r.day,
      timezone: r.timezone,
      currency: r.currency,
      dimension: r.dimension,
      amount: r.amount,
      updatedAt: r.updated_at,
    })),
    codexUsageDays: codex.map((r) => ({
      sourceId: r.source_id,
      day: r.day,
      input: r.input,
      output: r.output,
      reasoning: r.reasoning,
      cached: r.cached,
      total: r.total,
      requests: r.requests,
      failed: r.failed,
      updatedAt: r.updated_at,
    })),
  }
}

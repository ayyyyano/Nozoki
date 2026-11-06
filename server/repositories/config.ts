import { requestStatements, type ConfigRequest } from './config-requests.ts'
import {
  ConfigSchema,
  type Config,
  type ConfigWrite,
  type IntegrationSettings,
} from '../../shared/contracts/config.ts'
import {
  CredentialEnvelopeSchema,
  credentialState,
  type CredentialEnvelope,
} from '../services/credentials.ts'
import { DataLayerError, type Database, type D1Statement } from '../types/database.ts'
import { storageMode, requireWritableStorage, type StorageMode } from './storage-status.ts'
export interface StoredIntegration {
  revision?: string
  identityEnvelope?: CredentialEnvelope | null
  settings: Omit<IntegrationSettings, 'credentialState'>
  envelope: CredentialEnvelope | null
}
export interface StoredState {
  storageMode?: StorageMode
  config: Config
  integrations: StoredIntegration[]
  snapshots: Record<string, unknown>[]
}
const parseJson = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 500000)
    throw new DataLayerError('CONFIG_BASELINE_INVALID')
  return JSON.parse(value) as unknown
}
/** One transactional batch also gives a consistent read across configuration and snapshots. */
export async function readStoredState(
  db: Database,
  withSnapshots: boolean | 'admin' = false,
): Promise<StoredState> {
  try {
    const results = await db.batch([
      db.prepare('SELECT * FROM site_settings'),
      db.prepare('SELECT * FROM dashboard_modules ORDER BY sort_order,id'),
      db.prepare('SELECT * FROM quote_symbols ORDER BY sort_order,id'),
      db.prepare('SELECT * FROM integrations ORDER BY id'),
      db.prepare(
        withSnapshots
          ? `SELECT DISTINCT s.* FROM dashboard_modules m JOIN json_each(m.sources_json) mapping
             JOIN integration_snapshot_views s ON s.source_id=json_extract(mapping.value,'$.sourceId') AND s.subject=json_extract(mapping.value,'$.subject') AND s.module_id=m.id
             WHERE m.enabled=1 ${withSnapshots === 'admin' ? '' : "AND m.visibility='public'"}`
          : 'SELECT * FROM integration_snapshot_views WHERE 0',
      ),
      db.prepare('PRAGMA table_info(dashboard_modules)'),
      db.prepare('PRAGMA table_info(integrations)'),
    ])
    const moduleMode = storageMode(results[5]!.results)
    const mode =
      moduleMode === 'ready' &&
      ['access_json', 'identity_envelope_json'].every((name) =>
        results[6]!.results.some((c) => c.name === name),
      )
        ? 'ready'
        : 'read-only'
    const modules = results[1]!.results
    // The only supported legacy shape is the intact seven-module configuration.
    // Add a disabled in-memory module; never persist or loosen existing ACLs here.
    const legacyIds = ['deepseek', 'devices', 'codex', 'activity', 'quotes', 'links', 'services']
    if (moduleMode === 'read-only') {
      if (
        modules.length !== legacyIds.length ||
        !legacyIds.every((id) => modules.some((m) => m.id === id))
      )
        throw new DataLayerError('CONFIG_BASELINE_INVALID')
      modules.push({
        id: 'tailscale',
        title: 'Tailscale',
        enabled: 0,
        sort_order: Math.min(10000, Math.max(...modules.map((m) => Number(m.sort_order))) + 1),
        visibility: 'admin',
        guest_behavior: 'hidden',
        fields_json: '{}',
        sources_json: '{}',
        ip_visibility: 'admin',
      })
    }
    const sites = results[0]!.results
    if (sites.length === 0) throw new DataLayerError('CONFIG_NOT_INITIALIZED')
    if (sites.length !== 1 || sites[0]!.id !== 1)
      throw new DataLayerError('CONFIG_BASELINE_INVALID')
    const row = sites[0]!
    const integrations: StoredIntegration[] = results[3]!.results.map((i) => ({
      revision:
        typeof i.collection_generation === 'string'
          ? `${i.collection_generation}:${i.collection_revision}`
          : undefined,
      settings: {
        id: i.id as string,
        provider: i.provider as IntegrationSettings['provider'],
        protocolVersion: i.protocol_version as string,
        baseUrl: i.base_url as string | null,
        enabled: i.enabled === 1,
        refreshInterval: i.refresh_interval as number,
        fieldMappings: parseJson(i.field_mappings_json) as IntegrationSettings['fieldMappings'],
        capabilities: parseJson(i.capabilities_json) as IntegrationSettings['capabilities'],
        access: i.access_json ? JSON.parse(String(i.access_json)) : { mode: 'legacy' },
      },
      identityEnvelope: i.identity_envelope_json
        ? CredentialEnvelopeSchema.parse(JSON.parse(String(i.identity_envelope_json)))
        : null,
      envelope:
        i.credential_ciphertext === null
          ? null
          : CredentialEnvelopeSchema.parse({
              algorithm: i.credential_algorithm,
              ciphertext: i.credential_ciphertext,
              iv: i.credential_iv,
              keyVersion: i.credential_key_version,
              updatedAt: i.credential_updated_at,
            }),
    }))
    const config = ConfigSchema.parse({
      contractVersion: 1,
      site: { ...(parseJson(row.settings_json) as object), configVersion: row.config_version },
      links: parseJson(row.links_json),
      modules: modules.map((m) => ({
        id: m.id,
        title: m.title,
        enabled: m.enabled === 1,
        sortOrder: m.sort_order,
        visibility: m.visibility,
        guestBehavior: m.guest_behavior,
        fields: parseJson(m.fields_json),
        sources: parseJson(m.sources_json),
        ...(m.id === 'tailscale' ? { ipVisibility: m.ip_visibility } : {}),
      })),
      quotes: results[2]!.results.map((q) => ({
        market: q.market,
        symbol: q.symbol,
        displayName: q.display_name,
        provider: q.provider,
        sortOrder: q.sort_order,
        enabled: q.enabled === 1,
        refreshInterval: q.refresh_interval,
      })),
      integrations: integrations.map((i) => ({
        ...i.settings,
        credentialState: credentialState(i.envelope),
        ...(i.identityEnvelope ? { identityConfigured: true } : {}),
      })),
    })
    return { config, integrations, snapshots: results[4]!.results, storageMode: mode }
  } catch (e) {
    if (e instanceof DataLayerError) throw e
    if (e instanceof Error && e.message.includes('no such table: site_settings'))
      throw new DataLayerError('CONFIG_NOT_INITIALIZED')
    if (e instanceof Error && e.message.includes('no such table:'))
      throw new DataLayerError('CONFIG_BASELINE_INVALID')
    if (e instanceof SyntaxError || (e instanceof Error && e.name === 'ZodError'))
      throw new DataLayerError('CONFIG_BASELINE_INVALID')
    throw new DataLayerError('DATABASE_ERROR')
  }
}
export interface AuditActor {
  kind: 'system' | 'unattributed' | 'admin'
  id?: string
}
export async function commitConfig(
  db: Database,
  input: ConfigWrite,
  expected: number,
  integrations: StoredIntegration[],
  actor: AuditActor,
  now: string,
  changedFields: string[],
  request?: ConfigRequest,
  changed = true,
) {
  await requireWritableStorage(db)
  const token = crypto.randomUUID(),
    { configVersion: _version, ...site } = input.site
  const statements: D1Statement[] = [
    ...(request ? requestStatements(db, request, expected + (changed ? 1 : 0), changed, now) : []),
    db
      .prepare('INSERT INTO config_write_guard(id,token,expected_version) VALUES(1,?,?)')
      .bind(token, expected),
    db
      .prepare(
        'UPDATE site_settings SET config_version=?,settings_json=?,links_json=?,write_token=?,updated_at=? WHERE id=1',
      )
      .bind(expected + 1, JSON.stringify(site), JSON.stringify(input.links), token, now),
  ]
  if (!changed) {
    await db.batch([
      ...statements.slice(0, -1),
      db.prepare('DELETE FROM config_write_guard WHERE id=1 AND token=?').bind(token),
    ])
    return
  }
  for (const i of integrations)
    statements.push(
      db
        .prepare(
          `INSERT INTO integrations(id,provider,protocol_version,base_url,enabled,refresh_interval,field_mappings_json,capabilities_json,credential_ciphertext,credential_iv,credential_key_version,credential_algorithm,credential_updated_at,access_json,identity_envelope_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,protocol_version=excluded.protocol_version,base_url=excluded.base_url,enabled=excluded.enabled,refresh_interval=excluded.refresh_interval,field_mappings_json=excluded.field_mappings_json,capabilities_json=excluded.capabilities_json,credential_ciphertext=excluded.credential_ciphertext,credential_iv=excluded.credential_iv,credential_key_version=excluded.credential_key_version,credential_algorithm=excluded.credential_algorithm,credential_updated_at=excluded.credential_updated_at,access_json=excluded.access_json,identity_envelope_json=excluded.identity_envelope_json`,
        )
        .bind(
          i.settings.id,
          i.settings.provider,
          i.settings.protocolVersion,
          i.settings.baseUrl,
          Number(i.settings.enabled),
          i.settings.refreshInterval,
          JSON.stringify(i.settings.fieldMappings),
          JSON.stringify(i.settings.capabilities),
          i.envelope?.ciphertext ?? null,
          i.envelope?.iv ?? null,
          i.envelope?.keyVersion ?? null,
          i.envelope?.algorithm ?? null,
          i.envelope?.updatedAt ?? null,
          JSON.stringify(i.settings.access ?? { mode: 'legacy' }),
          i.identityEnvelope ? JSON.stringify(i.identityEnvelope) : null,
        ),
    )
  // Only allow-list SQL is constructed here; every dynamic ID/value remains bound.
  if (integrations.length)
    statements.push(
      db
        .prepare(
          `DELETE FROM integrations WHERE id NOT IN (${integrations.map(() => '?').join(',')})`,
        )
        .bind(...integrations.map((i) => i.settings.id)),
    )
  else statements.push(db.prepare('DELETE FROM integrations'))
  for (const m of input.modules)
    statements.push(
      db
        .prepare(
          `INSERT INTO dashboard_modules(id,enabled,title,sort_order,visibility,guest_behavior,fields_json,sources_json,ip_visibility) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,title=excluded.title,sort_order=excluded.sort_order,visibility=excluded.visibility,guest_behavior=excluded.guest_behavior,fields_json=excluded.fields_json,sources_json=excluded.sources_json,ip_visibility=excluded.ip_visibility`,
        )
        .bind(
          m.id,
          Number(m.enabled),
          m.title,
          m.sortOrder,
          m.visibility,
          m.guestBehavior,
          JSON.stringify(m.fields),
          JSON.stringify(m.sources),
          m.ipVisibility ?? 'admin',
        ),
    )
  const quoteIds = input.quotes.map((q) => JSON.stringify([q.market, q.symbol, q.provider]))
  statements.push(
    db
      .prepare('DELETE FROM quote_symbols WHERE id NOT IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(quoteIds)),
  )
  for (const q of input.quotes)
    statements.push(
      db
        .prepare(
          `INSERT INTO quote_symbols(id,market,symbol,display_name,provider,sort_order,enabled,refresh_interval) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,sort_order=excluded.sort_order,
 enabled=excluded.enabled,refresh_interval=excluded.refresh_interval
 WHERE display_name IS NOT excluded.display_name OR sort_order IS NOT excluded.sort_order
 OR enabled IS NOT excluded.enabled OR refresh_interval IS NOT excluded.refresh_interval`,
        )
        .bind(
          JSON.stringify([q.market, q.symbol, q.provider]),
          q.market,
          q.symbol,
          q.displayName,
          q.provider,
          q.sortOrder,
          Number(q.enabled),
          q.refreshInterval,
        ),
    )
  statements.push(
    db
      .prepare(
        'INSERT INTO integration_audit(id,operation,config_version,changed_fields_json,actor_kind,actor_id,result,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        'config_save',
        expected + 1,
        JSON.stringify(changedFields),
        actor.kind,
        actor.id ?? null,
        'success',
        now,
      ),
  )
  statements.push(db.prepare('DELETE FROM config_write_guard WHERE id=1 AND token=?').bind(token))
  await db.batch(statements)
}

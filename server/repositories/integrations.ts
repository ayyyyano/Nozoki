import { IntegrationSettingsSchema } from '../../shared/contracts/config.ts'
import { CredentialEnvelopeSchema, credentialState } from '../services/credentials.ts'
import type { Database } from '../types/database.ts'
import type { StoredIntegration } from './config.ts'
export async function readIntegration(
  db: Database,
  id: string,
): Promise<(StoredIntegration & { configVersion: number }) | null> {
  const row = await db
    .prepare(
      'SELECT i.*,s.config_version FROM integrations i JOIN site_settings s ON s.id=1 WHERE i.id=?',
    )
    .bind(id)
    .first()
  if (!row) return null
  const envelope =
    row.credential_ciphertext === null
      ? null
      : CredentialEnvelopeSchema.parse({
          algorithm: row.credential_algorithm,
          ciphertext: row.credential_ciphertext,
          iv: row.credential_iv,
          keyVersion: row.credential_key_version,
          updatedAt: row.credential_updated_at,
        })
  const settings = IntegrationSettingsSchema.parse({
    id: row.id,
    provider: row.provider,
    protocolVersion: row.protocol_version,
    baseUrl: row.base_url,
    enabled: row.enabled === 1,
    refreshInterval: row.refresh_interval,
    fieldMappings: JSON.parse(String(row.field_mappings_json)),
    capabilities: JSON.parse(String(row.capabilities_json)),
    credentialState: credentialState(envelope),
  })
  const { credentialState: _state, ...safe } = settings
  return { settings: safe, envelope, configVersion: Number(row.config_version) }
}

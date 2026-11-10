import { editableConfig } from '../../shared/contracts/admin.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { credentialKeys } from '../../server/services/credential-keys.ts'
import type { Database } from '../../server/types/database.ts'
export async function setupUsageConfig(db: Database, env: Record<string, unknown>) {
  const current = await readConfig(db),
    config = editableConfig(current)
  const source = {
    id: 'usage-fixture',
    provider: 'cliproxy-bridge' as const,
    protocolVersion: 'cliproxy-v8-accounts',
    baseUrl: 'https://usage.example.com/',
    enabled: true,
    refreshInterval: 60,
    fieldMappings: {},
    capabilities: {},
    credential: { operation: 'replace' as const, value: 'SYNTHETIC-MANAGEMENT-ONLY' },
    access: {
      mode: 'public' as const,
      authentication: 'bearer' as const,
      approved: true,
      approvedTarget: null as string | null,
    },
  }
  source.access.approvedTarget = sourceTargetKey(source, source.access)
  config.integrations = [source]
  config.quotes = []
  for (const module of config.modules) {
    module.sources = {}
    module.enabled = module.id === 'codex'
    if (module.id === 'codex') {
      module.sources.main = { sourceId: source.id, subject: 'default' }
      module.visibility = 'admin'
      module.guestBehavior = 'login_hint'
      module.fields = {}
    }
  }
  const result = await saveConfig(
    db,
    { expectedVersion: current.site.configVersion, config },
    { actor: { kind: 'system' }, keys: await credentialKeys(env) },
  )
  if (!result.success) throw new Error('SYNTHETIC_CONFIG_SETUP_FAILED')
}

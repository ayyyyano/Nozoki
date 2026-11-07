import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDefaultConfig,
  type Config,
  type IntegrationSettings,
} from '../../shared/contracts/config.ts'
import {
  createConfigBackup,
  prepareConfigImport,
  globalDefaultConfig,
} from '../../shared/domain/config-backup.ts'
import { BACKUP_FILE_LIMIT } from '../../shared/contracts/config-backup.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { requiresSourceTest } from '../../shared/integration-presets/connection.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { backgroundFixture } from '../fixtures/background.ts'
import {
  decodeBackgroundImage,
  backgroundImageHash,
} from '../../shared/contracts/background-image.ts'

function add(config: Config, kind: string) {
  const draft = createIntegrationDraft(kind, [], 'fixture')
  const { credential: _credential, ...settings } = draft
  const source: IntegrationSettings = {
    ...settings,
    baseUrl: draft.baseUrl ?? 'https://fixture.example.com/',
    enabled: true,
    credentialState: {
      configured: true,
      keyVersion: 'v1',
      lastUpdatedAt: '2026-11-07T00:00:00.000Z',
    },
  }
  if (source.access?.mode !== 'public') throw new Error()
  source.access.approved = true
  source.access.approvedTarget = sourceTargetKey(source, source.access)
  config.integrations.push(source)
  return source
}
test('backup is versioned, allowlisted, and never includes credential state, approval or capabilities', async () => {
  const config = createDefaultConfig()
  add(config, 'deepseek')
  const backup = createConfigBackup(config)
  const wire = JSON.stringify(backup)
  for (const key of [
    'credentialState',
    'credential',
    'keyVersion',
    'capabilities',
    'approvedTarget',
    'access',
    'identityConfigured',
    'configVersion',
  ])
    assert.ok(!wire.includes('"' + key + '"'), key)
  const plan = await prepareConfigImport(wire, config)
  assert.equal(plan.config.site.configVersion, config.site.configVersion)
  assert.ok(plan.config.integrations.every((s) => s.credential.operation === 'keep'))
  assert.ok(
    plan.config.integrations.every(
      (s) =>
        !requiresSourceTest(
          s,
          config.integrations.find((old) => old.id === s.id),
        ),
    ),
  )
})
test('new source imports require testing and conservatively reset instance-specific permissions', async () => {
  const exported = createDefaultConfig()
  const source = add(exported, 'sleepy')
  source.id = 'old-sleepy'
  const module = exported.modules.find((m) => m.id === 'devices')!
  module.visibility = 'public'
  module.sources = {} // Auto binding must apply the privacy guard even without backup references.
  module.fields = {
    '/devices/@private/name': { enabled: false, visibility: 'admin' },
    '/devices/*/batteryPercent': { enabled: true, visibility: 'public' },
  }
  const plan = await prepareConfigImport(
    JSON.stringify(createConfigBackup(exported)),
    createDefaultConfig(),
  )
  const next = plan.config.integrations.find((s) => s.provider === 'sleepy')!
  assert.equal(next.id, 'sleepy')
  assert.equal(next.access?.mode === 'public' && next.access.approved, false)
  assert.equal(requiresSourceTest(next), true)
  const devices = plan.config.modules.find((m) => m.id === 'devices')!
  assert.equal(devices.visibility, 'admin')
  assert.deepEqual(devices.fields, {
    '/devices/*/batteryPercent': { enabled: true, visibility: 'admin' },
  })
  assert.deepEqual(plan.restrictedModules, [module.title])
})
test('address changes cannot inherit authorization or a saved secret; omitted sources remain disabled', async () => {
  const baseline = createDefaultConfig()
  const deep = add(baseline, 'deepseek')
  const sleepy = add(baseline, 'sleepy')
  const backup = createConfigBackup(baseline)
  backup.config.integrations = backup.config.integrations.filter((s) => s.id !== deep.id)
  backup.config.integrations.find((s) => s.id === sleepy.id)!.baseUrl =
    'https://changed.example.com/'
  const plan = await prepareConfigImport(JSON.stringify(backup), baseline)
  assert.equal(plan.retainedSources, 1)
  assert.equal(plan.config.integrations.find((s) => s.id === deep.id)!.enabled, false)
  const changed = plan.config.integrations.find((s) => s.id === sleepy.id)!
  assert.equal(changed.credential.operation, 'clear')
  assert.equal(changed.access?.mode === 'public' && changed.access.approved, false)
  assert.equal(requiresSourceTest(changed, sleepy), true)
  assert.equal(sleepy.baseUrl, 'https://fixture.example.com/')
})

test('foreign item permissions cannot publish existing instance data', async () => {
  const baseline = createDefaultConfig()
  add(baseline, 'sleepy')
  const backup = createConfigBackup(baseline)
  const module = backup.config.modules.find((m) => m.id === 'devices')!
  module.visibility = 'public'
  module.fields = { '/devices/@private/name': { enabled: true, visibility: 'public' } }
  const plan = await prepareConfigImport(JSON.stringify(backup), baseline)
  const devices = plan.config.modules.find((m) => m.id === 'devices')!
  assert.equal(devices.visibility, 'admin')
  assert.deepEqual(devices.fields, {})
  assert.ok(plan.config.integrations.every((s) => s.credential.operation === 'keep'))
  assert.deepEqual(plan.restrictedModules, [module.title])
})
test('uploaded wallpaper is portable and its bytes must match its content address', async () => {
  const config = createDefaultConfig()
  config.site.background.source = 'uploaded'
  config.site.background.url =
    '/api/background/' + (await backgroundImageHash(decodeBackgroundImage(backgroundFixture)!))
  const backup = createConfigBackup(config, backgroundFixture)
  const plan = await prepareConfigImport(JSON.stringify(backup), createDefaultConfig())
  assert.equal(plan.backgroundUpload?.data, backgroundFixture)
  delete backup.backgroundImage
  await assert.rejects(prepareConfigImport(JSON.stringify(backup), config), /BACKUP_INVALID_IMAGE/)
})
test('invalid versions, secrets, duplicate types, hostile targets and oversized files are rejected', async () => {
  const config = createDefaultConfig()
  for (const mutate of [
    (value: any) => {
      value.version = 2
    },
    (value: any) => {
      value.config.integrations[0].credential = { operation: 'replace', value: 'secret' }
    },
    (value: any) => {
      value.config.integrations.push({ ...value.config.integrations[0], id: 'duplicate' })
    },
    (value: any) => {
      value.config.integrations[0].baseUrl = 'https://127.0.0.1/'
    },
    (value: any) => {
      value.config.site.siteName = ''
    },
  ]) {
    const backup = createConfigBackup(config)
    mutate(backup)
    await assert.rejects(prepareConfigImport(JSON.stringify(backup), config))
  }
  await assert.rejects(
    prepareConfigImport(' '.repeat(BACKUP_FILE_LIMIT + 1), config),
    /BACKUP_TOO_LARGE/,
  )
})
test('global defaults keep source IDs, credentials, history bindings and current CAS version', () => {
  const config = createDefaultConfig()
  const sleepy = add(config, 'sleepy')
  config.site.siteName = 'Custom'
  config.site.configVersion = 12
  const reset = globalDefaultConfig(config)
  assert.equal(reset.site.configVersion, 12)
  assert.equal(reset.site.siteName, 'Nozoki')
  assert.equal(reset.integrations.find((s) => s.id === sleepy.id)!.credential.operation, 'keep')
  assert.equal(reset.integrations.find((s) => s.id === sleepy.id)!.enabled, false)
  config.integrations = []
  assert.deepEqual(globalDefaultConfig(config).integrations, [])
})

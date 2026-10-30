import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
const require = createRequire(import.meta.url),
  { getPlatformProxy } = require('wrangler')
const file = '.wrangler/test-results/phase-02/preview-persistence.json'
await mkdir('.wrangler/test-results/phase-02', { recursive: true })
const platform = await getPlatformProxy({
  configPath: resolve('wrangler.jsonc'),
  persist: { path: resolve('.wrangler/state/v3') },
  remoteBindings: false,
})
const toWrite = (c) => ({
  ...structuredClone(c),
  integrations: c.integrations.map(({ credentialState: _metadata, ...i }) => ({
    ...i,
    credential: { operation: 'keep' },
  })),
})
try {
  const c = await readConfig(platform.env.DB),
    config = toWrite(c)
  if (process.argv[2] === 'write') {
    const marker = `Nozoki local persistence ${Date.now()}`
    config.site.siteName = marker
    const result = await saveConfig(
      platform.env.DB,
      { expectedVersion: c.site.configVersion, config },
      { actor: { kind: 'system', id: 'local-preview-test' } },
    )
    assert.equal(result.success, true)
    await writeFile(
      file,
      JSON.stringify(
        {
          originalName: c.site.siteName,
          marker,
          savedVersion: result.configVersion,
          persistenceRoot: resolve('.wrangler/state/v3'),
        },
        null,
        2,
      ),
    )
    console.log('Temporary local persistence record saved')
  } else if (process.argv[2] === 'restore') {
    const probe = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(c.site.siteName, probe.marker, 'Preserve any newer user change')
    assert.equal(
      c.site.configVersion,
      probe.restoreExpectedVersion ?? probe.savedVersion,
      'Preserve any newer user version',
    )
    config.site.siteName = probe.originalName
    const restored = await saveConfig(
      platform.env.DB,
      { expectedVersion: c.site.configVersion, config },
      { actor: { kind: 'system', id: 'local-preview-test' } },
    )
    assert.equal(restored.success, true)
    await writeFile(
      file,
      JSON.stringify(
        { ...probe, restored: true, restoredVersion: restored.configVersion },
        null,
        2,
      ),
    )
    console.log('Original site name restored with CAS')
  } else if (process.argv[2] === 'verify-restored') {
    const probe = JSON.parse(await readFile(file, 'utf8')),
      expected = createDefaultConfig()
    expected.site.configVersion = probe.restoredVersion
    assert.deepEqual(c, expected)
    await writeFile(
      '.wrangler/test-results/phase-02/restore-verified.json',
      JSON.stringify(
        {
          verified: true,
          siteName: c.site.siteName,
          configVersion: c.site.configVersion,
          allContentMatchesDefault: true,
        },
        null,
        2,
      ),
    )
    console.log('Restoration verified against all default configuration content')
  } else {
    const probe = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(c.site.siteName, probe.marker)
    console.log('Local binding sees the persisted record')
  }
} finally {
  await platform.dispose()
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { deployCloudflare } from '../../scripts/deploy-cloudflare.mjs'

test('both explicit deployment commands migrate their own DB before publishing', async () => {
  for (const [target, config] of [
    ['dashboard', 'wrangler.jsonc'],
    ['collector', 'workers/collector/wrangler.jsonc'],
  ]) {
    const calls = []
    await deployCloudflare(target, async (args) => {
      calls.push(args)
    })
    assert.deepEqual(calls, [
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config],
      ['deploy', '--config', config],
    ])
  }
})
test('migration failure prevents deployment, and unknown targets never invoke Wrangler', async () => {
  let calls = 0
  await assert.rejects(
    deployCloudflare('dashboard', async () => {
      calls++
      throw new Error('SYNTHETIC_MIGRATION_FAILURE')
    }),
    /SYNTHETIC_MIGRATION_FAILURE/,
  )
  assert.equal(calls, 1)
  await assert.rejects(
    deployCloudflare('unknown', async () => {
      calls++
    }),
    /INVALID_DEPLOY_TARGET/,
  )
  assert.equal(calls, 1)
})

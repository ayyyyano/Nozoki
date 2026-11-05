import test from 'node:test'
import assert from 'node:assert/strict'
import { deployCloudflare } from '../../scripts/deploy-cloudflare.mjs'

test('the unified deployment migrates its DB before publishing', async () => {
  const config = 'wrangler.jsonc'
  const calls = []
  await deployCloudflare(async (args) => {
    calls.push(args)
  })
  assert.deepEqual(calls, [
    ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config],
    ['deploy', '--config', config],
  ])
})
test('migration failure prevents deployment', async () => {
  let calls = 0
  await assert.rejects(
    deployCloudflare(async () => {
      calls++
      throw new Error('SYNTHETIC_MIGRATION_FAILURE')
    }),
    /SYNTHETIC_MIGRATION_FAILURE/,
  )
  assert.equal(calls, 1)
})

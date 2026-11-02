import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig, ConfigWriteSchema } from '../../shared/contracts/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createTencentSource, createYahooSource } from '../../shared/quotes/defaults.ts'
import { collectionPlans } from '../../server/collection/plans.ts'
import { publicTarget } from '../../server/adapters/public-targets.ts'

test('Tencent defaults are enabled and bound, with Yahoo retained as an optional provider', () => {
  const config = createDefaultConfig(),
    source = config.integrations[0]!
  assert.equal(source.enabled, true)
  assert.equal(source.id, 'tencent')
  assert.equal(source.protocolVersion, 'tencent-us-v1')
  assert.equal(source.capabilities.quote!.verified, false)
  assert.equal(source.credentialState.configured, false)
  assert.deepEqual(publicTarget(source), { baseUrl: source.baseUrl, authentication: 'none' })
  // The query2 mirror is equally approved so rate-limited deployments can switch hosts.
  assert.deepEqual(
    publicTarget({ ...createYahooSource(), baseUrl: 'https://query2.finance.yahoo.com/' }),
    {
      baseUrl: 'https://query2.finance.yahoo.com/',
      authentication: 'none',
    },
  )
  assert.equal(
    publicTarget({ ...source, baseUrl: 'https://query1.finance.yahoo.com/other/' }),
    undefined,
  )
  const plans = () =>
    collectionPlans({
      config,
      integrations: [{ settings: source, envelope: null, revision: 'seed:1' }],
      snapshots: [],
    })
  assert.ok(ConfigWriteSchema.safeParse(editableConfig(config)).success)
  assert.equal(plans()[0]!.quoteSymbols!.length, 2)
  source.enabled = false
  assert.deepEqual(plans(), [])
  source.fieldMappings.modified = 'field'
  assert.deepEqual(createTencentSource().fieldMappings, {})
})

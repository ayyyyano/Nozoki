import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig, ConfigWriteSchema } from '../../shared/contracts/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createYahooSource } from '../../shared/quotes/defaults.ts'
import { collectionPlans } from '../../server/collection/plans.ts'
import { publicTarget } from '../../server/adapters/public-targets.ts'

test('Yahoo defaults are enabled and bound, with no credential or deployment route required', () => {
  const config = createDefaultConfig(),
    source = config.integrations[0]!
  assert.equal(source.enabled, true)
  assert.equal(source.protocolVersion, 'yahoo-chart-v8')
  assert.equal(source.capabilities.quote!.verified, false)
  assert.equal(source.credentialState.configured, false)
  assert.deepEqual(publicTarget(source), { baseUrl: source.baseUrl, authentication: 'none' })
  assert.equal(publicTarget({ ...source, baseUrl: 'https://query2.finance.yahoo.com/' }), undefined)
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
  assert.deepEqual(createYahooSource().fieldMappings, {})
})

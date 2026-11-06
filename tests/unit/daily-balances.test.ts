import test from 'node:test'
import assert from 'node:assert/strict'
import { balanceDays, nextBalanceCollection } from '../../shared/domain/daily-balances.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { snapshot } from '../../shared/domain/dashboard.ts'
import { DataSchemas } from '../../shared/contracts/snapshots.ts'
import { source } from '../fixtures/adapters.ts'

test('seven local balance dates handle Shanghai, New York DST and midnight without fixed-day assumptions', () => {
  const days = balanceDays(new Date('2026-11-06T16:00:00Z'), 'Asia/Shanghai')
  assert.equal(days.length, 7)
  assert.equal(days.at(-1)!.day, '2026-11-07')
  assert.equal(days.at(-1)!.start, '2026-11-06T16:00:00.000Z')
  for (const [at, day, hours] of [
    ['2026-03-09T00:00:00Z', '2026-03-08', 23],
    ['2026-11-02T00:00:00Z', '2026-11-01', 25],
  ] as const) {
    const d = balanceDays(new Date(at), 'America/New_York').find((d) => d.day === day)!
    assert.equal((Date.parse(d.end) - Date.parse(d.start)) / 3600000, hours)
  }
  assert.equal(
    nextBalanceCollection(Date.parse('2026-11-06T10:00:00Z'), 86400, 'Asia/Shanghai'),
    '2026-11-06T15:55:00.000Z',
  )
  assert.equal(
    nextBalanceCollection(Date.parse('2026-11-06T15:55:02Z'), 86400, 'Asia/Shanghai'),
    '2026-11-06T16:00:00.000Z',
  )
  assert.equal(
    nextBalanceCollection(Date.parse('2026-11-06T10:00:00Z'), 300, 'Asia/Shanghai'),
    '2026-11-06T10:05:00.000Z',
  )
})
test('guest blur is a constant redacted card independent of data, ACL, source state and private changes', async () => {
  const config = createDefaultConfig(),
    module = config.modules.find((m) => m.id === 'deepseek')!
  module.guestBlur = true
  module.visibility = 'admin'
  module.guestBehavior = 'hidden'
  const state = { config, integrations: [], snapshots: [] }
  const first = await projectGuestDashboard(state)
  const card = first.modules.find((m) => m.id === 'deepseek')!
  assert.equal(card.kind, 'data')
  if (card.kind === 'data') assert.deepEqual(card.snapshot.data, { masked: true })
  config.site.configVersion++
  module.fields = { balance: { enabled: false, visibility: 'admin' } }
  const second = await projectGuestDashboard(state)
  assert.equal(first.configVersion, second.configVersion)
  module.enabled = false
  assert.equal(
    (await projectGuestDashboard(state)).modules.some((m) => m.id === 'deepseek'),
    false,
  )
})
test('historical balances cannot reveal a current-balance field hidden by ACL; retired spend is stripped', async () => {
  const config = createDefaultConfig(),
    s = source('deepseek')
  config.integrations = [
    { ...s, credentialState: { configured: true, keyVersion: 'v1', lastUpdatedAt: null } },
  ]
  const m = config.modules.find((m) => m.id === 'deepseek')!
  m.visibility = 'public'
  m.sources = { main: { sourceId: s.id, subject: 'default' } }
  m.fields = { '/balances/*/total': { enabled: true, visibility: 'admin' } }
  const data = {
    balances: [{ currency: 'CNY', total: '987.654321', granted: '0', toppedUp: '987.654321' }],
    dailyBalances: [
      {
        day: '2026-11-06',
        currency: 'CNY',
        total: '987.654321',
        collectedAt: '2026-11-06T00:00:00.000Z',
      },
    ],
    capabilities: {
      balance: { supported: true, verified: true },
      spend: { supported: false, verified: false },
    },
    spend: [{ private: 'OLD-SPEND' }],
  }
  const parsed = DataSchemas.deepseek.parse(data)
  assert.equal(Object.hasOwn(parsed, 'spend'), false)
  const dto = await projectGuestDashboard({
    config,
    integrations: [],
    snapshots: [
      {
        source_id: s.id,
        subject: 'default',
        module_id: 'deepseek',
        snapshot_json: JSON.stringify(snapshot('ok', data, s.id)),
      },
    ],
  })
  const card = dto.modules.find((m) => m.id === 'deepseek')!
  if (card.kind !== 'data') throw new Error('Missing card')
  const body = card.snapshot.data as any
  assert.equal(Object.hasOwn(body.balances[0], 'total'), false)
  assert.equal(Object.hasOwn(body.dailyBalances[0], 'total'), false)
  assert.equal(JSON.stringify(dto).includes('OLD-SPEND'), false)
})

// Synthetic account and observations in disposable SQLite; no real upstream or daily database.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { importCredentialKey } from '../../server/services/credentials.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { readDailyBalances, balanceSeries } from '../../server/services/balance-observations.ts'
import { runCollection } from '../../server/collection/run.ts'
import { deepseek } from '../../server/adapters/deepseek.ts'
import { responseTransport } from '../../server/adapters/transport.ts'
import { source } from '../fixtures/adapters.ts'
import { readGuestDashboard, readAdminDashboard } from '../../server/services/dashboard.ts'

test('daily balance persistence, end-of-day scheduling, seven-day history, account isolation and guest masking', async () => {
  const folder = await mkdtemp(resolve('.wrangler/daily-balances-'))
  const path = resolve(folder, 'test.sqlite')
  let db = new SqliteDatabase(path)
  try {
    await migrateDatabase(db, 'migrations', resolve(folder, 'backups'))
    const keys = await importCredentialKey('v1', crypto.getRandomValues(new Uint8Array(32)))
    const config = editableConfig(await readConfig(db))
    const { credentialState: _state, ...s } = source('deepseek')
    config.integrations = [{ ...s, credential: { operation: 'replace', value: 'SYNTHETIC-ONLY' } }]
    config.modules.find((m) => m.id === 'quotes').sources = {}
    const m = config.modules.find((m) => m.id === 'deepseek')
    m.sources = { main: { sourceId: s.id, subject: 'main' } }
    m.visibility = 'public'
    assert.equal(
      (
        await saveConfig(
          db,
          { config, expectedVersion: config.site.configVersion },
          { actor: { kind: 'system' }, keys },
        )
      ).success,
      true,
    )
    const stored = (await readStoredState(db)).integrations.find((i) => i.settings.id === s.id)
    const series = await balanceSeries(stored.settings, stored.envelope)
    for (const [at, currency, total] of [
      ['2099-10-29T15:55:00.000Z', 'CNY', '999'], // outside seven days
      ['2099-10-30T15:55:00.000Z', 'CNY', '120'],
      ['2099-11-01T15:50:00.000Z', 'CNY', '110'],
      ['2099-11-01T15:55:00.000Z', 'CNY', '109.123456789012345678'],
      ['2099-11-01T16:00:00.000Z', 'CNY', '108'], // next local day
      ['2099-11-01T15:55:00.000Z', 'USD', '0'],
    ])
      await db
        .prepare(
          'INSERT INTO balance_observations(source_id,series_revision,currency,collected_at,total,granted,topped_up,account_series) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(s.id, 'fixture-series', currency, at, total, '0', total, series)
        .run()
    const reader = async (p, _env, _signal, now) =>
      deepseek.read({
        source: p.source,
        now,
        transport: responseTransport(p.source, async () =>
          Response.json({
            is_available: true,
            balance_infos: [
              {
                currency: 'CNY',
                total_balance: '9.60',
                granted_balance: '0',
                topped_up_balance: '9.60',
              },
            ],
          }),
        ),
      })
    const env = { COLLECTOR_EPOCH: '1' }
    const collect = async (at) => {
      const clock = () => new Date(at)
      const report = await runCollection(db, env, clock().getTime(), {
        clock,
        reader,
        sourceIds: [s.id],
      })
      assert.equal(report.fatal, null)
      assert.equal(report.success, 1, JSON.stringify(report))
    }
    await collect('2099-11-05T15:55:00.000Z')
    await collect('2099-11-05T16:00:00.000Z')
    await db.prepare('UPDATE integrations SET refresh_interval=86400 WHERE id=?').bind(s.id).run()
    await collect('2099-11-06T10:00:00.000Z')
    assert.equal(
      (
        await db
          .prepare('SELECT next_run_at FROM collection_state WHERE source_id=?')
          .bind(s.id)
          .first()
      ).next_run_at,
      '2099-11-06T15:55:00.000Z',
    )
    await collect('2099-11-06T15:55:00.000Z')
    const now = new Date('2099-11-06T15:56:00.000Z')
    const history = await readDailyBalances(db, s.id, series, 'Asia/Shanghai', now)
    assert.equal(
      history.find((d) => d.day === '2099-11-01' && d.currency === 'CNY').total,
      '109.123456789012345678',
    )
    assert.equal(history.find((d) => d.day === '2099-11-02').total, '108')
    assert.equal(history.find((d) => d.currency === 'USD').total, '0')
    assert.equal(
      history.some((d) => d.day === '2099-10-29'),
      false,
    )
    assert.equal(
      history.some((d) => d.day === '2099-10-31'),
      false,
    )
    assert.equal(
      (await readDailyBalances(db, s.id, 'different-account', 'Asia/Shanghai', now)).length,
      0,
    )
    const dto = await readGuestDashboard(db, now)
    const card = dto.modules.find((m) => m.id === 'deepseek')
    assert.equal(card.snapshot.data.dailyBalances.at(-1).total, '9.60')
    assert.equal((await db.prepare('SELECT count(*) n FROM daily_usage').first()).n, 0)
    const update = editableConfig(await readConfig(db))
    update.modules.find((m) => m.id === 'deepseek').guestBlur = true
    assert.equal(
      (
        await saveConfig(
          db,
          { config: update, expectedVersion: update.site.configVersion },
          { actor: { kind: 'system' } },
        )
      ).success,
      true,
    )
    db.close()
    db = new SqliteDatabase(path)
    assert.equal((await readConfig(db)).modules.find((m) => m.id === 'deepseek').guestBlur, true)
    const guest = await readGuestDashboard(db, now)
    assert.deepEqual(guest.modules.find((m) => m.id === 'deepseek').snapshot.data, { masked: true })
    const admin = await readAdminDashboard(db, now)
    assert.ok(JSON.stringify(admin).includes('109.123456789012345678'))
    assert.equal(JSON.stringify(guest).includes('109.123456789012345678'), false)
    assert.equal(JSON.stringify(admin).includes('SYNTHETIC-ONLY'), false)
  } finally {
    db.close()
  }
})

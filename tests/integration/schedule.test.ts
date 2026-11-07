import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { readGuestDashboard } from '../../server/services/dashboard.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { evaluateSchedule, normalizeSchedule } from '../../shared/schedule/index.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare'),
  { unstable_splitSqlQuery } = require('wrangler')
const output = process.env.NOZOKI_TEST_EVIDENCE ?? '.wrangler/test-results/phase-07-schedule'
await mkdir(output, { recursive: true })
await mkdir('.wrangler/schedule-tests', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/schedule-tests/run-'))
const options = convertV4MiniflareOptions({
  modules: true,
  script: 'export default {fetch(){return new Response(null,{status:404})}}',
  compatibilityDate: '2026-10-19',
  d1Databases: { DB: 'schedule-isolated' },
})
options.resourcePersistencePath = persist
let mf = new Miniflare(options),
  db = await mf.getD1Database('DB')
const actor = { kind: 'system', id: 'schedule-isolated-test' },
  report = { persist, runtime: wrangler('miniflare/package.json').version, checks: [] }
const baseline = async () => ({
  config: await readConfig(db),
  audits: (await db.prepare('SELECT * FROM integration_audit ORDER BY id').all()).results,
})
const input = async () => {
  const c = await readConfig(db)
  return { expectedVersion: c.site.configVersion, config: editableConfig(c) }
}
test('modular schedules persist with existing D1 config service', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      await fn()
      report.checks.push(name)
    })
  }
  try {
    for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
      await db.batch(
        unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((s) =>
          db.prepare(s),
        ),
      )
    await check('basic and custom state labels persist in the existing settings JSON', async () => {
      const initial = (await readConfig(db)).site.schedule
      const first = await input()
      first.config.site.schedule.labels = { active: '专注中', break: '午间休息' }
      assert.equal((await saveConfig(db, first, { actor })).success, true)
      assert.deepEqual(
        (await readConfig(db)).site.schedule.labels,
        first.config.site.schedule.labels,
      )
      const next = await input()
      next.config.site.schedule = normalizeSchedule(next.config.site.schedule)
      next.config.site.schedule.labels.break = '休息一下'
      assert.equal((await saveConfig(db, next, { actor })).success, true)
      const row = await db.prepare('SELECT settings_json FROM site_settings WHERE id=1').first()
      assert.equal(JSON.parse(row.settings_json).schedule.labels.break, '休息一下')
      const restore = await input()
      restore.config.site.schedule = initial
      assert.equal((await saveConfig(db, restore, { actor })).success, true)
    })
    await check(
      'legacy reads remain unchanged while pure normalization supports evening periods',
      async () => {
        const c = await readConfig(db)
        assert.ok(!('version' in c.site.schedule))
        assert.equal(c.site.schedule.start, '08:30')
        assert.equal(evaluateSchedule(c.site.schedule, '2026-10-26T04:00:00Z').state, 'break')
        const v = await input(),
          p = normalizeSchedule(v.config.site.schedule)
        p.templates.push({
          id: 'classes',
          name: '课程',
          slots: [
            {
              id: 'evening',
              name: 'PRIVATE_CLASS',
              category: 'active',
              start: '18:30',
              end: '20:40',
              startDayOffset: 0,
              endDayOffset: 0,
            },
          ],
        })
        p.weekdays['1'] = { kind: 'template', templateId: 'classes' }
        v.config.site.schedule = p
        assert.equal((await saveConfig(db, v, { actor })).success, true)
        const row = await db.prepare('SELECT settings_json FROM site_settings WHERE id=1').first()
        assert.equal(JSON.parse(row.settings_json).schedule.version, 2)
        assert.equal(
          evaluateSchedule((await readConfig(db)).site.schedule, '2026-10-26T11:00:00Z').current
            .name,
          'PRIVATE_CLASS',
        )
      },
    )
    await check('V2 schedule survives real workerd dispose and restart', async () => {
      const before = await readConfig(db)
      await mf.dispose()
      mf = new Miniflare(options)
      db = await mf.getD1Database('DB')
      assert.deepEqual(await readConfig(db), before)
    })
    await check(
      'two schedule saves on one version have one winner and no mixed names',
      async () => {
        const a = await input(),
          b = structuredClone(a)
        a.config.site.schedule.templates[1].slots[0].name = 'Winner A'
        b.config.site.schedule.templates[1].slots[0].name = 'Winner B'
        const results = await Promise.all([
          saveConfig(db, a, { actor }),
          saveConfig(db, b, { actor }),
        ])
        assert.equal(results.filter((r) => r.success).length, 1)
        assert.equal(results.filter((r) => r.code === 'CONFIG_CONFLICT').length, 1)
        const name = (await readConfig(db)).site.schedule.templates[1].slots[0].name
        assert.equal(name, results[0].success ? 'Winner A' : 'Winner B')
        report.cas = results
      },
    )
    await check(
      'invalid overlaps, missing templates and timezone mismatch never write',
      async () => {
        const before = await baseline()
        for (const mutate of [
          (v) =>
            v.config.site.schedule.templates[1].slots.push({
              ...v.config.site.schedule.templates[1].slots[0],
              id: 'duplicate-time',
            }),
          (v) => v.config.site.schedule.templates.splice(1, 1),
          (v) => (v.config.site.schedule.timezone = 'America/New_York'),
        ]) {
          const v = await input()
          mutate(v)
          assert.equal((await saveConfig(db, v, { actor })).code, 'VALIDATION_ERROR')
          assert.deepEqual(await baseline(), before)
        }
      },
    )
    await check(
      'mid-batch SQL error rolls back schedule, global version and success audit',
      async () => {
        const before = await baseline(),
          v = await input()
        v.config.site.schedule.templates[1].name = 'Must roll back'
        await db
          .prepare(
            "CREATE TRIGGER schedule_test_reject BEFORE UPDATE ON dashboard_modules WHEN NEW.id='services' BEGIN SELECT RAISE(ABORT,'SCHEDULE_TEST'); END",
          )
          .run()
        assert.equal((await saveConfig(db, v, { actor })).code, 'DATABASE_ERROR')
        assert.deepEqual(await baseline(), before)
        await db.prepare('DROP TRIGGER schedule_test_reject').run()
      },
    )
    await check(
      'nested schedule ACLs filter names, exact periods, exceptions and public hashes',
      async () => {
        const v = await input(),
          p = v.config.site.schedule,
          m = v.config.modules.find((m) => m.id === 'activity')
        p.templates[1].slots[0].name = 'PRIVATE_CLASS'
        p.exceptions['2026-10-31'] = {
          name: 'PRIVATE_EXCEPTION',
          rule: { kind: 'template', templateId: 'classes' },
        }
        p.override = { text: 'PRIVATE_OVERRIDE' }
        m.fields = {
          '/schedule/templates/@classes/slots/@evening': { enabled: true, visibility: 'admin' },
          '/schedule/exceptions/*': { enabled: true, visibility: 'admin' },
          '/schedule/override': { enabled: true, visibility: 'admin' },
        }
        assert.equal((await saveConfig(db, v, { actor })).success, true)
        const guest = await readGuestDashboard(db, new Date('2026-10-26T11:00:00Z')),
          json = JSON.stringify(guest)
        for (const marker of ['PRIVATE_CLASS', 'PRIVATE_EXCEPTION', 'PRIVATE_OVERRIDE'])
          assert.ok(!json.includes(marker))
        const next = await input()
        next.config.site.schedule.templates[1].slots[0].name = 'PRIVATE_CHANGED'
        assert.equal((await saveConfig(db, next, { actor })).success, true)
        assert.equal(
          (await readGuestDashboard(db, new Date('2026-10-26T11:00:00Z'))).configVersion,
          guest.configVersion,
        )
      },
    )
    await check(
      'disabled Activity removes all schedule data without changing other modules',
      async () => {
        const before = await readGuestDashboard(db, new Date('2026-10-26T11:00:00Z')),
          v = await input()
        v.config.modules.find((m) => m.id === 'activity').enabled = false
        assert.equal((await saveConfig(db, v, { actor })).success, true)
        const after = await readGuestDashboard(db, new Date('2026-10-26T11:00:00Z'))
        assert.ok(!after.modules.some((m) => m.id === 'activity'))
        assert.deepEqual(
          after.modules,
          before.modules.filter((m) => m.id !== 'activity'),
        )
      },
    )
  } finally {
    await mf.dispose()
    await writeFile(output + '/schedule-d1.json', JSON.stringify(report, null, 2) + '\n')
  }
})

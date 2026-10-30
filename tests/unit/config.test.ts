import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ConfigSchema,
  ConfigWriteSchema,
  SaveConfigSchema,
  ScheduleSchema,
  BackgroundSchema,
  LinkSettingsSchema,
  createDefaultConfig,
} from '../../shared/contracts/config.ts'
import { PublicDashboardSchema } from '../../shared/contracts/public-dashboard.ts'
import { getDatabase } from '../../server/utils/database.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { DataSchemas } from '../../shared/contracts/snapshots.ts'
const asWrite = () => ({ ...createDefaultConfig(), integrations: [] })
test('D1 defaults keep M3/privacy while separating personal browser mode and wallpaper state', () => {
  const c = createDefaultConfig()
  assert.equal(c.site.siteName, 'Nozoki')
  assert.equal(c.site.appearance.sourceColor, '#6750A4')
  assert.equal(c.site.background.cardOpacity, 50)
  assert.equal(c.site.background.cardBlur, 8)
  for (const id of ['deepseek', 'devices', 'codex', 'services'])
    assert.equal(c.modules.find((m) => m.id === id)!.visibility, 'admin')
  assert.ok(!('mode' in c.site.appearance))
  assert.ok(!('reduceMotion' in c.site.appearance))
  assert.ok(!('displayMode' in c.site))
  assert.ok(c.quotes.every((q) => q.provider === null))
  assert.equal(c.integrations.length, 0)
  assert.deepEqual(
    c.links.map(({ id, title, url, visibility }) => ({ id, title, url, visibility })),
    [
      { id: 'blog', title: '博客', url: 'https://blog.nekro.top/', visibility: 'public' },
      { id: 'projects', title: '项目', url: 'https://github.com/ayyyyano', visibility: 'public' },
      { id: 'home', title: '主页', url: 'https://www.nekro.top/', visibility: 'public' },
      { id: 'about', title: '关于', url: 'https://blog.nekro.top/about/', visibility: 'public' },
    ],
  )
  const { visibility: _visibility, ...link } = c.links[0]!
  assert.equal(LinkSettingsSchema.parse(link).visibility, 'public')
})
test('shared appearance only accepts M3 and normalizes RGB without importing browser storage', () => {
  const c = createDefaultConfig()
  c.site.appearance.sourceColor = 'rgb(103, 80, 164)'
  assert.equal(ConfigSchema.parse(c).site.appearance.sourceColor, '#6750A4')
  assert.equal(
    ConfigSchema.safeParse({
      ...c,
      site: { ...c.site, appearance: { ...c.site.appearance, design: 'm2' } },
    }).success,
    false,
  )
  assert.equal(
    BackgroundSchema.safeParse({
      ...c.site.background,
      url: 'https://user:secret@example.com/',
      source: 'custom',
    }).success,
    false,
  )
})
test('runtime schemas reject unknown fields, duplicate modules and loosening nested ACLs', () => {
  const c = asWrite()
  assert.equal(ConfigWriteSchema.safeParse({ ...c, unexpected: 1 }).success, false)
  c.modules[0]!.fields = { balance: { enabled: true, visibility: 'public' } }
  assert.equal(ConfigWriteSchema.safeParse(c).success, false)
  const d = asWrite(),
    m = d.modules.find((v) => v.id === 'devices')!
  m.visibility = 'public'
  m.fields = {
    'devices.*': { enabled: true, visibility: 'admin' },
    'devices.@private.stateText': { enabled: true, visibility: 'public' },
  }
  assert.equal(ConfigWriteSchema.safeParse(d).success, false)
  m.fields = { notAField: { enabled: true, visibility: 'admin' } }
  assert.equal(ConfigWriteSchema.safeParse(d).success, false)
})
test('shared schedules reuse verified boundaries, overnight behavior and IANA validation', () => {
  const s = createDefaultConfig().site.schedule
  assert.ok(ScheduleSchema.safeParse(s).success)
  assert.equal(ScheduleSchema.safeParse({ ...s, timezone: 'not-a-zone' }).success, false)
  assert.equal(ScheduleSchema.safeParse({ ...s, end: s.start }).success, false)
  assert.ok(
    ScheduleSchema.safeParse({
      ...s,
      start: '22:00',
      end: '06:00',
      lunchStart: '01:00',
      lunchEnd: '02:00',
    }).success,
  )
})
test('expectedVersion must equal submitted baseline and duplicates with null provider are rejected', () => {
  const c = asWrite()
  assert.equal(SaveConfigSchema.safeParse({ expectedVersion: 2, config: c }).success, false)
  c.quotes.push({ ...c.quotes[0]! })
  assert.equal(ConfigWriteSchema.safeParse(c).success, false)
})
test('missing actual Workers binding is explicit and never creates a memory database', () => {
  assert.throws(() => getDatabase({ context: {} }), /DB_BINDING_MISSING/)
})
test('public background omits unused URLs and link snapshots keep the validated HTTP/HTTPS contract', async () => {
  const c = createDefaultConfig()
  c.site.background.url = 'https://unused-private.invalid/'
  const state = { config: c, integrations: [], snapshots: [] },
    first = await projectGuestDashboard(state)
  assert.equal(first.site.background.url, '')
  assert.ok(!JSON.stringify(first).includes('unused-private'))
  c.site.background.url = 'https://another-unused-private.invalid/'
  assert.equal((await projectGuestDashboard(state)).configVersion, first.configVersion)
  const link = {
    id: 'example',
    title: 'Example',
    url: 'http://example.invalid/',
    icon: 'link',
    sortOrder: 0,
  }
  assert.ok(DataSchemas.links.safeParse({ items: [link] }).success)
  assert.equal(
    DataSchemas.links.safeParse({ items: [{ ...link, url: 'javascript:alert(1)' }] }).success,
    false,
  )
})
test('guest public version ignores private links, sources, global versions and private nested config', async () => {
  const config = createDefaultConfig(),
    state = { config, integrations: [], snapshots: [] }
  config.modules.find((m) => m.id === 'links')!.fields = {
    'items.@projects': { enabled: true, visibility: 'admin' },
  }
  const first = await projectGuestDashboard(state, new Date('2026-10-26T00:00:00.000Z'))
  config.site.configVersion++
  config.links.find((l) => l.id === 'projects')!.url = 'https://private-change.invalid/'
  config.modules.find((m) => m.id === 'services')!.guestBehavior = 'hidden'
  // Removing a visible login hint is a public change; establish the new public baseline first.
  const baseline = await projectGuestDashboard(state, new Date('2026-10-26T00:00:00.000Z'))
  config.site.configVersion++
  config.links.find((l) => l.id === 'projects')!.url = 'https://another-private-change.invalid/'
  const second = await projectGuestDashboard(state, new Date('2026-10-27T00:00:00.000Z'))
  assert.equal(baseline.configVersion, second.configVersion)
  assert.ok(PublicDashboardSchema.safeParse(first).success)
  assert.ok(!JSON.stringify(second).includes('private-change'))
  assert.equal(PublicDashboardSchema.safeParse({ ...second, viewer: 'admin' }).success, false)
})

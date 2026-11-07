// Production Modules Worker + isolated real D1; synthetic Sleepy JSON never touches daily D1.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { source } from '../fixtures/adapters.ts'
import { devicesNow, sleepyDevicesFixture } from '../fixtures/devices0511.ts'
import { runAdapter } from '../../server/adapters/registry.ts'
import { responseTransport } from '../../server/adapters/transport.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'
import { launch, settle } from '../browser/support.ts'
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = process.env.NOZOKI_TEST_MINIFLARE
  ? require(resolve(process.env.NOZOKI_TEST_MINIFLARE))
  : wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
const evidence = '.wrangler/test-results/phase-05.1.1',
  root = resolve('.output/server'),
  origin = 'http://127.0.0.1:8795'
await mkdir('.wrangler/phase0511-http', { recursive: true })
const persist = await mkdtemp(resolve('.wrangler/phase0511-http/run-'))
async function walk(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)],
      ),
    )
  ).flat()
}
const modules = (await walk(root))
  .filter((p) => p.endsWith('.mjs'))
  .sort((a, b) =>
    a === resolve(root, 'index.mjs')
      ? -1
      : b === resolve(root, 'index.mjs')
        ? 1
        : a.localeCompare(b),
  )
  .map((path) => ({ type: 'ESModule', path }))
let network = 0,
  browser
const options = convertV4MiniflareOptions({
  modules,
  modulesRoot: root,
  port: 8795,
  host: '127.0.0.1',
  compatibilityDate: '2026-10-19',
  compatibilityFlags: ['nodejs_compat'],
  bindings: {},
  d1Databases: { DB: 'devices0511' },
  outboundService: async () => {
    network++
    throw new Error('Unexpected network')
  },
  assets: {
    directory: resolve('.output/public'),
    routerConfig: { has_user_worker: true },
    assetConfig: {},
  },
})
options.resourcePersistencePath = persist
const mf = new Miniflare(options),
  report = {
    runtime: 'production Modules Worker + real D1; isolated Miniflare copy; offline JSON only',
    persist,
    checks: [],
    geometry: [],
  }
let db
const check = async (name, fn) => {
  await fn()
  report.checks.push(name)
}
const save = async (mutator) => {
  const config = await readConfig(db),
    draft = editableConfig(config)
  mutator(draft)
  const result = await saveConfig(
    db,
    { expectedVersion: config.site.configVersion, config: draft },
    { actor: { kind: 'system' } },
  )
  assert.equal(result.success, true, JSON.stringify(result))
}
const privateItem = fieldPointer(['devices', '@private.a/~'])
const dashboard = async () => (await mf.dispatchFetch(origin + '/api/dashboard')).json()
try {
  await mf.ready
  db = await mf.getD1Database('DB')
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await db.batch(
      unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
        db.prepare(sql),
      ),
    )
  const s = source('sleepy'),
    { credentialState: _, ...settings } = s
  await save((c) => {
    c.site.siteName = '离线设备展示 · 演示数据'
    c.modules.find((m) => m.id === 'quotes').sources = {}
    c.integrations = [{ ...settings, credential: { operation: 'keep' } }]
    const m = c.modules.find((m) => m.id === 'devices')
    m.visibility = 'public'
    m.title = '设备 · 离线演示'
    m.sources = { main: { sourceId: s.id, subject: 'default' } }
    m.fields = { [privateItem]: { enabled: true, visibility: 'admin' } }
  })
  const result = await runAdapter({
    source: s,
    now: devicesNow,
    transport: responseTransport(s, async () => Response.json(sleepyDevicesFixture())),
  })
  assert.equal(result.status, 'ok')
  const snapshot = result.views.devices
  const store = () =>
    upsertSnapshot(db, {
      sourceId: s.id,
      subject: 'default',
      moduleId: 'devices',
      snapshot,
      updatedAt: new Date().toISOString(),
    })
  await store()
  await check(
    'real D1 retains normalized mixed optional batteries and guest never receives private item',
    async () => {
      const dto = await dashboard(),
        json = JSON.stringify(dto)
      assert.ok(!json.includes('PRIVATE-DEVICE'))
      assert.ok(!json.includes('PRIVATE-APPLICATION'))
      const devices = dto.modules.find((m) => m.id === 'devices').snapshot.data.devices
      assert.deepEqual(
        devices.slice(0, 4).map((d) => d.batteryPercent),
        [66, 0, 100, null],
      )
      assert.ok(devices.every((d) => d.charging === null))
      assert.ok(!Object.hasOwn(devices[0], 'fields'))
    },
  )
  browser = await launch()
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
    }),
    page = await context.newPage(),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await check(
    'browser desktop two columns / mobile one column, neutral ring, zero, truncation and escaped text',
    async () => {
      await page.goto(origin)
      await settle(page)
      const card = page.locator('[data-module="devices"]')
      await card.getByText('Visual Studio Code', { exact: true }).waitFor()
      const desktop = card.locator('[data-device-id="desktop"]'),
        zero = card.locator('[data-device-id="zero"]')
      assert.equal(await desktop.locator('.device-meter-neutral').count(), 1)
      assert.equal(await desktop.locator('.var-progress,.battery-value,[role="img"]').count(), 0)
      assert.equal(await zero.locator('[aria-label="电量 0%"],.battery-value').count(), 2)
      assert.equal(await card.getByLabel('充电中', { exact: true }).count(), 0)
      assert.equal(await card.locator('img,script').count(), 0)
      assert.ok(
        (await card.locator('[data-device-id="html"] .device-state').innerText()).includes('<img'),
      )
      const long = card.locator('[data-device-id="long"] .device-state')
      assert.ok((await long.getAttribute('title')).length > 500)
      assert.equal(await long.getAttribute('aria-label'), sleepyDevicesFixture().device.long.status)
      assert.equal(await long.getAttribute('title'), sleepyDevicesFixture().device.long.status)
      assert.ok(await long.evaluate((el) => el.scrollWidth > el.clientWidth))
      const measure = () =>
        page.evaluate(() => {
          const list = document.querySelector('.device-list')
          return {
            width: innerWidth,
            columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
            scrollWidth: document.documentElement.scrollWidth,
            rows: [...document.querySelectorAll('.device-row')].map((e) => {
              const r = e.getBoundingClientRect()
              return { x: r.x, y: r.y, width: r.width, height: r.height }
            }),
            neutral: [...document.querySelectorAll('.device-meter-neutral')].map((e) => ({
              border: getComputedStyle(e).borderTopWidth,
              radius: getComputedStyle(e).borderRadius,
              progress: e.querySelector('.var-progress') !== null,
            })),
          }
        })
      let geometry = await measure()
      assert.equal(geometry.columns, 2)
      assert.ok(geometry.scrollWidth <= geometry.width)
      assert.ok(geometry.rows.every((r) => r.height < 100))
      report.geometry.push(geometry)
      await page.screenshot({
        path: evidence + '/devices-desktop.png',
        fullPage: true,
        animations: 'disabled',
      })
      assert.equal(
        await zero.locator('.battery-value small').evaluate((el) => getComputedStyle(el).display),
        'inline',
      )
      await page.getByRole('button', { name: '切换到暗色模式', exact: true }).click()
      await page.waitForFunction(() => document.documentElement.style.colorScheme === 'dark')
      await page.screenshot({
        path: evidence + '/devices-desktop-dark.png',
        fullPage: true,
        animations: 'disabled',
      })
      await page.getByRole('button', { name: '切换到亮色模式', exact: true }).click()
      await page.waitForFunction(() => document.documentElement.style.colorScheme === 'light')
      await page.setViewportSize({ width: 390, height: 844 })
      geometry = await measure()
      assert.equal(geometry.columns, 1)
      assert.ok(geometry.scrollWidth <= geometry.width)
      report.geometry.push(geometry)
      await page.screenshot({
        path: evidence + '/devices-mobile.png',
        fullPage: true,
        animations: 'disabled',
      })
      for (let step = 0; step < 32; step++) {
        await page.keyboard.press('Tab')
        if (await long.evaluate((el) => document.activeElement === el)) break
      }
      assert.ok(await long.evaluate((el) => document.activeElement === el))
      assert.ok(await long.evaluate((el) => el.matches(':focus-visible')))
      assert.ok(await long.evaluate((el) => el.getBoundingClientRect().height < 40))
    },
  )
  await check(
    'stale source is labeled as stale, never inferred offline from old statusUpdatedAt',
    async () => {
      snapshot.status = 'stale'
      await store()
      await page.reload()
      await settle(page)
      assert.ok((await page.locator('[data-module="devices"]').innerText()).includes('数据过期'))
      assert.ok(!(await page.locator('.device-list').innerText()).includes('离线'))
      await page.screenshot({
        path: evidence + '/devices-stale.png',
        fullPage: true,
        animations: 'disabled',
      })
    },
  )
  await check(
    'stateText/foregroundApp ACL aliases cannot leak through API, SSR payload, title or aria-label',
    async () => {
      snapshot.data.devices[0].foregroundApp = 'PRIVATE-ALIAS-0511'
      snapshot.data.devices[0].stateText = 'PRIVATE-ALIAS-0511'
      await store()
      for (const field of ['foregroundApp', 'stateText']) {
        await save((c) => {
          c.modules.find((m) => m.id === 'devices').fields = {
            [privateItem]: { enabled: true, visibility: 'admin' },
            ['/devices/*/' + field]: { enabled: true, visibility: 'admin' },
          }
        })
        const dto = await dashboard(),
          device = dto.modules.find((m) => m.id === 'devices').snapshot.data.devices[0]
        assert.equal(device.batteryPercent, 66)
        assert.ok(!Object.hasOwn(device, 'foregroundApp'))
        assert.ok(!Object.hasOwn(device, 'stateText'))
        const html = await (await mf.dispatchFetch(origin)).text()
        for (const marker of ['PRIVATE-ALIAS', 'PRIVATE-APPLICATION', 'PRIVATE-DEVICE'])
          assert.ok(!html.includes(marker))
        await page.reload()
        await settle(page)
        assert.ok(!(await page.content()).includes('PRIVATE-ALIAS'))
      }
    },
  )
  assert.deepEqual(errors, [])
  assert.equal(network, 0)
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
  report.networkRequests = network
  console.log(JSON.stringify({ checks: report.checks.length, networkRequests: network, persist }))
} catch (e) {
  report.error = String(e)
  throw e
} finally {
  await browser?.close()
  await mf.dispose()
  await writeFile(evidence + '/devices-http.json', JSON.stringify(report, null, 2))
}

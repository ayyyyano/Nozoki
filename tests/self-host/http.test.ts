import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, cp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, randomBytes } from 'node:crypto'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig, CONFIG_BODY_LIMIT } from '../../shared/contracts/admin.ts'
import { bindSources } from '../../shared/integration-presets/bindings.ts'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { importCredentialKey } from '../../server/services/credentials.ts'

async function portNumber() {
  const server = createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await new Promise((r) => server.close(r))
  return port
}
async function command(file, env, args = []) {
  const process = spawn(globalThis.process.execPath, [file, ...args], {
    env,
    cwd: tmpdir(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = '',
    err = ''
  process.stdout.on('data', (v) => {
    out += v
  })
  process.stderr.on('data', (v) => {
    err += v
  })
  const code = await new Promise((resolve, reject) => {
    process.once('exit', resolve)
    process.once('error', reject)
  })
  return { code, out, err }
}
async function start(file, env) {
  const child = spawn(process.execPath, [file], {
    env,
    cwd: tmpdir(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (v) => {
    output += v
  })
  child.stderr.on('data', (v) => {
    output += v
  })
  for (let i = 0; i < 200; i++) {
    if (output.includes('Nozoki listening')) return child
    if (child.exitCode !== null) throw new Error('Node startup failed: ' + output)
    await new Promise((r) => setTimeout(r, 50))
  }
  child.kill()
  throw new Error('Node startup timed out')
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const done = new Promise((r) => child.once('exit', r))
  child.kill('SIGTERM')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
  timeout.unref()
  await done
  clearTimeout(timeout)
}
async function rawRequest(origin, path, headers, chunks, method = 'POST') {
  return new Promise((resolve, reject) => {
    const req = request(origin + path, { method, headers }, (res) => {
      let body = ''
      res.on('data', (v) => {
        body += v
      })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    for (const chunk of chunks) req.write(chunk)
    req.end()
  })
}
test(
  'standalone Node HTTP/SSR, auth, CSRF, CAS, restart and browser on isolated SQLite',
  { timeout: 240000 },
  async (t) => {
    const folder = await mkdtemp(resolve('.wrangler/self-host-http-'))
    const release = resolve(folder, 'release')
    await cp('.output-node', release, { recursive: true })
    const port = await portNumber(),
      origin = `http://127.0.0.1:${port}`
    const env = {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NOZOKI_SQLITE_PATH: resolve(folder, 'db.sqlite'),
      ADMIN_EMAIL: 'self-host@example.invalid',
      ADMIN_PASSWORD: 'Synthetic-' + randomBytes(32).toString('base64url'),
      AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString('base64url'),
      AUTH_VERSION: '1',
      AUTH_ORIGIN: origin,
      AUTH_ALLOW_LOCAL_HTTP: '1',
      AUTH_TRUST_CF_IP: '1',
      COLLECTOR_EPOCH: '1',
    }
    for (const key of [
      'NOZOKI_RELAY_CONFIG_FILE',
      'NOZOKI_PRIVATE_ROUTES',
      'INTEGRATION_ENCRYPTION_KEY',
      'NOZOKI_PRIVATE_RELAY_TOKEN',
    ])
      delete env[key]
    env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
    env.INTEGRATION_KEY_VERSION = 'v1'
    const cli = resolve(release, 'database.mjs'),
      entry = resolve(release, 'start.mjs')
    let child, browser
    t.after(async () => {
      if (browser) await browser.close()
      if (child) await stop(child)
    })
    assert.equal((await command(cli, env, ['migrate'])).code, 0)
    assert.deepEqual(JSON.parse((await command(cli, env, ['migrate'])).out).applied, [])
    const offlineDb = new SqliteDatabase(env.NOZOKI_SQLITE_PATH)
    try {
      await offlineDb
        .prepare("UPDATE integrations SET enabled=0 WHERE provider='quotes-custom'")
        .run()
    } finally {
      offlineDb.close()
    }
    child = await start(entry, env)
    const fetchJson = async (path, init = {}) => {
      const response = await fetch(origin + path, init)
      return { response, value: await response.json() }
    }
    await t.test(
      'guest API, SSR and static files work without Cloudflare or project node_modules',
      async () => {
        const guest = await fetchJson('/api/dashboard')
        assert.equal(guest.response.status, 200)
        assert.equal(guest.value.viewer, 'guest')
        assert.match(guest.response.headers.get('cache-control'), /no-store/)
        const home = await fetch(origin),
          text = await home.text()
        assert.equal(home.status, 200)
        assert.match(text, /Nozoki/)
        assert.ok(!text.includes(env.ADMIN_PASSWORD) && !text.includes(env.AUTH_RATE_LIMIT_SECRET))
        assert.equal((await fetch(origin + '/theme-init.js')).status, 200)
        assert.equal((await fetch(origin + '/api/admin/config')).status, 401)
        const redirect = await fetch(origin + '/admin', { redirect: 'manual' })
        assert.equal(redirect.status, 303)
        assert.equal(redirect.headers.get('location'), '/login')
      },
    )
    let cookie, csrf, saved
    await t.test(
      'Origin, Host and streaming byte limits reject before authentication/writes',
      async () => {
        const login = (headers) =>
          fetchJson('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
          })
        assert.equal((await login({ Origin: 'https://attacker.invalid' })).response.status, 403)
        assert.equal((await login({})).response.status, 403)
        const badHost = await rawRequest(
          origin,
          '/api/auth/login',
          { Host: 'attacker.invalid', Origin: origin, 'Content-Type': 'application/json' },
          ['{}'],
        )
        assert.equal(badHost.status, 421)
        for (const [path, size, method] of [
          ['/api/auth/login', 5000, 'POST'],
          ['/api/admin/config', CONFIG_BODY_LIMIT + 10, 'PUT'],
        ]) {
          const result = await rawRequest(
            origin,
            path,
            { Origin: origin, 'Content-Type': 'application/json' },
            [Buffer.alloc(size, 32)],
            method,
          )
          assert.equal(result.status, 413)
        }
        const accepted = await login({
          Origin: origin,
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'attacker.invalid',
          'CF-Connecting-IP': '1.2.3.4',
        })
        assert.equal(accepted.response.status, 200)
        const setCookie = accepted.response.headers.get('set-cookie')
        assert.match(setCookie, /HttpOnly/i)
        assert.match(setCookie, /SameSite=Strict/i)
        assert.match(setCookie, /Path=\//)
        cookie = setCookie.split(';')[0]
        assert.ok(cookie.startsWith('nozoki_dev_session='))
        csrf = (await fetchJson('/api/auth/csrf', { headers: { Cookie: cookie } })).value.token
      },
    )
    await t.test(
      'authenticated SSR, CSRF, exact retry and competing CAS saves use SQLite',
      async () => {
        const headers = {
          Cookie: cookie,
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Nozoki-CSRF': csrf,
        }
        assert.equal((await fetch(origin + '/admin', { headers: { Cookie: cookie } })).status, 200)
        assert.equal(
          (await fetchJson('/api/dashboard', { headers: { Cookie: cookie } })).value.viewer,
          'admin',
        )
        const config = (await fetchJson('/api/admin/config', { headers: { Cookie: cookie } })).value
        const input = { expectedVersion: config.site.configVersion, config: editableConfig(config) }
        input.config.site.siteName = 'Self-host persistent site'
        const save = (value, key, extra = {}) =>
          fetchJson('/api/admin/config', {
            method: 'PUT',
            headers: { ...headers, 'Idempotency-Key': key, ...extra },
            body: JSON.stringify(value),
          })
        assert.equal(
          (await save(input, randomUUID(), { 'X-Nozoki-CSRF': '' })).response.status,
          403,
        )
        assert.equal(
          (await save(input, randomUUID(), { Origin: 'https://attacker.invalid' })).response.status,
          403,
        )
        const key = randomUUID(),
          good = await save(input, key)
        assert.equal(good.response.status, 200)
        assert.equal(good.value.success, true)
        const retry = await save(input, key)
        assert.equal(retry.value.configVersion, good.value.configVersion)
        assert.equal(retry.value.replayed, true)
        const different = structuredClone(input)
        different.config.site.siteName = 'Conflicting retry'
        assert.equal((await save(different, key)).response.status, 409)
        assert.equal((await save(different, randomUUID())).response.status, 409)
        saved = (await fetchJson('/api/admin/config', { headers: { Cookie: cookie } })).value
        const noop = await save(
          { expectedVersion: saved.site.configVersion, config: editableConfig(saved) },
          randomUUID(),
        )
        assert.equal(noop.value.changed, false)
        assert.equal(noop.value.configVersion, saved.site.configVersion)
        const db = new SqliteDatabase(env.NOZOKI_SQLITE_PATH)
        try {
          const audit = await db
            .prepare(
              "SELECT * FROM integration_audit WHERE operation='config_save' AND actor_kind='admin'",
            )
            .all()
          assert.equal(audit.results.length, 1)
          assert.equal(audit.results[0].actor_kind, 'admin')
          assert.equal((await db.prepare('SELECT count(*) AS n FROM config_requests').first()).n, 2)
        } finally {
          db.close()
        }
      },
    )
    await t.test(
      'server restart preserves both configuration and the D1-compatible session',
      async () => {
        await stop(child)
        child = await start(entry, env)
        const session = await fetchJson('/api/auth/session', { headers: { Cookie: cookie } })
        assert.equal(session.value.viewer, 'admin')
        assert.equal(
          (await fetchJson('/api/admin/config', { headers: { Cookie: cookie } })).value.site
            .siteName,
          saved.site.siteName,
        )
        const result = await command(resolve(release, 'collector.mjs'), env)
        assert.equal(result.code, 0)
        const metrics = JSON.parse(result.out)
        assert.equal(metrics.selected, 0)
        assert.equal(metrics.requests, 0)
        assert.equal(metrics.fatal, null)
        const backup = resolve(folder, 'verified.sqlite')
        assert.equal((await command(cli, env, ['backup', backup])).code, 0)
        const db = new SqliteDatabase(backup)
        try {
          assert.equal((await readConfig(db)).site.siteName, saved.site.siteName)
        } finally {
          db.close()
        }
      },
    )
    await t.test(
      'configuration export only includes secrets on explicit request and fails closed',
      async () => {
        const db = new SqliteDatabase(env.NOZOKI_SQLITE_PATH)
        try {
          const current = await readConfig(db)
          const config = editableConfig(current)
          const source = createIntegrationDraft('deepseek', config.integrations, 'export-fixture')
          source.enabled = false
          source.credential = { operation: 'replace', value: 'synthetic-export-secret' }
          config.integrations.push(source)
          const keys = await importCredentialKey(
            'v1',
            Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64url'),
          )
          assert.equal(
            (
              await saveConfig(
                db,
                { config, expectedVersion: current.site.configVersion },
                { actor: { kind: 'system' }, keys },
              )
            ).success,
            true,
          )
          const ordinary = await fetchJson('/api/admin/data/export', {
            headers: { Cookie: cookie },
          })
          assert.match(ordinary.response.headers.get('cache-control'), /no-store/)
          assert.ok(!JSON.stringify(ordinary.value).includes('synthetic-export-secret'))
          const portable = await fetchJson('/api/admin/data/export?credentials=1', {
            headers: { Cookie: cookie },
          })
          assert.equal(portable.response.status, 200)
          assert.equal(
            portable.value.config.integrations.find((i) => i.id === source.id).credentialPlain,
            'synthetic-export-secret',
          )
          assert.match(portable.response.headers.get('cache-control'), /no-store/)
          await db
            .prepare('UPDATE integrations SET credential_key_version=? WHERE id=?')
            .bind('missing', source.id)
            .run()
          const failed = await fetchJson('/api/admin/data/export?credentials=1', {
            headers: { Cookie: cookie },
          })
          assert.equal(failed.response.status, 500)
          assert.equal(failed.value.code, 'CREDENTIAL_DECRYPT_FAILED')
          assert.ok(!JSON.stringify(failed.value).includes('synthetic-export-secret'))
          assert.equal(failed.response.headers.get('content-disposition'), null)
          await db
            .prepare('UPDATE integrations SET credential_key_version=? WHERE id=?')
            .bind('v1', source.id)
            .run()
        } finally {
          db.close()
        }
      },
    )
    await t.test(
      'service monitor rows distinguish expired observations from unknown states',
      { skip: process.env.NOZOKI_TEST_BROWSER !== '1' },
      async () => {
        const { launch, settle } = await import('../browser/support.ts')
        const { expect } = await import('playwright/test')
        const { fixture, fixed } = await import('../fixtures/layout.ts')
        const dashboard = await fixture({ only: ['services'] })
        const servicesModule = dashboard.modules.find((m) => m.id === 'services')
        assert.ok(servicesModule?.kind === 'data')
        const services = servicesModule.snapshot
        const data = services.data
        assert.ok(data && typeof data === 'object' && 'monitors' in data)
        assert.ok(Array.isArray(data.monitors) && data.monitors.length >= 2)
        services.status = 'ok'
        services.collectedAt = fixed.toISOString()
        services.expiresAt = new Date(fixed.getTime() + 600_000).toISOString()
        const [expired, unknown] = data.monitors
        data.monitors = [
          { ...expired, state: 'up', checkedAt: new Date(fixed.getTime() - 600_001).toISOString() },
          { ...unknown, state: 'unknown', checkedAt: null },
        ]

        const monitorBrowser = await launch()
        try {
          const page = await monitorBrowser.newPage()
          await page.clock.setFixedTime(fixed)
          await page.route('**/api/dashboard', (route) => route.fulfill({ json: dashboard }))
          await page.goto(origin)
          await settle(page)
          await page.evaluate(() => window.dispatchEvent(new Event('focus')))
          const rows = page.locator('[data-module="services"] .monitor-row')
          const staleRow = rows.filter({ has: page.locator('[data-state="stale"]') })
          const unknownRow = rows.filter({ has: page.locator('[data-state="unknown"]') })
          await expect(staleRow.locator('.monitor-state')).toHaveText('数据过期')
          await expect(unknownRow.locator('.monitor-state')).toHaveText('未知')
          const unknownColor = await unknownRow
            .locator('.monitor-indicator')
            .evaluate((dot) => getComputedStyle(dot).backgroundColor)
          await expect(staleRow.locator('.monitor-indicator')).toHaveCSS(
            'background-color',
            unknownColor,
          )
        } finally {
          await monitorBrowser.close()
        }
      },
    )
    await t.test(
      'real browser renders shared charts in desktop and mobile dialogs',
      { skip: process.env.NOZOKI_TEST_BROWSER !== '1' },
      async () => {
        const { mkdir, readdir, readFile, stat, writeFile } = await import('node:fs/promises')
        const { launch, settle, geometry } = await import('../browser/support.ts')
        const { expect } = await import('playwright/test')
        const { fixture, fixed } = await import('../fixtures/layout.ts')
        const { statusBuckets } = await import('../../shared/domain/chart-series.ts')
        const dashboard = await fixture({ disabled: [], monitors: 13, longNames: true })
        const balance = dashboard.modules.find((m) => m.id === 'deepseek').snapshot
        balance.collectedAt = fixed.toISOString()
        balance.lastSuccessAt = fixed.toISOString()
        const balanceData = balance.data
        balanceData.dailyBalances = Array.from({ length: 7 }, (_, i) => {
          const day = new Date(fixed.getTime() - (6 - i) * 86400000).toISOString()
          return {
            day: day.slice(0, 10),
            collectedAt: day,
            currency: 'CNY',
            total: i === 2 ? '-12.5' : String(60 + i),
          }
        })
        const services = dashboard.modules.find((m) => m.id === 'services').snapshot
        services.status = 'ok'
        services.collectedAt = fixed.toISOString()
        services.lastSuccessAt = fixed.toISOString()
        services.expiresAt = new Date(fixed.getTime() + 600_000).toISOString()
        for (const item of services.data.monitors) item.checkedAt = fixed.toISOString()
        const monitorIds = services.data.monitors.map(({ id }) => id)
        const selected = [2, 0, 3, 1, 7, 6, 8, 5].map((i) => monitorIds[i])
        services.homeItems = selected
        Object.assign(services.data.monitors[2], { state: 'up', latencyMs: 591 })
        Object.assign(services.data.monitors[0], { state: 'up', latencyMs: null })
        Object.assign(services.data.monitors[3], { state: 'down', latencyMs: 612 })
        Object.assign(services.data.monitors[1], { state: 'maintenance', latencyMs: 325 })
        const points = Array.from({ length: 81 }, (_, index) => ({
          at: new Date(fixed.getTime() - (80 - index) * 180_000).toISOString(),
          state:
            index > 75
              ? ('down' as const)
              : index === 4
                ? ('maintenance' as const)
                : ('up' as const),
          latencyMs: index === 80 ? 260 : (index * 9) % 110,
        })).filter((_, index) => index < 25 || index > 32)
        const screenshots =
          process.env.NOZOKI_SERVICES_EVIDENCE ?? '.wrangler/test-results/service-charts'
        await mkdir(screenshots, { recursive: true })
        const report = []
        const assets = resolve(release, 'public/_nuxt')
        let chartChunk = ''
        for (const name of await readdir(assets)) {
          if (!name.endsWith('.js')) continue
          const path = resolve(assets, name)
          if (
            (await stat(path)).size > 200_000 &&
            (await readFile(path, 'utf8')).includes('[ECharts]')
          ) {
            chartChunk = name
            break
          }
        }
        assert.ok(chartChunk, 'The production browser build contains an ECharts chunk')
        const chartsBrowser = await launch()
        try {
          for (const [width, height] of [
            [1920, 1080],
            [1440, 900],
            [1280, 720],
            [768, 1024],
            [600, 844],
            [390, 844],
            [320, 640],
          ]) {
            const desktop = width >= 1024
            const context = await chartsBrowser.newContext({
              viewport: { width, height },
              hasTouch: !desktop,
              colorScheme: [1920, 390].includes(width) ? 'dark' : 'light',
              reducedMotion: width === 320 ? 'reduce' : 'no-preference',
            })
            const page = await context.newPage()
            const errors: string[] = []
            page.on('pageerror', (error) => errors.push(error.message))
            await page.clock.setFixedTime(fixed)
            const current = structuredClone(dashboard)
            const currentServices = current.modules.find((m) => m.id === 'services').snapshot
            if (width === 768) currentServices.partialFailures = 1
            let samples = points
            await page.route('**/api/dashboard', (route) => route.fulfill({ json: current }))
            const requests: string[] = []
            let homeRequests = 0
            let homeBytes = 0
            await page.route('**/api/service-history?*', (route) => {
              const params = new URL(route.request().url()).searchParams
              if (params.get('view') === 'home') {
                homeRequests++
                const json = currentServices.homeItems.map((id) => ({
                  id,
                  segments: Object.fromEntries(
                    [12, 16].map((segments) => [
                      segments,
                      statusBuckets(samples, segments, fixed.getTime()).map(({ state }) => state),
                    ]),
                  ),
                }))
                homeBytes = Buffer.byteLength(JSON.stringify(json))
                return route.fulfill({ json })
              }
              const id = params.get('monitor')
              assert.ok(id && monitorIds.includes(id))
              requests.push(id)
              return route.fulfill({
                json: {
                  kind: 'observation',
                  intervalSeconds: 180,
                  showStatus: true,
                  showLatency: true,
                  until: fixed.toISOString(),
                  points: samples,
                },
              })
            })
            const initialCharts: string[] = []
            page.on('request', (req) => {
              if (new URL(req.url()).pathname.endsWith('/' + chartChunk))
                initialCharts.push(req.url())
            })
            await page.goto(origin)
            await settle(page)
            const initialDashboard = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
            await page.evaluate(() => window.dispatchEvent(new Event('focus')))
            await initialDashboard
            const card = page.locator('[data-module="services"]')
            const homeRows = card.locator('.monitor-row')
            const visibleSegments = (row) =>
              row.locator('.monitor-heartbeat-segments:visible > span')
            await expect(visibleSegments(homeRows.first()).first()).toHaveAttribute(
              'data-state',
              'missing',
            )
            await expect(visibleSegments(homeRows.first()).last()).toHaveAttribute(
              'data-state',
              'down',
            )
            await expect(homeRows).toHaveCount(8)
            assert.deepEqual(
              await homeRows.evaluateAll((rows) =>
                rows.map((row) => row.getAttribute('data-monitor-id')),
              ),
              selected,
            )
            await expect(homeRows.nth(0).locator('.monitor-latency')).toContainText('591 ms')
            await expect(homeRows.nth(1).locator('.monitor-latency')).toContainText('—')
            await expect(homeRows.nth(2).locator('.monitor-state')).toHaveText('异常')
            await expect(homeRows.nth(3).locator('.monitor-state')).toHaveText('维护中')
            await expect(
              card.locator('.monitor-meta, .chart-plot, .monitor-history-toggle'),
            ).toHaveCount(0)
            assert.equal(homeRequests, 1)
            assert.ok(homeBytes > 0 && homeBytes < 2_700)
            const initialHome = { requests: homeRequests, bytes: homeBytes }
            assert.deepEqual(requests, [])
            assert.deepEqual(initialCharts, [])
            const metrics = await geometry(page)
            const serviceGeometry = metrics.cards.find(({ id }) => id === 'services')
            assert.ok(
              metrics.cards
                .filter(({ id }) => id !== 'links')
                .every(({ height }) => height === 240),
            )
            if (!desktop) {
              const shortcuts = await page
                .locator('[data-module="links"] .link-grid a')
                .evaluateAll((links) =>
                  links.map((link) => {
                    const { x, y } = link.getBoundingClientRect()
                    return { x, y }
                  }),
                )
              assert.equal(shortcuts.length, 4)
              assert.equal(new Set(shortcuts.map(({ x }) => x)).size, 2)
              assert.equal(new Set(shortcuts.map(({ y }) => y)).size, 2)
            }
            const homeLayout = async () => {
              const rects = await homeRows.evaluateAll((rows) =>
                rows.map((row) => {
                  const r = row.getBoundingClientRect()
                  const heading = row.querySelector('h3')!
                  const meta = row.querySelector('.monitor-state, .monitor-latency')!
                  return {
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    nameClipped: heading.scrollWidth > heading.clientWidth,
                    headingFits:
                      heading.getBoundingClientRect().right <= meta.getBoundingClientRect().left,
                    metaFits: meta.getBoundingClientRect().right <= r.right + 1,
                  }
                }),
              )
              const box = (await card.boundingBox())!
              const segmentCount = await visibleSegments(homeRows.first()).count()
              const segmentHeight = (await visibleSegments(homeRows.first()).first().boundingBox())!
                .height
              assert.equal(segmentCount, box.width >= 400 ? 16 : 12)
              assert.equal(segmentHeight, 7)
              assert.equal(new Set(rects.map(({ x }) => x)).size, 2)
              assert.equal(new Set(rects.map(({ y }) => y)).size, 4)
              assert.ok(
                rects.every(
                  ({ headingFits, metaFits, nameClipped }) =>
                    headingFits && metaFits && nameClipped,
                ),
              )
              const footer = await card.locator('.module-footer').boundingBox()
              assert.ok(footer && rects.every(({ y, height }) => y + height <= footer.y))
              return { card: box, rects, segmentCount, segmentHeight }
            }
            const actualLayout = await homeLayout()
            const constrained = []
            if (width === 1440) {
              assert.equal(metrics.columns, 4)
              assert.ok(serviceGeometry.width >= 300 && serviceGeometry.width <= 340)
              assert.equal(serviceGeometry.height, 240)
              assert.ok(
                metrics.cards
                  .filter(({ id }) => id !== 'links')
                  .every(({ height }) => height === 240),
              )
              await page.screenshot({
                path: screenshots + '/home-four-columns.png',
                fullPage: true,
                animations: 'disabled',
              })
              for (const cardWidth of [280, 300, 320, 340, 400, 450]) {
                await card.evaluate(
                  (el, size) => el.style.setProperty('width', size + 'px'),
                  cardWidth,
                )
                constrained.push(await homeLayout())
              }
              await card.evaluate((el) => el.style.removeProperty('width'))
              for (const quantity of [0, 1, 2, 3, 4, 5, 8]) {
                currentServices.homeItems = selected.slice(0, quantity)
                const response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
                await page.evaluate(() => window.dispatchEvent(new Event('focus')))
                await response
                await expect(homeRows).toHaveCount(quantity)
                if (quantity) await expect(visibleSegments(homeRows.first()).first()).toBeVisible()
                assert.deepEqual(
                  await homeRows.evaluateAll((rows) =>
                    rows.map((r) => r.getAttribute('data-monitor-id')),
                  ),
                  selected.slice(0, quantity),
                )
              }
            }
            report.push({
              width,
              height,
              dashboardColumns: metrics.columns,
              initialHome,
              ...actualLayout,
              constrained,
            })
            if (!desktop && width <= 390)
              await card.screenshot({
                path: screenshots + '/home-' + width + '.png',
                animations: 'disabled',
              })

            await page.getByRole('button', { name: '查看服务状态详情', exact: true }).click()
            const panel = page.getByRole('dialog', { name: '服务状态', exact: true })
            await expect(panel).not.toHaveClass(/module-detail-enter-active/)
            if (width === 768) await expect(panel).toContainText('1 个来源暂不可用')
            const rows = panel.locator('.monitor-row')
            const first = rows.first()
            const second = rows.nth(1)
            const toggles = panel.locator('.monitor-history-toggle')
            const firstToggle = toggles.first()
            const timeline = first.getByRole('slider', { name: '服务状态时间轴' })
            const latency = first.getByRole('slider', { name: '服务响应时间' })
            await expect(rows).toHaveCount(13)
            await expect(panel.getByRole('list', { name: '状态图例' })).toHaveCount(1)
            const [left, right] = await Promise.all([first.boundingBox(), second.boundingBox()])
            assert.ok(left && right)
            if (desktop) {
              assert.ok(Math.abs(left.y - right.y) < 1 && right.x >= left.x + left.width)
              await expect(toggles).toHaveCount(0)
              await expect(
                second.getByRole('slider', { name: '服务状态时间轴' }).locator('svg'),
              ).toBeVisible()
            } else {
              assert.ok(Math.abs(left.x - right.x) < 1 && right.y >= left.y + left.height)
              await expect(toggles).toHaveCount(13)
              await expect(panel.locator('.monitor-history')).toHaveCount(0)
              assert.deepEqual(requests, [])
              const tapTarget = (await firstToggle.boundingBox())!
              await expect(firstToggle).toHaveCSS('height', '40px')
              await expect(firstToggle).toHaveCSS('width', '40px')
              assert.ok(
                tapTarget.height >= 39.5 &&
                  tapTarget.width >= 39.5 &&
                  tapTarget.x + tapTarget.width <= left.x + left.width + 0.5,
                JSON.stringify({ width, tapTarget, left }),
              )
              if (width === 390)
                await panel.screenshot({
                  path: screenshots + '/details-mobile-collapsed.png',
                  animations: 'disabled',
                })
              async function headingInPanel() {
                const [heading, dialog] = await Promise.all([
                  first.locator('.monitor-heading').boundingBox(),
                  panel.boundingBox(),
                ])
                assert.ok(heading && dialog)
                return { ...heading, y: heading.y - dialog.y }
              }
              const heading = await headingInPanel()
              await firstToggle.tap()
              await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
              await expect(firstToggle.locator('.app-icon')).toHaveCSS(
                'transform',
                'matrix(-1, 0, 0, -1, 0, 0)',
              )
              if (width === 320)
                assert.ok(
                  await firstToggle
                    .locator('.app-icon')
                    .evaluate(
                      (icon) => Number.parseFloat(getComputedStyle(icon).transitionDuration) < 0.01,
                    ),
                )
              assert.deepEqual(await headingInPanel(), heading)
            }
            await expect(timeline.locator('svg')).toBeVisible()
            await expect(latency.locator('svg')).toBeVisible()
            await expect(first.locator('.chart-marker, .chart-band')).toHaveCount(0)
            await expect(first.locator('.monitor-history-readout')).toBeEmpty()
            await expect(panel).not.toContainText(/Nozoki 近|用方向键|点击查看|尚未选择/)
            assert.equal(initialCharts.length, 1)
            assert.ok(requests.includes(monitorIds[0]))
            assert.ok(!requests.includes(monitorIds.at(-1)))
            await expect(timeline).toHaveCSS('border-radius', '0px')
            if (width === 1440 || width === 390) {
              await panel.screenshot({
                path: screenshots + '/details-default-' + width + '.png',
                animations: 'disabled',
              })
            }
            const edge = { x: (await timeline.boundingBox())!.width - 5, y: 12 }
            if (desktop) {
              await timeline.hover({ position: edge })
              await expect(first.locator('.chart-band')).toBeVisible()
              await expect(first.locator('.monitor-history-readout')).toContainText(/含异常/)
              await panel.locator('h2').hover()
              await expect(first.locator('.chart-marker, .chart-band')).toHaveCount(0)
            }
            await timeline[desktop ? 'click' : 'tap']({ position: edge })
            await expect(first.locator('.chart-band')).toBeVisible()
            if (desktop) {
              await timeline.hover({ position: { x: 12, y: 12 } })
              await expect(first.locator('.monitor-history-readout')).toContainText('缺测')
              await panel.locator('h2').hover()
              await expect(first.locator('.monitor-history-readout')).toContainText(/含异常/)
            }
            await timeline[desktop ? 'click' : 'tap']({ position: edge })
            await expect(first.locator('.chart-band')).toHaveCount(0)
            await latency.press('End')
            await latency.press('Enter')
            await expect(first.locator('.chart-marker')).toHaveCount(2)
            await expect(first.locator('.chart-marker.chart-pin-feedback')).toHaveCount(2)
            await expect(first.locator('.chart-band')).toHaveCount(0)
            await expect(first.locator('.monitor-history-readout')).toContainText(/异常.*260 ms/)
            if (width === 1440 || width === 390) {
              await panel.screenshot({
                path: screenshots + '/details-selected-' + width + '.png',
                animations: 'disabled',
              })
            }
            if (width === 1440 || width === 390) {
              async function refreshServices() {
                const update = page.waitForResponse(
                  (response) =>
                    new URL(response.url()).searchParams.get('monitor') === monitorIds[0],
                )
                await page.evaluate(() => window.dispatchEvent(new Event('focus')))
                await update
              }
              currentServices.collectedAt = new Date(fixed.getTime() - 1000).toISOString()
              await refreshServices()
              await expect(first.locator('.monitor-history-readout')).toContainText('260 ms')
              samples = points.slice(0, -1)
              currentServices.collectedAt = new Date(fixed.getTime() - 2000).toISOString()
              await refreshServices()
              await expect(first.locator('.monitor-history-readout')).toBeEmpty()
              await latency.press('End')
              await latency.press('Space')
            }
            await panel.getByRole('button', { name: '关闭详情' }).press('Escape')
            await expect(panel).toBeVisible()
            await expect(first.locator('.monitor-history-readout')).toBeEmpty()
            if (!desktop) {
              await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
              await toggles.nth(1).tap()
              await expect(firstToggle).toHaveAttribute('aria-expanded', 'false')
              await expect(second.locator('.monitor-history')).toBeVisible()
              await expect(panel.locator('.monitor-history')).toHaveCount(1)
              await toggles.nth(1).tap()
              await expect(panel.locator('.monitor-history')).toHaveCount(0)
              if (width === 390) {
                await firstToggle.evaluate(async (button: HTMLButtonElement) => {
                  button.click()
                  await new Promise(requestAnimationFrame)
                  button.click()
                })
                await expect(firstToggle).toHaveAttribute('aria-expanded', 'false')
                await expect(panel.locator('.monitor-history')).toHaveCount(0)
              }
            }
            if (width === 1440) {
              await page.setViewportSize({ width: 390, height: 844 })
              await expect(panel.locator('.monitor-history')).toHaveCount(0)
              await firstToggle.click()
              await expect(panel.locator('.monitor-history')).toHaveCount(1)
              await page.setViewportSize({ width, height })
              await expect(panel.locator('.monitor-history')).toHaveCount(13)
            }
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              true,
            )
            const body = panel.locator('.module-detail-content')
            assert.equal(await body.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true)
            await rows.last().scrollIntoViewIfNeeded()
            if (!desktop) await toggles.last().tap()
            await expect(
              rows.last().getByRole('slider', { name: '服务状态时间轴' }).locator('svg'),
            ).toBeVisible()
            assert.ok(requests.includes(monitorIds.at(-1)))
            await page.keyboard.press('Escape')
            await expect(panel).toBeHidden()
            if (width === 1440) {
              await page.getByRole('button', { name: '显示纯壁纸' }).click()
              await expect(page.locator('#main-content')).toHaveAttribute('inert', '')
              await expect(page.locator('#main-content')).toBeHidden()
              await page.getByRole('button', { name: '恢复看板' }).click()
              await expect(page.locator('#main-content')).toBeVisible()
              await expect(page.locator('#main-content')).not.toHaveAttribute('inert', '')
            }
            await card.getByRole('button', { name: '查看服务状态详情', exact: true }).click()
            await expect(panel).toBeVisible()
            await expect(panel.locator('.chart-marker, .chart-band')).toHaveCount(0)
            if (!desktop) await expect(panel.locator('.monitor-history')).toHaveCount(0)
            await page.keyboard.press('Escape')
            await expect(panel).toBeHidden()
            await page.locator('[data-module="deepseek"] .module-detail-button').click()
            const deepSeek = page.getByRole('dialog', { name: 'DeepSeek', exact: true })
            await expect(
              deepSeek.getByRole('heading', { name: '近 7 日余额', exact: true }),
            ).toBeVisible()
            await expect(
              deepSeek.getByRole('heading', { name: '余额明细', exact: true }),
            ).toBeVisible()
            const balance = deepSeek.getByRole('slider', { name: /近 7 日.*余额/ })
            await expect(balance.locator('svg')).toBeVisible()
            await balance.press('End')
            await expect(balance).toHaveAttribute('aria-valuetext', /今日/)
            if (width === 1440)
              await page.locator('.module-detail-panel:visible').screenshot({
                path: screenshots + '/deepseek.png',
                animations: 'disabled',
              })
            await page.keyboard.press('Escape')
            await page.locator('[data-module="quotes"] .module-detail-button').click()
            const quote = page.getByRole('slider', { name: 'QQQM 历史报价' })
            await expect(quote.locator('svg')).toBeVisible()
            await quote.press('Home')
            await expect(quote).toHaveAttribute('aria-valuetext', /USD/)
            if (width === 1440)
              await page.locator('.module-detail-panel:visible').screenshot({
                path: screenshots + '/quotes.png',
                animations: 'disabled',
              })
            assert.deepEqual(errors, [])
            await context.close()
          }
          assert.deepEqual(
            [...new Set(report.map(({ dashboardColumns }) => dashboardColumns))],
            [4, 3, 2, 1],
          )
          await writeFile(screenshots + '/geometry.json', JSON.stringify(report, null, 2))
        } finally {
          await chartsBrowser.close()
        }
      },
    )
    await t.test(
      'real browser restores admin, saves a draft and logs out on Node SSR',
      { skip: process.env.NOZOKI_TEST_BROWSER !== '1' },
      async () => {
        const { chromium } = await import('playwright')
        const { expect } = await import('playwright/test')
        const { existsSync } = await import('node:fs')
        const { exerciseSectionResets, verifyResetSave } = await import('../browser/admin-reset.ts')
        const db = new SqliteDatabase(env.NOZOKI_SQLITE_PATH)
        try {
          const current = await readConfig(db),
            config = editableConfig(current)
          config.modules.find((m) => m.id === 'quotes').sources = {}
          config.integrations = [
            {
              id: 'saved-accounts',
              provider: 'cliproxy-bridge',
              protocolVersion: 'cliproxy-v8-accounts',
            },
            { id: 'saved-legacy', provider: 'sleepy', protocolVersion: 'legacy-custom-version' },
          ].map((s) => ({
            ...s,
            baseUrl: null,
            enabled: false,
            refreshInterval: 300,
            fieldMappings: {},
            capabilities: {},
            credential: { operation: 'keep' },
          }))
          assert.equal(
            (
              await saveConfig(
                db,
                { expectedVersion: current.site.configVersion, config: bindSources(config) },
                { actor: { kind: 'system' } },
              )
            ).success,
            true,
          )
        } finally {
          db.close()
        }
        const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
        browser = await chromium.launch({
          headless: true,
          ...(existsSync(edge) ? { executablePath: edge } : {}),
        })
        const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' })
        const page = await context.newPage(),
          errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(origin + '/login')
        await page.getByLabel('邮箱', { exact: true }).fill(env.ADMIN_EMAIL)
        await page.getByLabel('密码', { exact: true }).fill(env.ADMIN_PASSWORD)
        await page.getByRole('button', { name: '登录', exact: true }).click()
        await page.waitForURL('**/admin')
        await exerciseSectionResets(page, context, origin)
        await page.getByRole('button', { name: '来源接入', exact: true }).click()
        const item = (id) => page.locator('[data-source-id="' + id + '"]')
        const sourceEditor = page.locator('.admin-edit-dialog:visible')
        const closeEditor = async () => {
          await sourceEditor.getByRole('button', { name: '关闭对话框', exact: true }).click()
          await expect(sourceEditor).toBeHidden()
        }
        await item('saved-accounts').locator('.admin-item-toggle').click()
        await expect(sourceEditor).toBeVisible()
        await expect(sourceEditor.getByLabel('协议版本', { exact: true })).toHaveCount(0)
        await page.setViewportSize({ width: 320, height: 640 })
        await expect(sourceEditor).toBeVisible()
        const editorBounds = await sourceEditor.boundingBox()
        assert.ok(editorBounds && editorBounds.x > 0 && editorBounds.x + editorBounds.width < 320)
        await closeEditor()
        await page.setViewportSize({ width: 1280, height: 720 })
        await item('saved-legacy').locator('.admin-item-toggle').click()
        await expect(sourceEditor.getByText(/旧协议暂不支持编辑/)).toBeVisible()
        await closeEditor()
        await page.getByRole('button', { name: '添加来源', exact: true }).click()
        await page
          .getByRole('dialog', { name: '选择数据源类型', exact: true })
          .getByRole('button', { name: /^Sleepy / })
          .click()
        const sleepy = page.getByRole('dialog', { name: '配置 Sleepy', exact: true })
        await expect(sleepy.getByRole('textbox', { name: '实例 HTTPS 地址' })).toBeVisible()
        await expect(sleepy.getByRole('button', { name: '添加来源', exact: true })).toBeDisabled()
        await sleepy.getByRole('button', { name: '取消', exact: true }).click()
        await expect(sleepy).toBeHidden()
        await page.getByRole('button', { name: '主页模块', exact: true }).click()
        await page.locator('[data-edit-module="links"] .admin-item-toggle').click()
        const links = sourceEditor.getByRole('list', { name: '常用链接', exact: true })
        const secondLink = await links.getByRole('listitem').nth(1).getAttribute('data-edit-link')
        await links.getByRole('button', { name: '上移链接 2', exact: true }).press('Enter')
        await expect(links.getByRole('listitem').first()).toHaveAttribute(
          'data-edit-link',
          secondLink!,
        )
        await expect(links.getByRole('button', { name: '编辑链接 1', exact: true })).toBeFocused()
        await links.getByRole('button', { name: '下移链接 1', exact: true }).press('Enter')
        await closeEditor()
        await page.getByRole('button', { name: '站点外观', exact: true }).click()
        const siteName = page.getByLabel('站点名称', { exact: true })
        await siteName.fill('')
        await page.getByRole('button', { name: '保存配置', exact: true }).click()
        await page.getByRole('button', { name: /site\.siteName/ }).click()
        await expect(siteName).toBeFocused()
        await expect(page.locator('[data-validation-target]').filter({ has: siteName })).toHaveCSS(
          'animation-name',
          'admin-validation-focus',
        )
        await siteName.fill('Browser self-host save')
        await page.getByRole('button', { name: '保存配置', exact: true }).click()
        await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
        const read = async () => (await context.request.get(origin + '/api/admin/config')).json()
        const put = async (config) => {
          const c = await read(),
            token = await (await context.request.get(origin + '/api/auth/csrf')).json()
          const r = await context.request.put(origin + '/api/admin/config', {
            headers: {
              Origin: origin,
              'X-Nozoki-CSRF': token.token,
              'Idempotency-Key': randomUUID(),
            },
            data: { expectedVersion: c.site.configVersion, config },
          })
          assert.equal(r.status(), 200, await r.text())
        }
        const persisted = await read()
        assert.equal(persisted.site.siteName, 'Browser self-host save')
        assert.equal(persisted.integrations.length, 2)
        assert.equal(
          persisted.integrations.find((i) => i.id === 'saved-legacy').protocolVersion,
          'legacy-custom-version',
        )
        // Use a draft probe response to check both winter and summer offsets without an upstream.
        let collectedAt = '2026-11-02T05:02:48.141Z'
        await page.route('**/api/admin/integrations/saved-accounts/test', (route) =>
          route.fulfill({
            json: {
              sourceId: 'saved-accounts',
              provider: 'cliproxy-bridge',
              protocolVersion: 'cliproxy-v8-accounts',
              configVersion: 1,
              status: 'error',
              reachable: null,
              protocolMatched: false,
              authentication: 'unverified',
              capabilities: { accounts: { supported: true, verified: false } },
              observedAt: null,
              collectedAt,
              code: 'AUTH_REQUIRED',
              summary: { items: 0, views: 0 },
            },
          }),
        )
        await page.reload()
        const verifyProbeTime = async (expected, timezone) => {
          if (!(await sourceEditor.isVisible())) {
            await page.getByRole('button', { name: '来源接入', exact: true }).click()
            await item('saved-accounts').locator('.admin-item-toggle').click()
          }
          await sourceEditor
            .getByRole('textbox', { name: '实例 HTTPS 地址' })
            .fill('https://codex.example.com/')
          await sourceEditor
            .locator('input[aria-label="Management Key"]')
            .fill('fixture-management-key')
          await sourceEditor.getByRole('button', { name: '测试并批准', exact: true }).click()
          const result = sourceEditor.getByRole('status').filter({ hasText: '测试时间' })
          await expect(result.locator('time')).toHaveText(expected)
          await expect(result.locator('time')).toHaveAttribute('datetime', collectedAt)
          await expect(result).toContainText('（' + timezone + '）')
        }
        await verifyProbeTime('2026-11-02 13:02', 'Asia/Shanghai')
        await closeEditor()
        const timezoneDraft = editableConfig(await read())
        timezoneDraft.site.timezone = 'America/New_York'
        timezoneDraft.site.schedule.timezone = 'America/New_York'
        await put(timezoneDraft)
        await page.reload()
        await verifyProbeTime('2026-11-02 00:02', 'America/New_York')
        collectedAt = '2026-07-02T05:02:48.141Z'
        await verifyProbeTime('2026-07-02 01:02', 'America/New_York')
        await closeEditor()
        await page.reload()
        await verifyResetSave(page, context, origin)
        await closeEditor()
        await page.getByRole('button', { name: '更多管理操作', exact: true }).click()
        await page.getByRole('menuitem', { name: '注销', exact: true }).click()
        await page.waitForURL(origin + '/login')
        const res = await context.request.get(origin + '/api/auth/session')
        assert.equal((await res.json()).viewer, 'guest')
        assert.deepEqual(errors, [])
        await context.close()
      },
    )
    await t.test(
      'logout revokes the server-side session and replay cannot read admin data',
      async () => {
        const result = await fetchJson('/api/auth/logout', {
          method: 'POST',
          headers: { Cookie: cookie, Origin: origin, 'X-Nozoki-CSRF': csrf },
        })
        assert.equal(result.response.status, 200)
        assert.equal(
          (await fetchJson('/api/admin/config', { headers: { Cookie: cookie } })).response.status,
          401,
        )
        assert.equal(
          (await fetchJson('/api/dashboard', { headers: { Cookie: cookie } })).value.viewer,
          'guest',
        )
      },
    )
    await t.test(
      'missing admin secrets retain public guest access and fail login closed',
      async () => {
        await stop(child)
        const missing = { ...env }
        delete missing.ADMIN_PASSWORD
        child = await start(entry, missing)
        assert.equal((await fetchJson('/api/dashboard')).value.viewer, 'guest')
        const bad = await fetchJson('/api/auth/login', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
        })
        assert.equal(bad.response.status, 503)
        assert.ok(!JSON.stringify(bad.value).includes(env.ADMIN_PASSWORD))
      },
    )
    await t.test(
      'HTTPS public origin produces Secure host-only cookies behind a loopback proxy',
      async () => {
        await stop(child)
        const secured = {
          ...env,
          AUTH_ORIGIN: 'https://dashboard.example.invalid',
          AUTH_ALLOW_LOCAL_HTTP: '0',
        }
        child = await start(entry, secured)
        const response = await new Promise((resolve, reject) => {
          const req = request(
            origin + '/api/auth/login',
            {
              method: 'POST',
              headers: {
                Host: 'dashboard.example.invalid',
                Origin: secured.AUTH_ORIGIN,
                'Content-Type': 'application/json',
                'X-Forwarded-Proto': 'http',
              },
            },
            (res) => {
              res.resume()
              res.once('end', () =>
                resolve({ status: res.statusCode, cookie: res.headers['set-cookie']?.[0] }),
              )
            },
          )
          req.once('error', reject)
          req.end(JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }))
        })
        assert.equal(response.status, 200)
        assert.match(response.cookie, /^__Host-nozoki_session=/)
        assert.match(response.cookie, /; Secure/)
        assert.match(response.cookie, /; HttpOnly/)
        assert.match(response.cookie, /; SameSite=Strict/)
        assert.ok(!response.cookie.includes('Domain='))
      },
    )
    await t.test(
      'concurrent failures persist limiter counts and forged proxy headers cannot reset them',
      async () => {
        await stop(child)
        child = await start(entry, env)
        const beforeDb = new SqliteDatabase(env.NOZOKI_SQLITE_PATH)
        const beforeBuckets = (
          await beforeDb.prepare('SELECT count(*) AS n FROM login_limits').first()
        ).n
        beforeDb.close()
        const attempts = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            fetchJson('/api/auth/login', {
              method: 'POST',
              headers: {
                Origin: origin,
                'Content-Type': 'application/json',
                'X-Forwarded-For': `192.0.2.${i}`,
                'CF-Connecting-IP': `198.51.100.${i}`,
              },
              body: JSON.stringify({ email: env.ADMIN_EMAIL.toUpperCase(), password: 'wrong' }),
            }),
          ),
        )
        assert.equal(attempts.filter((r) => r.response.status === 401).length, 5)
        assert.equal(attempts.filter((r) => r.response.status === 429).length, 3)
        const db = new SqliteDatabase(env.NOZOKI_SQLITE_PATH)
        try {
          const counts = (await db.prepare('SELECT failures FROM login_limits').all()).results.map(
            (r) => r.failures,
          )
          assert.ok(counts.includes(5))
          assert.equal(counts.length, beforeBuckets)
        } finally {
          db.close()
        }
        await stop(child)
        child = await start(entry, env)
        const result = await fetchJson('/api/auth/login', {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Forwarded-For': '203.0.113.9',
          },
          body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
        })
        assert.equal(result.response.status, 429)
        assert.ok(Number(result.response.headers.get('retry-after')) > 0)
      },
    )
  },
)

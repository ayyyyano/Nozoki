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
import { chromium } from 'playwright'
import { expect } from 'playwright/test'
import { existsSync } from 'node:fs'
import { formatTimestamp } from '../../shared/domain/format.ts'
import { exerciseSectionResets, verifyResetSave } from '../browser/admin-reset.mjs'
import { exerciseTailscale } from '../browser/tailscale.mjs'

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
      'real browser restores admin, saves a draft and logs out on Node SSR',
      async () => {
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
                { expectedVersion: current.site.configVersion, config },
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
        await page.getByRole('button', { name: '数据源', exact: true }).click()
        const item = (id) =>
          page.locator('.admin-editor-item').filter({ has: page.getByText(id, { exact: true }) })
        const accounts = item('saved-accounts'),
          legacy = item('saved-legacy')
        await accounts.locator('.admin-item-toggle').click()
        assert.equal(
          await accounts
            .getByLabel('协议版本', { exact: true })
            .locator('.var-select__label')
            .textContent(),
          'cliproxy-v8-accounts',
        )
        const testStarted = Date.now()
        const probeResponse = page.waitForResponse((response) =>
          response.url().endsWith('/api/admin/integrations/saved-accounts/test'),
        )
        await accounts.getByRole('button', { name: '只读测试连接', exact: true }).click()
        const probe = await (await probeResponse).json()
        assert.equal(probe.code, 'SOURCE_DISABLED')
        assert.ok(probe.collectedAt.endsWith('Z'))
        assert.ok(Date.parse(probe.collectedAt) >= testStarted - 1000)
        assert.ok(Date.parse(probe.collectedAt) <= Date.now() + 1000)
        await expect(accounts.locator('time')).toHaveText(
          formatTimestamp(probe.collectedAt, 'Asia/Shanghai'),
        )
        await expect(accounts.locator('time')).toHaveAttribute('datetime', probe.collectedAt)
        await expect(accounts.getByRole('status').filter({ hasText: '测试时间' })).toContainText(
          '（Asia/Shanghai）',
        )
        await legacy.locator('.admin-item-toggle').click()
        assert.equal(
          await legacy
            .getByLabel('协议版本', { exact: true })
            .locator('.var-select__label')
            .textContent(),
          '未支持：legacy-custom-version',
        )
        await page.getByRole('button', { name: '添加来源', exact: true }).click()
        const added = page
          .locator('fieldset')
          .filter({ has: page.locator('legend').getByText('数据源', { exact: true }) })
          .locator('.admin-editor-item')
          .last()
        const protocol = added.getByLabel('协议版本', { exact: true }).locator('.var-select__label')
        await expect(protocol).toHaveText('sleepy-v5-status')
        const urlField = added.locator('input[aria-label="服务根 HTTPS 地址"]'),
          refreshField = added.locator('input[aria-label="来源刷新间隔（秒）"]'),
          urlControl = added.locator('.admin-text').filter({
            has: page.getByLabel('服务根 HTTPS 地址', { exact: true }),
          }),
          details = urlControl.locator('.var-form-details'),
          originalUrl = await urlField.inputValue()
        const checkCounter = async (width, scenario) => {
          await expect(details).toBeVisible()
          const counter = await details.boundingBox()
          const next = await refreshField.evaluate((el) =>
            el
              .closest('.var-input')
              .querySelector('.var-field-decorator__line')
              .getBoundingClientRect()
              .toJSON(),
          )
          const control = await urlControl.boundingBox()
          assert.ok(
            counter.y + counter.height <= control.y + control.height + 1,
            `${width} ${scenario}: counter must fit inside its input's layout box`,
          )
          assert.ok(
            counter.y + counter.height + 4 <= next.top,
            `${width} ${scenario}: counter overlaps next field (${counter.y + counter.height} vs ${next.top})`,
          )
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          )
        }
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 900 })
          await urlField.fill('')
          await checkCounter(width, 'focused empty field')
          await refreshField.focus()
          await expect(details).toBeHidden()
          await urlField.fill('https://example.invalid/' + 'x'.repeat(1850))
          await refreshField.focus()
          await checkCounter(width, 'near-limit blurred field')
        }
        await urlField.fill(originalUrl)
        await refreshField.focus()
        await page.setViewportSize({ width: 1280, height: 720 })
        const select = async (label, value) => {
          await added.getByLabel(label, { exact: true }).click()
          await page
            .locator('.var-menu__menu:visible .var-option')
            .filter({ hasText: new RegExp('^' + value + '$') })
            .click()
        }
        for (const [provider, expected] of [
          ['deepseek', 'deepseek-balance-v1'],
          ['uptime-kuma', 'kuma-public-2.0.2'],
          ['uptimeflare', 'uptimeflare-data-2024'],
          ['cliproxy-bridge', 'cliproxy-v8-accounts'],
        ]) {
          await select('Provider', provider)
          await expect(protocol).toHaveText(expected)
        }
        await select('协议版本', 'cliproxy-v8-accounts')
        await expect(protocol).toHaveText('cliproxy-v8-accounts')
        await select('Provider', 'cliproxy-bridge')
        await expect(protocol).toHaveText('cliproxy-v8-accounts')
        await select('Provider', 'quotes-custom')
        await expect(protocol).toHaveText('tencent-us-v1')
        await select('Provider', 'sleepy')
        await expect(protocol).toHaveText('sleepy-v5-status')
        assert.equal(
          await added
            .getByLabel('凭据操作', { exact: true })
            .locator('.var-select__label')
            .textContent(),
          'keep · 保留',
        )
        await page.getByRole('button', { name: '站点与外观', exact: true }).click()
        await page.getByLabel('站点名称', { exact: true }).fill('Browser self-host save')
        await page.getByRole('button', { name: '保存配置', exact: true }).click()
        await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
        await page.reload()
        assert.equal(
          await page.getByLabel('站点名称', { exact: true }).inputValue(),
          'Browser self-host save',
        )
        const persisted = (await (await context.request.get(origin + '/api/admin/config')).json())
          .integrations
        assert.equal(
          persisted.find((i) => i.id === 'saved-accounts').protocolVersion,
          'cliproxy-v8-accounts',
        )
        assert.equal(
          persisted.find((i) => i.id === 'saved-legacy').protocolVersion,
          'legacy-custom-version',
        )
        assert.equal(
          persisted.find((i) => i.id.startsWith('source-')).protocolVersion,
          'sleepy-v5-status',
        )
        // Fixed probe fixtures exercise display only; disabled sources never contact an upstream.
        let collectedAt = '2026-11-02T05:02:48.141Z'
        await page.route('**/api/admin/integrations/saved-accounts/test', (route) =>
          route.fulfill({ json: { ...probe, collectedAt } }),
        )
        const verifyProbeTime = async (expected, timezone) => {
          await page.getByRole('button', { name: '数据源', exact: true }).click()
          const source = item('saved-accounts')
          await source.locator('.admin-item-toggle').click()
          await source.getByRole('button', { name: '只读测试连接', exact: true }).click()
          await expect(source.locator('time')).toHaveText(expected)
          await expect(source.locator('time')).toHaveAttribute('datetime', collectedAt)
          await expect(source.getByRole('status').filter({ hasText: '测试时间' })).toContainText(
            `（${timezone}）`,
          )
        }
        await verifyProbeTime('2026-11-02 13:02', 'Asia/Shanghai')
        const current = await (await context.request.get(origin + '/api/admin/config')).json()
        const timezoneDraft = editableConfig(current)
        timezoneDraft.site.timezone = 'America/New_York'
        timezoneDraft.site.schedule.timezone = 'America/New_York'
        const browserCsrf = await (await context.request.get(origin + '/api/auth/csrf')).json()
        const timezoneSave = await context.request.put(origin + '/api/admin/config', {
          headers: {
            Origin: origin,
            'X-Nozoki-CSRF': browserCsrf.token,
            'Idempotency-Key': randomUUID(),
          },
          data: { expectedVersion: current.site.configVersion, config: timezoneDraft },
        })
        assert.equal(timezoneSave.status(), 200)
        await page.reload()
        await verifyProbeTime('2026-11-02 00:02', 'America/New_York')
        collectedAt = '2026-07-02T05:02:48.141Z'
        await item('saved-accounts')
          .getByRole('button', { name: '只读测试连接', exact: true })
          .click()
        await expect(item('saved-accounts').locator('time')).toHaveText('2026-07-02 01:02')
        await verifyResetSave(page, context, origin)
        await exerciseTailscale(page, context, origin, env.NOZOKI_SQLITE_PATH)
        await page.getByRole('button', { name: '更多管理操作', exact: true }).click()
        await page.getByRole('menuitem', { name: '注销', exact: true }).click()
        await page.waitForURL(origin + '/login')
        const res = await context.request.get(origin + '/api/auth/session')
        assert.equal((await res.json()).viewer, 'guest')
        assert.ok(
          !JSON.stringify(
            await (await context.request.get(origin + '/api/dashboard')).json(),
          ).includes('100.64.1.2'),
        )
        assert.ok(!(await (await context.request.get(origin)).text()).includes('100.64.1.2'))
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

// All snapshots, credentials and databases here are synthetic and isolated from deployment state.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { credentialKeys } from '../../server/services/credential-keys.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'
import {
  presentationSources,
  presentationSnapshots,
  fullCodexPresentation,
} from '../fixtures/presentation.ts'

const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
async function walk(dir: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)],
      ),
    )
  ).flat()
}
test(
  'module presentation persists with CAS and enforces guest privacy through HTTP, SSR and details',
  { timeout: 180000 },
  async (t) => {
    const baseline = process.env.NOZOKI_PRESENTATION_BASELINE === '1'
    const root = resolve('.output/server'),
      origin = 'http://127.0.0.1:8822'
    const env = {
      ADMIN_EMAIL: 'display@example.invalid',
      ADMIN_PASSWORD: 'Synthetic-' + randomToken(),
      AUTH_RATE_LIMIT_SECRET: randomToken(),
      AUTH_ORIGIN: origin,
      AUTH_ALLOW_LOCAL_HTTP: '1',
      AUTH_VERSION: '1',
      INTEGRATION_ENCRYPTION_KEY: randomToken(),
      INTEGRATION_KEY_VERSION: 'v1',
    }
    const opts = convertV4MiniflareOptions({
      modules: (await walk(root))
        .filter((p) => p.endsWith('.mjs'))
        .sort((a, b) =>
          a === resolve(root, 'index.mjs')
            ? -1
            : b === resolve(root, 'index.mjs')
              ? 1
              : a.localeCompare(b),
        )
        .map((path) => ({ type: 'ESModule', path })),
      modulesRoot: root,
      host: '127.0.0.1',
      port: process.env.NOZOKI_TEST_BROWSER === '1' || baseline ? 8822 : 0,
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat'],
      bindings: env,
      d1Databases: { DB: 'presentation-isolated' },
      assets: {
        directory: resolve('.output/public'),
        routerConfig: { has_user_worker: true },
        assetConfig: {},
      },
      outboundService: () => {
        throw new Error('Presentation tests must not fetch providers')
      },
    })
    opts.resourcePersistencePath = await mkdtemp(resolve('.wrangler/presentation-d1-'))
    const mf = new Miniflare(opts)
    let browser
    t.after(async () => {
      await browser?.close()
      await mf.dispose()
    })
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
      await db.batch(
        unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      )
    const current = await readConfig(db),
      config = editableConfig(current)
    config.integrations = presentationSources().map(({ credentialState: _, ...source }) => ({
      ...source,
      credential:
        source.provider === 'tailscale'
          ? { operation: 'replace', value: '{"clientId":"synthetic","clientSecret":"synthetic"}' }
          : { operation: 'keep' },
    }))
    config.quotes = []
    for (const module of config.modules) {
      module.enabled = ['tailscale', 'codex', 'services'].includes(module.id)
      module.sources = {}
      module.fields = {}
      module.visibility = 'public'
      const source = config.integrations.find(
        (i) =>
          i.provider ===
          { tailscale: 'tailscale', codex: 'cliproxy-bridge', services: 'uptimeflare' }[module.id],
      )
      if (source) module.sources.main = { sourceId: source.id, subject: 'default' }
      if (module.id === 'tailscale') module.ipVisibility = 'public'
      if (module.id === 'codex' && !baseline) module.presentation = fullCodexPresentation()
    }
    assert.equal(
      (
        await saveConfig(
          db,
          { expectedVersion: current.site.configVersion, config },
          { actor: { kind: 'system' }, keys: await credentialKeys(env) },
        )
      ).success,
      true,
    )
    const { devices: _devices, ...snapshots } = presentationSnapshots(new Date(), baseline)
    for (const [moduleId, snapshot] of Object.entries(snapshots))
      await upsertSnapshot(db, {
        sourceId: snapshot.sourceId,
        subject: 'default',
        moduleId,
        snapshot,
        updatedAt: snapshot.collectedAt,
      })
    const login = await mf.dispatchFetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const csrf = (
      await (
        await mf.dispatchFetch(origin + '/api/auth/csrf', { headers: { Cookie: cookie } })
      ).json()
    ).token
    const request = (path, method = 'GET', body?, key = crypto.randomUUID()) =>
      mf.dispatchFetch(origin + path, {
        method,
        headers: {
          Cookie: cookie,
          ...(method === 'GET'
            ? {}
            : {
                Origin: origin,
                'Content-Type': 'application/json',
                'X-Nozoki-CSRF': csrf,
                'Idempotency-Key': key,
              }),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    const input = async () => {
      const c = await (await request('/api/admin/config')).json()
      return { expectedVersion: c.site.configVersion, config: editableConfig(c) }
    }
    if (process.env.NOZOKI_TEST_BROWSER === '1' || baseline) {
      const { launch, settle, select } = await import('../browser/support.ts')
      const { expect } = await import('playwright/test')
      browser = await launch()
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      await context.addCookies([
        { name: cookie.split('=')[0], value: cookie.slice(cookie.indexOf('=') + 1), url: origin },
      ])
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      const evidence = process.env.NOZOKI_PRESENTATION_EVIDENCE
      if (evidence) await mkdir(evidence, { recursive: true })
      const metrics = []
      for (const [width, height] of [
        [1440, 900],
        [1280, 720],
        [1024, 768],
        [813, 1024],
        [768, 1024],
        [390, 844],
        [320, 844],
      ]) {
        await page.setViewportSize({ width, height })
        await page.goto(origin)
        await settle(page)
        await page.locator('[data-module="services"] h2').waitFor()
        metrics.push(
          await page.evaluate(() => {
            const grid = document.querySelector('.dashboard-grid')!
            return {
              width: innerWidth,
              pageWidth: document.documentElement.scrollWidth,
              grid: grid.getBoundingClientRect().toJSON(),
              gap: parseFloat(getComputedStyle(grid).columnGap),
              cards: [...grid.querySelectorAll(':scope > [data-module]')].map((e) => ({
                id: e.getAttribute('data-module'),
                ...e.getBoundingClientRect().toJSON(),
                contentFits: e.scrollHeight <= e.clientHeight + 1,
              })),
            }
          }),
        )
        if (!baseline) {
          await expect(page.locator('[data-module="tailscale"] .tailnet-device')).toHaveCount(8)
          await expect(page.locator('[data-module="codex"] .codex-ring')).toHaveCount(2)
          await expect(page.locator('[data-module="codex"] .quota-row')).toHaveCount(0)
          assert.ok(metrics.at(-1).pageWidth <= width)
          assert.ok(metrics.at(-1).cards.every((c) => c.contentFits))
          if (width === 813) {
            const {
              grid,
              gap,
              cards: [tailscale, codex, services],
            } = metrics.at(-1)
            assert.ok(Math.abs(tailscale.y - codex.y) < 1)
            assert.ok(Math.abs(codex.x - tailscale.right - gap) < 1)
            assert.ok(Math.abs(services.y - tailscale.bottom - gap) < 1)
            assert.ok(Math.abs(services.x - grid.x) < 1)
            assert.ok(Math.abs(services.right - grid.right) < 1)
          }
          assert.ok(
            Math.abs(
              metrics.at(-1).cards.find((c) => c.id === 'tailscale').height -
                metrics.at(-1).cards.find((c) => c.id === 'services').height,
            ) <= 1,
          )
          await expect(page.locator('[data-module="services"] .monitor-row em')).toHaveCount(0)
          if (width >= 1024)
            assert.ok(
              Math.max(...metrics.at(-1).cards.map((c) => c.height)) -
                Math.min(...metrics.at(-1).cards.map((c) => c.height)) <=
                1,
            )
        }
        if (evidence)
          await page.screenshot({
            path: resolve(evidence, `${baseline ? 'before' : 'after'}-${width}.png`),
            fullPage: true,
          })
      }
      if (evidence)
        await writeFile(
          resolve(evidence, `${baseline ? 'before' : 'after'}-metrics.json`),
          JSON.stringify(metrics, null, 2),
        )
      console.log(JSON.stringify({ mode: baseline ? 'before' : 'after', metrics }))
      if (baseline) return
      await page.setViewportSize({ width: 1280, height: 900 })
      for (const [id, count, selector] of [
        ['tailscale', 10, '.tailnet-device'],
        ['codex', 4, '.codex-ring'],
        ['services', 8, '.monitor-row'],
      ]) {
        await page.locator(`[data-module="${id}"]`).getByRole('button', { name: /详情/ }).click()
        await expect(page.locator('.module-detail-panel:visible').locator(selector)).toHaveCount(
          count,
        )
        if (id === 'services')
          await expect(
            page.locator('.module-detail-panel:visible .monitor-meta').first(),
          ).toHaveText(/service-0\s*·\s*30 ms/)
        if (evidence)
          await page.screenshot({
            path: resolve(evidence, `detail-${id}.png`),
            animations: 'disabled',
          })
        await page.keyboard.press('Escape')
        await expect(page.locator('.module-detail-panel:visible')).toHaveCount(0)
      }
      await page.goto(origin + '/admin')
      await page.getByRole('button', { name: '主页模块', exact: true }).click()
      await page.locator('[data-edit-module="codex"] .admin-item-toggle').click()
      await select(page, 'Codex 左侧圆环', '周重置进度')
      await expect(page.getByLabel('Codex 左侧圆环', { exact: true })).toContainText('周重置进度')
      const saving = page.waitForResponse(
        (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: '保存配置', exact: true }).click()
      assert.equal((await saving).status(), 200)
      await page.goto(origin)
      await settle(page)
      await expect(page.locator('[data-module="codex"] .codex-ring').first()).toHaveAttribute(
        'data-ring',
        'weeklyResetProgress',
      )
      await page.goto(origin + '/admin')
      await page.getByRole('button', { name: '来源接入', exact: true }).click()
      await page.getByRole('button', { name: '添加来源', exact: true }).click()
      const picker = page.getByRole('dialog', { name: '选择数据源类型', exact: true })
      await expect(picker.getByRole('button').filter({ hasText: 'Uptime Kuma' })).toContainText(
        '实验性',
      )
      await expect(picker.getByRole('button').filter({ hasText: 'UptimeFlare' })).not.toContainText(
        '实验性',
      )
      assert.deepEqual(errors, [])
      await context.close()
    }
    if (baseline) return
    const value = await input()
    value.config.modules.find((m) => m.id === 'tailscale').presentation = {
      tailnetName: 'masked',
      tailnetIp: 'masked',
    }
    const cpa = value.config.modules.find((m) => m.id === 'codex')
    cpa.presentation = fullCodexPresentation()
    cpa.presentation.codex.slots = ['weeklyResetProgress', 'fiveHourRemaining']
    cpa.presentation.codex.guest.weeklyRemaining = 'hidden'
    cpa.presentation.codex.guest.fiveHourResetProgress = 'masked'
    const key = crypto.randomUUID()
    assert.equal((await request('/api/admin/config', 'PUT', value, key)).status, 200)
    assert.equal(
      (await (await request('/api/admin/config', 'PUT', value, key)).json()).replayed,
      true,
    )
    assert.equal((await request('/api/admin/config', 'PUT', value)).status, 409)
    const reread = await input()
    assert.deepEqual(
      reread.config.modules.find((m) => m.id === 'codex').presentation,
      cpa.presentation,
    )
    const guest = await (await mf.dispatchFetch(origin + '/api/dashboard')).json()
    const guestText = JSON.stringify(guest)
    assert.ok(!guestText.includes('SYNTHETIC NODE'))
    assert.ok(!guestText.includes('100.64.'))
    assert.ok(!guestText.includes('fd7a:115c'))
    const ringData = guest.modules.find((m) => m.id === 'codex').snapshot.data
    assert.equal(ringData.quota, undefined)
    assert.deepEqual(ringData.ringView.home, ['weeklyResetProgress', 'fiveHourRemaining'])
    assert.equal(
      ringData.ringView.rings.some((r) => r.id === 'weeklyRemaining'),
      false,
    )
    assert.deepEqual(
      ringData.ringView.rings.find((r) => r.id === 'fiveHourResetProgress'),
      { id: 'fiveHourResetProgress', state: 'masked' },
    )
    const html = await (await mf.dispatchFetch(origin)).text()
    for (const secret of ['SYNTHETIC NODE', '100.64.', 'fd7a:115c'])
      assert.ok(!html.includes(secret))
    if (browser) {
      const { expect } = await import('playwright/test')
      const { settle } = await import('../browser/support.ts')
      const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await guestContext.newPage()
      await page.goto(origin)
      await settle(page)
      const tail = page.locator('[data-module="tailscale"]')
      await expect(tail.locator('.tailnet-device')).toHaveCount(8)
      await expect(tail).toContainText('名称已遮蔽')
      await expect(tail).toContainText('IP 已遮蔽')
      for (const marker of ['SYNTHETIC NODE', '100.64.', 'fd7a:115c'])
        assert.ok(!(await page.content()).includes(marker))
      await page.locator('[data-module="codex"]').getByRole('button', { name: /详情/ }).click()
      const detail = page.locator('.module-detail-panel:visible')
      await expect(detail.locator('[data-ring="weeklyRemaining"]')).toHaveCount(0)
      await expect(detail.locator('[data-ring="fiveHourResetProgress"] .var-progress')).toHaveCount(
        0,
      )
      await page.keyboard.press('Escape')
      await expect(page.locator('.module-detail-panel:visible')).toHaveCount(0)
      const hidden = await input()
      hidden.config.modules.find((m) => m.id === 'tailscale').presentation = {
        tailnetName: 'hidden',
        tailnetIp: 'hidden',
      }
      assert.equal((await request('/api/admin/config', 'PUT', hidden)).status, 200)
      await page.reload()
      await settle(page)
      await expect(tail).not.toContainText('IP 已遮蔽')
      await expect(tail).not.toContainText('名称已遮蔽')
      for (const marker of ['SYNTHETIC NODE', '100.64.', 'fd7a:115c'])
        assert.ok(!(await page.content()).includes(marker))
      await guestContext.close()
    }
  },
)

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { randomToken } from '../../server/services/auth-crypto.ts'
import { setupUsageConfig } from '../fixtures/codex-usage-config.ts'
import { usageRecord } from '../fixtures/codex-usage.ts'
import { readCodexUsageDays } from '../../server/repositories/codex-usage.ts'
import { readAdminDashboard, readGuestDashboard } from '../../server/services/dashboard.ts'
import { sourceRemovalState } from '../../server/services/source-removal.ts'
import { readConfig, saveConfig } from '../../server/services/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { fieldPointer } from '../../shared/contracts/field-paths.ts'
import { upsertSnapshot } from '../../server/repositories/telemetry.ts'

const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare')
const { unstable_splitSqlQuery } = require('wrangler')
async function serverModules(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? serverModules(resolve(directory, e.name)) : [resolve(directory, e.name)],
      ),
    )
  ).flat()
}

test(
  'leased Worker queue collection persists increments, protects history, probes and field ACL',
  { timeout: 180000 },
  async (t) => {
    const folder = await mkdtemp(resolve('.wrangler/codex-usage-d1-'))
    const script = (
      await build({
        entryPoints: ['tests/integration/codex-usage-worker.ts'],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        external: ['cloudflare:workers'],
      })
    ).outputFiles[0].text
    const env = {
      COLLECTOR_EPOCH: '1',
      INTEGRATION_ENCRYPTION_KEY: randomToken(),
      INTEGRATION_KEY_VERSION: 'v1',
      ADMIN_EMAIL: 'usage@example.invalid',
      ADMIN_PASSWORD: 'Synthetic-' + randomToken(),
      AUTH_VERSION: '1',
      AUTH_RATE_LIMIT_SECRET: randomToken(),
      AUTH_ORIGIN: 'http://127.0.0.1:8812',
      AUTH_ALLOW_LOCAL_HTTP: '1',
    }
    const startedAt = Date.now(),
      usageTimestamp = new Date(startedAt - 86400000).toISOString()
    let at = startedAt,
      queue = [
        usageRecord(new Date(startedAt - 2 * 86400000).toISOString()),
        usageRecord(usageTimestamp),
      ],
      pops = 0,
      disabled = 0,
      quotaReads = 0,
      quotaUsed = 18,
      quotaFailure = false
    const wire = async (request) => {
      const url = new URL(request.url)
      assert.equal(request.headers.get('authorization'), 'Bearer SYNTHETIC-MANAGEMENT-ONLY')
      if (url.pathname === '/v8/management/requests/api-call') {
        assert.equal(request.method, 'POST')
        assert.equal(url.search, '')
        assert.deepEqual(await request.json(), {
          auth_index: 'a1',
          method: 'GET',
          url: 'https://chatgpt.com/backend-api/wham/usage',
          header: { Authorization: 'Bearer $TOKEN$', Accept: 'application/json' },
        })
        quotaReads++
        return Response.json({
          status_code: quotaFailure ? 503 : 200,
          body: JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: quotaUsed,
                limit_window_seconds: 18000,
                reset_at: Math.floor(at / 1000) + 3600,
              },
              secondary_window: {
                used_percent: 10,
                limit_window_seconds: 604800,
                reset_at: Math.floor(at / 1000) + 86400,
              },
            },
          }),
        })
      }
      assert.equal(request.method, 'GET')
      if (url.pathname.endsWith('/usage/queue')) {
        assert.equal(url.search, '?count=50')
        const lease = await db
          .prepare(
            "SELECT run_id,lease_until FROM collection_state WHERE source_id='usage-fixture'",
          )
          .first()
        assert.ok(lease.run_id)
        assert.ok(String(lease.lease_until) > new Date(at).toISOString())
        pops++
        if (disabled) return new Response(null, { status: disabled })
        const batch = queue
        queue = []
        return Response.json(batch)
      }
      assert.equal(url.pathname, '/v8/management/credentials')
      return Response.json({
        observed_at: new Date(at).toISOString(),
        files: [
          {
            auth_index: 'a1',
            provider: 'codex',
            status: 'ready',
            disabled: false,
            unavailable: false,
          },
        ],
      })
    }
    const browserTest = process.env.NOZOKI_TEST_BROWSER === '1'
    const common = {
      compatibilityDate: '2026-10-19',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      bindings: env,
      d1Databases: { DB: 'codex-usage-isolated' },
      outboundService: wire,
    }
    const root = resolve('.output/server')
    const modules = browserTest
      ? (await serverModules(root))
          .filter((p) => p.endsWith('.mjs'))
          .sort((a, b) =>
            a === resolve(root, 'index.mjs')
              ? -1
              : b === resolve(root, 'index.mjs')
                ? 1
                : a.localeCompare(b),
          )
          .map((path) => ({ type: 'ESModule', path }))
      : []
    const options = convertV4MiniflareOptions({
      port: 8812,
      host: '127.0.0.1',
      workers: [
        ...(browserTest
          ? [
              {
                ...common,
                name: 'dashboard',
                modules,
                modulesRoot: root,
                assets: {
                  directory: resolve('.output/public'),
                  routerConfig: { has_user_worker: true },
                  assetConfig: {},
                },
              },
            ]
          : []),
        { ...common, name: 'collector', modules: true, script },
      ],
    })
    options.resourcePersistencePath = folder
    let mf = new Miniflare(options)
    t.after(() => mf.dispose())
    let db = await mf.getD1Database('DB', 'collector'),
      worker = await mf.getWorker('collector')
    for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
      await db.batch(
        unstable_splitSqlQuery(await readFile('migrations/' + file, 'utf8')).map((sql) =>
          db.prepare(sql),
        ),
      )
    await setupUsageConfig(db, env)
    assert.equal(
      await (await worker.fetch('https://harness.invalid/probe?at=' + at)).json(),
      true,
      'saved probe',
    )
    assert.equal(await (await worker.fetch('https://harness.invalid/draft?at=' + at)).json(), true)
    assert.equal(pops, 0)
    assert.equal(quotaReads, 0)
    const collect = async () => {
      const report = await (await worker.fetch('https://harness.invalid/collect?at=' + at)).json()
      assert.equal(report.success, 1)
      assert.equal(report.failure, 0)
      assert.equal(report.requests, 2)
    }
    await collect()
    assert.equal(pops, 1)
    const duplicate = await (await worker.fetch('https://harness.invalid/collect?at=' + at)).json()
    assert.equal(duplicate.selected, 0)
    assert.equal(pops, 1)
    assert.equal((await readCodexUsageDays(db, 'usage-fixture', new Date(at))).length, 2)
    await mf.dispose()
    mf = new Miniflare(options)
    db = await mf.getD1Database('DB', 'collector')
    worker = await mf.getWorker('collector')
    at += 600000
    queue = [{ ...usageRecord(usageTimestamp), failed: true }]
    await collect()
    const days = await readCodexUsageDays(db, 'usage-fixture', new Date(at))
    assert.equal(days.at(-1).total, 240)
    assert.equal(days.at(-1).requests, 2)
    assert.equal(days.at(-1).failed, 1)
    at += 600000
    disabled = 404
    await collect()
    assert.deepEqual(await readCodexUsageDays(db, 'usage-fixture', new Date(at)), days)
    const snapshotRow = () =>
      db
        .prepare(
          "SELECT snapshot_json FROM integration_snapshot_views WHERE source_id='usage-fixture'",
        )
        .first()
    const view = JSON.parse((await snapshotRow()).snapshot_json)
    assert.equal(view.data.capabilities.usage.supported, false)
    assert.deepEqual(view.data.usage.days, days)
    assert.equal((await sourceRemovalState(db, 'usage-fixture')).protectedHistory, true)
    await assert.rejects(
      db.prepare("DELETE FROM integrations WHERE id='usage-fixture'").run(),
      /NOZOKI_SOURCE_HAS_HISTORY/,
    )
    const admin = await readAdminDashboard(db, new Date(at)),
      guest = await readGuestDashboard(db, new Date(at))
    assert.equal(admin.modules[0].snapshot.data.usage.days.at(-1).total, 240)
    assert.equal(guest.modules[0].kind, 'login_required')
    assert.ok(!JSON.stringify(guest).includes('cproxy-queue-v8'))
    let current = await readConfig(db),
      config = editableConfig(current)
    config.modules.find((m) => m.id === 'codex').visibility = 'public'
    config.modules.find((m) => m.id === 'codex').fields[fieldPointer(['usage'])] = {
      enabled: true,
      visibility: 'admin',
    }
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
    const filtered = await readGuestDashboard(db, new Date(at))
    assert.equal(filtered.modules[0].kind, 'data')
    assert.ok(!JSON.stringify(filtered).includes('cproxy-queue-v8'))
    assert.ok(!JSON.stringify(admin).includes('synthetic-model'))
    assert.ok(!JSON.stringify(admin).includes('synthetic-request'))
    if (browserTest) {
      const { launch, settle } = await import('../browser/support.ts')
      const { expect } = await import('playwright/test')
      const browser = await launch()
      try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
        const page = await context.newPage()
        await page.goto(env.AUTH_ORIGIN)
        await settle(page)
        // Public account states remain visible while the protected usage subtree is absent.
        const card = page.locator('[data-module="codex"]')
        await expect(card.locator('.codex-usage')).toHaveCount(0)
        assert.ok(
          !(await (await page.request.get(env.AUTH_ORIGIN + '/api/dashboard')).text()).includes(
            'cproxy-queue-v8',
          ),
        )
        await page.goto(env.AUTH_ORIGIN + '/login')
        await page.locator('input[aria-label="邮箱"]').fill(env.ADMIN_EMAIL)
        await page.locator('input[aria-label="密码"]').fill(env.ADMIN_PASSWORD)
        await page.getByRole('button', { name: '登录', exact: true }).click()
        await page.waitForURL('**/admin')
        await page.goto(env.AUTH_ORIGIN)
        await settle(page)
        await expect(card.locator('.codex-usage-day')).toHaveCount(0)
        await expect(card.locator('.codex-ring')).toHaveCount(2)
        await card.getByRole('button', { name: /查看.*详情/ }).click()
        const dialog = page.getByRole('dialog', { name: 'Codex详情', exact: true })
        await expect(dialog.locator('.codex-usage-day')).toHaveCount(2)
        await expect(dialog.getByText('总 Token 240', { exact: true })).toBeVisible()
        await expect(dialog.getByText('总 Token 120', { exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialog).not.toBeVisible()
        await page.setViewportSize({ width: 320, height: 844 })
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true)
        const empty = JSON.parse((await snapshotRow()).snapshot_json)
        empty.data.usage.days = []
        empty.data.usage.coverageStart = null
        await upsertSnapshot(db, {
          sourceId: 'usage-fixture',
          subject: 'default',
          moduleId: 'codex',
          updatedAt: new Date(at).toISOString(),
          snapshot: empty,
        })
        await page.reload()
        await settle(page)
        await card.getByRole('button', { name: /查看.*详情/ }).click()
        await expect(dialog.getByText('暂无队列用量', { exact: true })).toBeVisible()
        await context.close()
      } finally {
        await browser.close()
      }
    }
    // A failed transaction cannot commit its snapshot or increment independently.
    disabled = 0
    const snapshotBeforeFailure = await snapshotRow()
    await db
      .prepare(
        "CREATE TRIGGER reject_usage_fixture BEFORE UPDATE ON codex_usage_days BEGIN SELECT RAISE(ABORT,'SYNTHETIC_COMMIT_FAILURE'); END",
      )
      .run()
    at += 600000
    queue = [usageRecord(usageTimestamp)]
    const failed = await (await worker.fetch('https://harness.invalid/collect?at=' + at)).json()
    assert.equal(failed.failure, 1)
    assert.equal(queue.length, 0)
    assert.deepEqual(await readCodexUsageDays(db, 'usage-fixture', new Date(at)), days)
    assert.deepEqual(await snapshotRow(), snapshotBeforeFailure)
    await db.prepare('DROP TRIGGER reject_usage_fixture').run()
    assert.equal(quotaReads, 0)
    const scheduledQuota = async () => {
      at += 1800000
      const report = await (
        await worker.fetch('https://harness.invalid/collect?quota&at=' + at)
      ).json()
      assert.equal(report.success, 1)
      assert.equal(report.requests, 3)
      return JSON.parse((await snapshotRow()).snapshot_json).data.quota.accounts[0].windows
    }
    const first = await scheduledQuota()
    assert.equal(first[0].remainingPercent, '82')
    assert.equal(first[1].remainingPercent, '90')
    quotaUsed = 53
    const changed = await scheduledQuota()
    assert.equal(changed[0].remainingPercent, '47')
    assert.ok(changed[0].observedAt > first[0].observedAt)
    quotaFailure = true
    assert.deepEqual(
      await scheduledQuota(),
      changed.map((w) => ({ ...w, status: 'stale' })),
    )
    assert.equal(quotaReads, 3)
    assert.deepEqual(await readCodexUsageDays(db, 'usage-fixture', new Date(at)), days)
    const stale = await readAdminDashboard(db, new Date(at))
    const rings = stale.modules[0].snapshot.data.ringView.rings
    assert.equal(rings[0].state, 'stale')
    assert.equal(rings[0].last.percent, 47)
    const publicStale = await readGuestDashboard(db, new Date(at))
    assert.deepEqual(publicStale.modules[0].snapshot.data.ringView.rings[0], {
      id: 'fiveHourRemaining',
      state: 'masked',
    })
    if (browserTest) {
      const { launch, settle } = await import('../browser/support.ts')
      const { expect } = await import('playwright/test')
      const browser = await launch()
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
        await page.clock.setFixedTime(new Date(at))
        await page.route('**/api/dashboard', (route) => route.fulfill({ json: stale }))
        await page.goto(env.AUTH_ORIGIN)
        await settle(page)
        const response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
        await page.evaluate(() => dispatchEvent(new Event('focus')))
        await response
        const ring = page.locator('[data-ring="fiveHourRemaining"]')
        await expect(ring).toHaveAttribute('data-state', 'stale')
        await expect(ring.getByText('47%', { exact: true })).toBeVisible()
        await expect(ring.getByText(/已过期/)).toBeVisible()
      } finally {
        await browser.close()
      }
    }
  },
)

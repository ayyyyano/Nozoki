// Explicit live check: node --experimental-strip-types tests/browser/yahoo-live.mjs
// Uses a fresh SQLite database and synthetic administrator, never the daily database.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { expect } from 'playwright/test'

const folder = await mkdtemp(join(tmpdir(), 'nozoki-yahoo-live-'))
const server = createServer()
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
await new Promise((r) => server.close(r))
const origin = `http://127.0.0.1:${port}`
const env = {
  ...process.env,
  HOST: '127.0.0.1',
  PORT: String(port),
  NOZOKI_SQLITE_PATH: join(folder, 'db.sqlite'),
  ADMIN_EMAIL: 'live-test@example.invalid',
  ADMIN_PASSWORD: randomBytes(32).toString('base64url'),
  AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString('base64url'),
  AUTH_VERSION: '1',
  AUTH_ORIGIN: origin,
  AUTH_ALLOW_LOCAL_HTTP: '1',
  COLLECTOR_EPOCH: '1',
  NOZOKI_PUBLIC_ROUTES: JSON.stringify([
    {
      id: 'yahoo-live',
      provider: 'quotes-custom',
      protocolVersion: 'yahoo-chart-v8',
      baseUrl: 'https://query1.finance.yahoo.com/',
      authentication: 'none',
    },
  ]),
}
for (const key of [
  'NOZOKI_RELAY_CONFIG_FILE',
  'NOZOKI_PRIVATE_ROUTES',
  'INTEGRATION_ENCRYPTION_KEY',
  'NOZOKI_PRIVATE_RELAY_TOKEN',
])
  delete env[key]

function child(file, args = []) {
  const process = spawn(globalThis.process.execPath, [resolve('.output-node', file), ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  process.stdout.on('data', (v) => (output += v))
  process.stderr.on('data', (v) => (output += v))
  return { process, output: () => output }
}
async function command(file, args) {
  const c = child(file, args)
  const code = await new Promise((r, reject) => {
    c.process.once('exit', r)
    c.process.once('error', reject)
  })
  assert.equal(code, 0, c.output())
  return c.output()
}
await command('database.mjs', ['migrate'])
const running = child('start.mjs')
let browser
try {
  for (let i = 0; i < 200 && !running.output().includes('Nozoki listening'); i++) {
    assert.equal(running.process.exitCode, null, running.output())
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.match(running.output(), /Nozoki listening/)
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(edge) ? { executablePath: edge } : {}),
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(origin + '/login')
  await page.getByLabel('邮箱', { exact: true }).fill(env.ADMIN_EMAIL)
  await page.getByLabel('密码', { exact: true }).fill(env.ADMIN_PASSWORD)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL('**/admin')
  const section = (name) => page.getByRole('button', { name, exact: true }).click()
  const select = async (scope, label, value) => {
    await scope.getByLabel(label, { exact: true }).click()
    const option = page
      .locator('.var-menu__menu:visible .var-option')
      .filter({ hasText: new RegExp('^' + value + '$') })
    await expect(option).toHaveCount(1)
    await option.click()
    await expect(option).toHaveCount(0)
  }
  await section('数据源')
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  const source = page.locator('fieldset:visible .admin-editor-item').last()
  await source.locator('input[aria-label="来源 ID"]').fill('yahoo-live')
  await select(source, 'Provider', 'quotes-custom')
  await expect(source.getByLabel('协议版本').locator('.var-select__label')).toHaveText(
    'yahoo-chart-v8',
  )
  await source
    .locator('input[aria-label="服务根 HTTPS 地址"]')
    .fill('https://query1.finance.yahoo.com/')
  const enabled = source.getByRole('switch', { name: '启用来源', exact: true })
  if ((await enabled.getAttribute('aria-checked')) !== 'true') {
    await enabled.locator('.var-switch__ripple').focus()
    await page.keyboard.press('Space')
  }
  await expect(enabled).toHaveAttribute('aria-checked', 'true')
  await section('行情标的')
  for (let i = 0; i < 2; i++) {
    const quote = page.locator('fieldset:visible .admin-editor-item').nth(i)
    await quote.locator('.admin-item-toggle').click()
    await select(quote, `标的 ${i + 1} Provider`, 'yahoo-live')
  }
  await section('Dashboard 模块')
  const module = page.locator('[data-edit-module="quotes"]')
  await module.locator('.admin-item-toggle').click()
  await select(module, 'quotes 模块权限', '公开')
  await module.locator('summary').filter({ hasText: '数据源引用' }).click()
  await module.getByRole('button', { name: '添加 main 引用', exact: true }).click()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
  await page.reload()
  const configResponse = await context.request.get(origin + '/api/admin/config')
  assert.equal(configResponse.status(), 200)
  const saved = await configResponse.json()
  assert.equal(saved.integrations.find((s) => s.id === 'yahoo-live').enabled, true)
  assert.equal(saved.quotes.filter((q) => q.provider === 'yahoo-live').length, 2)
  assert.equal(saved.modules.find((m) => m.id === 'quotes').sources.main.sourceId, 'yahoo-live')

  const collection = (await command('collector.mjs'))
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((v) => v.kind === 'nozoki-collection')
  assert.equal(collection.success, 1, JSON.stringify(collection))
  assert.equal(collection.requests, 2)
  const response = await fetch(origin + '/api/dashboard')
  assert.equal(response.status, 200)
  const dashboard = await response.json()
  assert.equal(dashboard.viewer, 'guest')
  const view = dashboard.modules.find((m) => m.id === 'quotes')
  const items = view.snapshot.data.items
  assert.equal(items.length, 2)
  assert.deepEqual(
    items.map((q) => q.symbol),
    ['QQQM', 'VOO'],
  )
  assert.ok(items.every((q) => q.price && q.history.length > 1 && q.previousClose))
  for (const quote of items)
    assert.equal(
      quote.changePercent,
      String(Number(((Number(quote.change) / Number(quote.previousClose)) * 100).toFixed(4))),
    )
  await page.goto(origin)
  await expect(page.locator('.quote-item')).toHaveCount(2)
  await expect(page.locator('.quote-chart').first()).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ mode: 'LIVE_YAHOO_ISOLATED', folder, collection, items }, null, 2))
} finally {
  await browser?.close()
  if (running.process.exitCode === null) {
    const stopped = new Promise((r) => running.process.once('exit', r))
    running.process.kill('SIGTERM')
    await stopped
  }
}

import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { launch, settle, baseURL } from './support.mjs'
await mkdir('.wrangler/test-results/phase-07-account', { recursive: true })
const expected = {
  deepseek: 'auto_awesome',
  devices: 'devices',
  codex: 'code',
  activity: 'schedule',
  quotes: 'monitoring',
  services: 'dns',
}
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(baseURL)
  await settle(page)
  const checked = []
  for (const [module, symbol] of Object.entries(expected)) {
    const header = page.locator(`[data-module="${module}"] .module-header svg`)
    if (!(await header.count())) continue
    assert.equal(await header.getAttribute('data-symbol'), symbol, module)
    checked.push({ module, symbol })
  }
  assert.ok(checked.length >= 4, 'Use the local preview with the default enabled modules')
  assert.equal(
    await page
      .locator('.page-actions > .var-button')
      .last()
      .locator('svg')
      .getAttribute('data-symbol'),
    'person',
  )
  const locked = await page
    .locator('[data-module]')
    .filter({ has: page.getByRole('link', { name: '登录后查看', exact: true }) })
    .count()
  assert.ok(locked > 0, 'Exercise login-required cards, not only public headers')
  await page.getByRole('link', { name: '登录后查看', exact: true }).first().click()
  await page
    .getByRole('dialog', { name: '管理员登录', exact: true })
    .getByLabel('邮箱', { exact: true })
    .last()
    .waitFor()
  assert.equal(new URL(page.url()).pathname, '/')
  await page.keyboard.press('Escape')
  await page.locator('.account-dialog').waitFor({ state: 'hidden' })
  await page.waitForTimeout(300)
  await page.screenshot({
    path: '.wrangler/test-results/phase-07-account/home-module-icons.png',
    fullPage: true,
  })
  await writeFile(
    '.wrangler/test-results/phase-07-account/module-icons.json',
    JSON.stringify({ checked, loginRequiredCards: locked, dialogStillWorks: true }, null, 2),
  )
  console.log(
    `PASS ${checked.length} distinct module header mappings, ${locked} login-required cards, account dialog`,
  )
} finally {
  await browser.close()
}

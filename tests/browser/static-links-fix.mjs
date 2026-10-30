import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle, select, settings } from './support.mjs'
const dir = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.2-fix-links'
const before = process.env.CHECK_BEFORE === '1'
await mkdir(dir, { recursive: true })
const browser = await launch()
const result = { baseURL, before, production, cases: [], errors: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  page.on('pageerror', (e) => result.errors.push(e.message))
  await page.goto(baseURL)
  await settle(page)
  const original = await page
    .locator('[data-module="links"] a')
    .evaluateAll((links) => links.map((a) => ({ title: a.textContent, href: a.href })))
  if (!production) {
    await page.locator('.fixture-preview summary').click()
    for (const scenario of ['empty', 'error', 'stale', 'unsupported', 'offline']) {
      await select(page, '开发数据场景', scenario)
      await page.locator('.fixture-preview summary').click()
      for (const width of before ? [1440] : [1440, 390]) {
        await page.setViewportSize({ width, height: 900 })
        const entry = {
          scenario,
          width,
          links: await page
            .locator('[data-module="links"] a')
            .evaluateAll((links) => links.map((a) => ({ title: a.textContent, href: a.href }))),
          linksStatus: await page.locator('[data-module="links"] .data-state').allTextContents(),
          servicesStatus: await page
            .locator('[data-module="services"] .data-state')
            .allTextContents(),
        }
        result.cases.push(entry)
        if (!before) {
          assert.deepEqual(entry.links, original)
          assert.deepEqual(entry.linksStatus, [])
          assert.ok(entry.servicesStatus.length > 0)
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        }
        if (width === 1440)
          await page.screenshot({
            path: `${dir}/${before ? 'before' : 'after'}-${scenario}.png`,
            fullPage: true,
          })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.locator('.fixture-preview summary').click()
    }
  }
  if (!before) {
    await settings(page)
    for (const [label, value] of [
      ['卡片不透明度', '50'],
      ['卡片背景模糊', '8'],
    ])
      assert.equal(
        await page.getByRole('slider', { name: label, exact: true }).getAttribute('aria-valuenow'),
        value,
      )
    await page.getByRole('button', { name: '完成', exact: true }).click()
    assert.equal(
      await page
        .locator('.module-card')
        .first()
        .evaluate((e) => getComputedStyle(e).backdropFilter),
      'blur(8px)',
    )
    const context = await browser.newContext()
    await context.addInitScript(() =>
      localStorage.setItem(
        'nozoki-appearance-v1',
        JSON.stringify({ background: { cardOpacity: 72, cardBlur: 6 } }),
      ),
    )
    const saved = await context.newPage()
    await saved.goto(baseURL)
    await settle(saved)
    await settings(saved)
    assert.equal(
      await saved
        .getByRole('slider', { name: '卡片不透明度', exact: true })
        .getAttribute('aria-valuenow'),
      '72',
    )
    assert.equal(
      await saved
        .getByRole('slider', { name: '卡片背景模糊', exact: true })
        .getAttribute('aria-valuenow'),
      '6',
    )
    await saved.getByRole('button', { name: '恢复默认', exact: true }).click()
    assert.equal(
      await saved
        .getByRole('slider', { name: '卡片不透明度', exact: true })
        .getAttribute('aria-valuenow'),
      '50',
    )
    assert.equal(
      await saved
        .getByRole('slider', { name: '卡片背景模糊', exact: true })
        .getAttribute('aria-valuenow'),
      '8',
    )
    // The original context has no setup hook: reload must read the application's saved defaults.
    await page.getByRole('button', { name: '外观偏好', exact: true }).click()
    await page.getByRole('button', { name: '恢复默认', exact: true }).click()
    await page.reload()
    await settle(page)
    await settings(page)
    assert.equal(
      await page
        .getByRole('slider', { name: '卡片不透明度', exact: true })
        .getAttribute('aria-valuenow'),
      '50',
    )
    assert.equal(
      await page
        .getByRole('slider', { name: '卡片背景模糊', exact: true })
        .getAttribute('aria-valuenow'),
      '8',
    )
    await context.close()
    result.defaults = { fresh: '50%/8px', saved: '72%/6px preserved', resetAndRefresh: '50%/8px' }
  }
  assert.deepEqual(result.errors, [])
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(
    `${dir}/${before ? 'before' : production ? 'production' : 'after'}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
console.log(
  JSON.stringify({
    cases: result.cases.length,
    defaults: result.defaults,
    failure: result.failure,
  }),
)

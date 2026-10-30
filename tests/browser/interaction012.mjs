import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle, settings, select } from './support.mjs'
const evidence = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.2'
await mkdir(evidence, { recursive: true })
const browser = await launch(),
  result = { baseURL, production, checks: [] }
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await p.goto(baseURL)
  await settle(p)
  await p.evaluate(() => {
    window.__dxInsertions = 0
    new MutationObserver((records) => {
      for (const r of records)
        for (const e of r.addedNodes)
          if (
            e.nodeType === 1 &&
            (e.matches?.('.dx-transition') || e.querySelector?.('.dx-transition'))
          )
            window.__dxInsertions++
    }).observe(document, { subtree: true, childList: true })
  })
  const cardText = () => p.locator('[data-module="devices"]').textContent()
  if (!production) {
    await p.locator('.fixture-preview summary').click()
    await select(p, '开发数据场景', 'edge')
  }
  const content = await cardText()
  await p.getByRole('button', { name: '显示纯壁纸' }).click()
  assert.equal(await p.locator('.fixture-preview:visible').count(), 0)
  assert.equal(
    await p.locator('a:visible, button:visible, input:visible, [tabindex="0"]:visible').count(),
    1,
  )
  await p.getByRole('button', { name: '恢复看板' }).click()
  assert.equal(await cardText(), content)
  if (!production) assert.equal(await p.locator('.fixture-preview').getAttribute('open'), null)
  result.checks.push(
    'wallpaper preserves dense fixture data, closes debug panel and excludes hidden focus targets',
  )
  await settings(p)
  const input = p.getByRole('textbox', { name: '自定义主题源色', exact: true })
  const before = await p.evaluate(() => localStorage.getItem('nozoki-appearance-v1'))
  await input.fill('#123456')
  await p.getByRole('button', { name: '预览配色', exact: true }).click()
  assert.equal(await p.locator('html').getAttribute('data-nozoki-source'), '#123456')
  assert.equal(await p.evaluate(() => localStorage.getItem('nozoki-appearance-v1')), before)
  await p.getByRole('button', { name: '撤销预览', exact: true }).click()
  assert.equal(await p.locator('html').getAttribute('data-nozoki-source'), '#6750A4')
  result.checks.push('preview is runtime-only; undo restores committed source')
  await select(p, '展示方式', '顶部横幅')
  await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.getByRole('dialog').waitFor({ state: 'hidden' })
  const banner = await p.locator('.dashboard-container').evaluate((e) => ({
    display: getComputedStyle(e).display,
    top: document.querySelector('.dashboard-grid').getBoundingClientRect().top,
    servicesBottom: document.querySelector('[data-module="services"]').getBoundingClientRect()
      .bottom,
    pageBottom: document.querySelector('.nozoki-app').getBoundingClientRect().bottom,
  }))
  assert.equal(banner.display, 'block')
  assert.ok(banner.top >= 200)
  assert.ok(Math.abs(banner.pageBottom - banner.servicesBottom - 24) < 1)
  result.checks.push({ banner })
  await settings(p)
  await select(p, '背景来源', '关闭')
  await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.getByRole('dialog').waitFor({ state: 'hidden' })
  await p.getByRole('button', { name: '显示纯壁纸' }).click()
  assert.equal(await p.locator('.background-scene').count(), 0)
  await p.getByRole('button', { name: '恢复看板' }).click()
  assert.equal(await p.locator('.background-scene').count(), 0)
  await p.getByRole('button', { name: '切换到亮色模式' }).click()
  assert.equal(await p.evaluate(() => window.__dxInsertions), 0)
  assert.equal(await p.locator('.dx-transition').count(), 0)
  result.checks.push(
    'background-off remains off; display/palette/theme interactions do not insert DX overlay',
  )
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(
    `${evidence}/interaction-${production ? 'production' : 'dev'}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
console.log(JSON.stringify(result))

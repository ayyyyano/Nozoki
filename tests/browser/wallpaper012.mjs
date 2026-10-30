import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle } from './support.mjs'
const evidence = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.2'
await mkdir(evidence, { recursive: true })
const browser = await launch(),
  result = { baseURL, production, checks: [] }
try {
  const page = await browser.newPage()
  await page.goto(baseURL)
  await settle(page)
  for (const reduced of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: reduced })
    const before = await page.locator('[data-module]').allTextContents()
    const background = await page.locator('.background-scene').getAttribute('class')
    await page.getByRole('button', { name: '显示纯壁纸', exact: true }).click()
    assert.equal(await page.getByRole('button').filter({ visible: true }).count(), 1)
    assert.equal(await page.locator('main').getAttribute('inert'), '')
    assert.equal(await page.locator('main').isVisible(), false)
    assert.equal(await page.locator('.background-scene').getAttribute('class'), background)
    assert.equal(await page.locator('.dx-transition').count(), 0)
    assert.equal(
      await page.getByRole('button', { name: '恢复看板' }).getAttribute('aria-pressed'),
      'true',
    )
    await page.screenshot({
      path: `${evidence}/wallpaper-${production ? 'production' : 'dev'}-${reduced}.png`,
    })
    await page.getByRole('button', { name: '恢复看板' }).press('Enter')
    const after = await page.locator('[data-module]').allTextContents()
    for (let i = 0; i < before.length; i++) if (i !== 3) assert.equal(after[i], before[i])
    assert.equal(await page.locator('.dx-transition').count(), 0)
    await page.getByRole('button', { name: '显示纯壁纸' }).click()
    await page.reload()
    await settle(page)
    assert.equal(await page.locator('main').isVisible(), true)
    result.checks.push(reduced)
  }
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(
    `${evidence}/wallpaper-${production ? 'production' : 'dev'}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
console.log(result)

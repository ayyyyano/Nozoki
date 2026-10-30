import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle, geometry, select } from './support.mjs'
const evidence = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.2'
await mkdir(evidence, { recursive: true })
const browser = await launch()
const result = { baseURL, production, layouts: [] }
try {
  const page = await browser.newPage({ colorScheme: 'dark' })
  await page.goto(baseURL)
  await settle(page)
  for (const scenario of production ? ['unconfigured'] : ['unconfigured', 'complete', 'edge']) {
    if (!production && scenario !== 'unconfigured') {
      await page.locator('.fixture-preview > summary').click()
      await select(page, '开发数据场景', scenario)
      await page.locator('.fixture-preview > summary').click()
    }
    for (const [width, height] of [
      [1920, 1080],
      [1440, 900],
      [1280, 720],
      [1024, 768],
      [768, 1024],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height })
      const g = await geometry(page)
      g.scenario = scenario
      g.bottomGap = height - g.cards.at(-1).bottom
      if (width > 1100) {
        for (const ids of [
          ['deepseek', 'devices', 'codex'],
          ['activity', 'quotes', 'links'],
        ]) {
          const cards = g.cards.filter((c) => ids.includes(c.id))
          assert.ok(
            Math.max(...cards.map((c) => c.height)) - Math.min(...cards.map((c) => c.height)) < 1,
            JSON.stringify(cards),
          )
          assert.ok(Math.max(...cards.map((c) => c.y)) - Math.min(...cards.map((c) => c.y)) < 1)
        }
        if (scenario === 'unconfigured') {
          assert.equal(g.scrollHeight, height)
          assert.ok(g.bottomGap >= 20 && g.bottomGap <= 26)
        }
      }
      result.layouts.push(g)
      if (scenario === 'unconfigured' || (scenario === 'edge' && width === 390))
        await page.screenshot({
          path: `${evidence}/${production ? 'production' : 'dev'}-${scenario}-${width}.png`,
          fullPage: true,
        })
    }
  }
  await page.close()
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(
    `${evidence}/layout-${production ? 'production' : 'dev'}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
console.log(JSON.stringify({ layouts: result.layouts.length, failure: result.failure }))

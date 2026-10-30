import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { launch, baseURL, production, settle } from './support.mjs'
await mkdir('.wrangler/test-results/phase-01.3', { recursive: true })
const browser = await launch(),
  result = { baseURL, production, cases: [] }
try {
  for (const kind of ['failure', 'timeout']) {
    const context = await browser.newContext({ colorScheme: 'dark' })
    const page = await context.newPage()
    let releaseClient
    const clientGate = new Promise((resolve) => {
      releaseClient = resolve
    })
    await page.route('**/_nuxt/**', async (route) => {
      if (route.request().resourceType() === 'script') await clientGate
      await route.continue().catch(() => {})
    })
    await page.addInitScript(() => {
      window.__assetPhases = []
      let previous = 'idle'
      new MutationObserver(() => {
        const phase = document.querySelector('.dx-transition')?.dataset.phase ?? 'idle'
        if (phase !== previous) {
          window.__assetPhases.push({ phase, time: performance.now() })
          previous = phase
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-phase'],
      })
    })
    await page.route('**/vendor/maimai-transition/transition.svg', async (route) => {
      if (kind === 'timeout') await new Promise((resolve) => setTimeout(resolve, 2300))
      await route.fulfill({ status: 503, body: 'unavailable' }).catch(() => {})
    })
    await page.goto(baseURL, { waitUntil: 'commit' })
    await page.waitForFunction(
      () =>
        window.__assetPhases.some((p) => p.phase === 'boot') &&
        !document.querySelector('.dx-transition'),
    )
    releaseClient()
    await settle(page)
    assert.equal(await page.locator('[data-module]').count(), 7)
    await page.getByRole('button', { name: '外观偏好', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const evidence = await page.evaluate(() => ({
      phases: window.__assetPhases,
      resources: window.__NOZOKI_DX_DEV__?.stats(),
      bodyOverflow: getComputedStyle(document.body).overflow,
      overlays: document.querySelectorAll('.dx-transition,.dx-geometry iframe').length,
    }))
    assert.equal(evidence.overlays, 0)
    assert.notEqual(evidence.bodyOverflow, 'hidden')
    if (!production)
      for (const key of ['timers', 'frames', 'listeners']) assert.equal(evidence.resources[key], 0)
    assert.ok(evidence.phases.some((p) => p.phase === 'boot'))
    assert.equal(evidence.phases.at(-1).phase, 'idle')
    const elapsed = evidence.phases.at(-1).time - evidence.phases[0].time
    assert.ok(elapsed < 3000, JSON.stringify(evidence))
    result.cases.push({ kind, elapsed, ...evidence })
    await context.close()
  }
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(
    `.wrangler/test-results/phase-01.3/assets-${production ? 'production' : 'dev'}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
console.log(JSON.stringify(result))

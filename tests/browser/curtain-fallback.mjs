import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle } from './support.mjs'
const dir = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.3-visual-fix'
await mkdir(dir, { recursive: true })
const browser = await launch(),
  prefix = production ? 'production' : 'dev'
const result = { baseURL, engine: browser.version(), cases: [], errors: [], hydration: [] }
try {
  for (const scenario of [
    'refresh',
    'slow-bootstrap',
    'missing-bootstrap',
    'missing-artwork',
    'failed-background',
    'system-reduced',
    'saved-reduced',
    'no-js',
    'missing-all-client',
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
      reducedMotion: scenario === 'system-reduced' ? 'reduce' : 'no-preference',
      javaScriptEnabled: scenario !== 'no-js',
    })
    if (scenario === 'saved-reduced')
      await context.addInitScript(() =>
        localStorage.setItem('nozoki-appearance-v1', JSON.stringify({ reduceMotion: true })),
      )
    await context.addInitScript(() => {
      window.__curtainCheck = { phases: [], maxCount: 0 }
      let previous
      new MutationObserver(() => {
        const overlays = document.querySelectorAll('.dx-transition'),
          phase = overlays[0]?.dataset.phase ?? 'idle'
        window.__curtainCheck.maxCount = Math.max(window.__curtainCheck.maxCount, overlays.length)
        if (phase !== previous)
          window.__curtainCheck.phases.push({ phase, time: performance.now() })
        previous = phase
      }).observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-phase'],
      })
    })
    const page = await context.newPage()
    page.on('pageerror', (e) => result.errors.push({ scenario, message: e.message }))
    page.on('console', (m) => {
      if (/hydration|mismatch/i.test(m.text()))
        result.hydration.push({ scenario, message: m.text() })
    })
    let release
    const gate = new Promise((r) => {
      release = r
    })
    if (scenario === 'slow-bootstrap')
      await page.route('**/dx-init.js', async (r) => {
        await gate
        await r.continue().catch(() => {})
      })
    if (['missing-bootstrap', 'missing-all-client'].includes(scenario))
      await page.route('**/dx-init.js', (r) => r.abort())
    if (scenario === 'missing-all-client')
      await page.route('**/_nuxt/**', (r) =>
        r.request().resourceType() === 'script' ? r.abort() : r.continue(),
      )
    if (scenario === 'missing-artwork')
      await page.route('**/vendor/maimai-transition/transition.svg', (r) =>
        r.fulfill({ status: 503, body: 'Local failure fixture' }),
      )
    if (scenario === 'failed-background') await page.route('**/media/*', (r) => r.abort())
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
    if (scenario === 'missing-all-client') {
      await page.waitForFunction(() => !!document.querySelector('.dx-transition'))
      await page.waitForFunction(() => !document.querySelector('.dx-transition'), {
        timeout: 16000,
      })
    } else if (scenario === 'no-js') {
      assert.equal(await page.locator('[data-module]').count(), 7)
    } else {
      await settle(page)
      if (scenario === 'slow-bootstrap') {
        release()
        await page.waitForTimeout(500)
      }
      if (scenario === 'refresh') {
        const first = await page.evaluate(() => window.__curtainCheck)
        assert.equal(first.phases.filter((p) => p.phase === 'entering').length, 1)
        await page.reload()
        await settle(page)
      }
    }
    assert.equal(await page.locator('.dx-transition').count(), 0)
    assert.notEqual(
      await page.locator('body').evaluate((e) => getComputedStyle(e).overflow),
      'hidden',
    )
    const data =
      scenario === 'no-js'
        ? null
        : await page.evaluate(() => ({
            ...window.__curtainCheck,
            resources: window.__NOZOKI_DX_BOOT__?.snapshot() ?? null,
            curtainConnected: window.__NOZOKI_DX_CURTAIN__?.element.isConnected ?? false,
          }))
    if (data) {
      assert.ok(data.maxCount <= 1, 'only one curtain')
      assert.equal(data.curtainConnected, false)
      if (data.resources)
        assert.deepEqual(data.resources, { phase: 'idle', timers: 0, frames: 0, listeners: 0 })
      if (['system-reduced', 'saved-reduced'].includes(scenario)) assert.equal(data.maxCount, 0)
    }
    result.cases.push({ scenario, data })
    await context.close()
  }
  const c = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  await c.addInitScript(() =>
    localStorage.setItem(
      'nozoki-appearance-v1',
      JSON.stringify({ background: { layout: 'banner' } }),
    ),
  )
  const p = await c.newPage()
  await p.goto(baseURL)
  await settle(p)
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await p.screenshot({ path: `${dir}/${prefix}-mobile.png`, fullPage: true })
  await p.emulateMedia({ reducedMotion: 'reduce' })
  assert.ok(
    await p
      .locator('.banner-wave path')
      .evaluateAll((paths) => paths.every((e) => getComputedStyle(e).animationName === 'none')),
  )
  result.cases.push({ scenario: 'mobile-and-static-reduced-wave' })
  await c.close()
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.hydration, [])
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(`${dir}/${prefix}-fallback.json`, JSON.stringify(result, null, 2))
}
console.log(JSON.stringify({ cases: result.cases.length, failure: result.failure }))

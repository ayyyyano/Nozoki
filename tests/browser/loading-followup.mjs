import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle } from './support.mjs'
const dir = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.3-followup'
await mkdir(dir, { recursive: true })
const browser = await launch(),
  prefix = production ? 'production' : 'dev'
const result = {
  baseURL,
  engine: browser.version(),
  production,
  loading: [],
  waves: [],
  errors: [],
  hydration: [],
}
function listen(page) {
  page.on('pageerror', (e) => result.errors.push(e.message))
  page.on('console', (m) => {
    if (/hydration|mismatch/i.test(m.text())) result.hydration.push(m.text())
  })
}
async function loading(timeout = false) {
  const context = await browser.newContext({
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
  })
  await context.addInitScript(() => {
    window.__loadingFollowup = { phases: [], frames: [], themeReady: null }
    let previous = 'idle'
    new MutationObserver(() => {
      const phase = document.querySelector('.dx-transition')?.dataset.phase ?? 'idle'
      if (previous !== phase) {
        window.__loadingFollowup.phases.push({
          phase,
          time: performance.now(),
          interactive: document.querySelector('[data-theme-ready="true"]') !== null,
        })
        previous = phase
      }
      if (
        window.__loadingFollowup.themeReady === null &&
        document.querySelector('[data-theme-ready="true"]')
      )
        window.__loadingFollowup.themeReady = performance.now()
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-phase', 'data-theme-ready'],
    })
    const sample = () => {
      const overlay = document.querySelector('.dx-transition'),
        doc = overlay?.querySelector('iframe')?.contentDocument
      const chip = doc?.querySelector('[id="滴拉熊"]')
      if (chip)
        window.__loadingFollowup.frames.push({
          phase: overlay.dataset.phase,
          time: performance.now(),
          transform: getComputedStyle(chip).transform,
          opacity: getComputedStyle(chip).opacity,
          width: overlay.getBoundingClientRect().width,
          height: overlay.getBoundingClientRect().height,
          display: getComputedStyle(overlay).display,
        })
      if (performance.now() < 30000) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  const page = await context.newPage()
  listen(page)
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  await page.route('**/_nuxt/**', async (route) => {
    if (route.request().resourceType() === 'script') await gate
    await route.continue().catch(() => {})
  })
  const response = await page.goto(baseURL, { waitUntil: 'commit' })
  const htmlResponse = response.text()
  await page.waitForFunction(() =>
    window.__loadingFollowup.phases.some((p) => p.phase === 'entering'),
  )
  assert.equal(await page.locator('[data-theme-ready="true"]').count(), 0)
  await page.screenshot({ path: `${dir}/${prefix}-${timeout ? 'timeout' : 'early'}-entering.png` })
  await page.locator('.dx-transition[data-phase="holding"]').waitFor()
  assert.equal(await page.locator('[data-theme-ready="true"]').count(), 0)
  await page.screenshot({ path: `${dir}/${prefix}-${timeout ? 'timeout' : 'early'}-holding.png` })
  if (timeout) await page.waitForFunction(() => !document.querySelector('.dx-transition'))
  release()
  await settle(page)
  const html = await htmlResponse
  assert.ok(html.indexOf('src="/dx-init.js"') < html.indexOf('id="__nuxt"'))
  const data = await page.evaluate(() => ({
    ...window.__loadingFollowup,
    resources: window.__NOZOKI_DX_BOOT__.snapshot(),
    bodyOverflow: getComputedStyle(document.body).overflow,
  }))
  assert.equal(data.phases.filter((p) => p.phase === 'entering').length, 1)
  assert.equal(data.phases.find((p) => p.phase === 'entering').interactive, false)
  assert.ok(data.phases.find((p) => p.phase === 'entering').time < data.themeReady)
  if (!timeout)
    assert.ok(
      data.phases.find((p) => p.phase === 'leaving').time >= data.themeReady,
      'normal exit waits for the ready layout',
    )
  assert.equal(data.phases.at(-1).phase, 'idle')
  assert.notEqual(data.bodyOverflow, 'hidden')
  assert.deepEqual(data.resources, { phase: 'idle', timers: 0, frames: 0, listeners: 0 })
  const active = data.frames.filter((f) => f.phase === 'entering' && Number(f.opacity) > 0)
  result.loading.push({ timeout, ...data })
  assert.ok(
    new Set(active.map((f) => f.transform)).size > 1,
    'real reference motion must precede hydration',
  )
  const exiting = data.frames.filter(
    (f) => f.phase === 'leaving' && f.width > 1000 && f.height > 800 && f.display !== 'none',
  )
  assert.ok(new Set(exiting.map((f) => f.transform)).size > 1, 'reference exit must remain visible')
  await page.waitForTimeout(250)
  assert.equal(await page.locator('.dx-transition').count(), 0)
  await page.getByRole('button', { name: '外观偏好', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `${dir}/${prefix}-${timeout ? 'timeout' : 'early'}-complete.png` })
  await context.close()
}
try {
  await loading()
  await loading(true)
  for (const kind of ['late-bootstrap', 'late-artwork']) {
    const context = await browser.newContext({ colorScheme: 'dark' })
    await context.addInitScript(() => {
      window.__lateEnters = 0
      let previous = 'idle'
      new MutationObserver(() => {
        const phase = document.querySelector('.dx-transition')?.dataset.phase ?? 'idle'
        if (phase === 'entering' && phase !== previous) window.__lateEnters++
        previous = phase
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-phase'],
      })
    })
    const page = await context.newPage()
    listen(page)
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route(
      kind === 'late-bootstrap' ? '**/dx-init.js' : '**/vendor/maimai-transition/transition.svg',
      async (route) => {
        await gate
        await route.continue().catch(() => {})
      },
    )
    await page.goto(baseURL, { waitUntil: 'commit' })
    await page.locator('[data-theme-ready="true"]').waitFor()
    if (kind === 'late-artwork') {
      const state = await page.evaluate(() => window.__NOZOKI_DX_BOOT__?.snapshot())
      if (state?.phase === 'boot') {
        assert.equal(await page.locator('.dx-transition').count(), 1)
        assert.equal(
          await page.locator('.dx-veil').evaluate((e) => getComputedStyle(e).opacity),
          '1',
        )
      } else {
        // Slow client initialization can exhaust the independent 1800ms artwork budget first.
        assert.deepEqual(state, { phase: 'idle', timers: 0, frames: 0, listeners: 0 })
        assert.equal(await page.locator('.dx-transition').count(), 0)
      }
    }
    release()
    if (kind === 'late-artwork') await page.evaluate(() => window.__NOZOKI_DX_BOOT__?.done)
    else await page.waitForTimeout(700)
    assert.equal(await page.locator('.dx-transition').count(), 0)
    const enters = await page.evaluate(() => window.__lateEnters)
    if (kind === 'late-bootstrap')
      assert.equal(enters, 0, 'an absent bootstrap never adds a late cover')
    else
      assert.ok(
        enters <= 1,
        'the existing opaque curtain hands off to delayed artwork at most once',
      )
    result.loading.push({
      kind,
      resources: await page.evaluate(() => window.__NOZOKI_DX_BOOT__?.snapshot() ?? null),
    })
    await context.close()
  }
  const context = await browser.newContext({
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
  })
  await context.addInitScript(() =>
    localStorage.setItem(
      'nozoki-appearance-v1',
      JSON.stringify({ background: { layout: 'banner' } }),
    ),
  )
  const page = await context.newPage()
  listen(page)
  await page.goto(baseURL)
  await settle(page)
  const sample = () =>
    page.locator('.banner-wave path').evaluateAll((paths) =>
      paths.map((e) => {
        const s = getComputedStyle(e)
        return {
          name: s.animationName,
          duration: s.animationDuration,
          delay: s.animationDelay,
          direction: s.animationDirection,
          transform: s.transform,
        }
      }),
    )
  const before = await sample()
  await page.screenshot({ path: `${dir}/${prefix}-waves-0.png` })
  await page.waitForTimeout(1000)
  const after = await sample()
  await page.screenshot({ path: `${dir}/${prefix}-waves-1.png` })
  assert.equal(new Set(before.map((s) => s.duration)).size, 3)
  for (let i = 0; i < 3; i++) {
    assert.equal(before[i].name, 'nozoki-banner-wave')
    assert.notEqual(before[i].transform, after[i].transform)
  }
  result.waves.push({ before, after })
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const bounds = await page.locator('.banner-wave').boundingBox()
    assert.ok(bounds.width <= width)
    result.waves.push({ width, height, bounds })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.ok((await sample()).every((s) => s.name === 'none'))
  result.waves.push({ systemReduced: await sample() })
  await context.close()
  const reduced = await browser.newContext({ colorScheme: 'dark' })
  await reduced.addInitScript(() =>
    localStorage.setItem(
      'nozoki-appearance-v1',
      JSON.stringify({ reduceMotion: true, background: { layout: 'banner' } }),
    ),
  )
  const p = await reduced.newPage()
  await p.goto(baseURL)
  await settle(p)
  assert.equal(await p.locator('.dx-transition').count(), 0)
  assert.ok(
    await p
      .locator('.banner-wave path')
      .evaluateAll((paths) => paths.every((e) => getComputedStyle(e).animationName === 'none')),
  )
  await reduced.close()
  const nojs = await browser.newContext({ javaScriptEnabled: false })
  const n = await nojs.newPage()
  await n.goto(baseURL)
  assert.equal(await n.locator('[data-module]').count(), 7)
  assert.equal(await n.locator('.dx-transition').count(), 0)
  await nojs.close()
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.hydration, [])
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(`${dir}/${prefix}.json`, JSON.stringify(result, null, 2))
  await browser.close()
}
console.log(
  JSON.stringify({
    loading: result.loading.length,
    waves: result.waves.length,
    failure: result.failure,
  }),
)

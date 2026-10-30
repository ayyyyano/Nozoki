import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch, baseURL, production, settle, settings, select } from './support.mjs'
const dir = '.wrangler/test-results/phase-01.3'
await mkdir(dir, { recursive: true })
const before = process.env.CHECK_BEFORE === '1'
const prefix = before ? 'before' : production ? 'reference-production' : 'reference-dev'
const browser = await launch()
const result = { baseURL, production, before, engine: browser.version(), cases: [], errors: [] }
async function run(
  name,
  { prefs, delayScripts = false, failedImage = false, reduce = false, reloads = 0 } = {},
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    reducedMotion: reduce ? 'reduce' : 'no-preference',
  })
  await context.addInitScript(
    ({ prefs }) => {
      if (prefs) localStorage.setItem('nozoki-appearance-v1', JSON.stringify(prefs))
      window.__playback = {
        phases: [],
        frames: [],
        events: [],
        origin: performance.timeOrigin,
        themeReady: null,
        initial: {
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          hidden: document.hidden,
        },
      }
      let previous = 'idle'
      let observedShadow
      const observer = new MutationObserver(() => {
        const phase = document.querySelector('.dx-transition')?.dataset.phase ?? 'idle'
        if (
          window.__playback.themeReady === null &&
          document.querySelector('[data-theme-ready="true"]')
        )
          window.__playback.themeReady = performance.now()
        if (previous !== phase) {
          window.__playback.phases.push({ phase, time: performance.now() })
          previous = phase
        }
      })
      observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-phase', 'data-theme-ready'],
      })
      const sample = () => {
        const overlay = document.querySelector('.dx-transition'),
          veil = document.querySelector('.dx-veil')
        if (overlay && veil) {
          const shadow = document.querySelector('.dx-geometry iframe')?.contentDocument
          const stage = shadow?.querySelector('.stage')
          if (
            stage &&
            shadow &&
            shadow !== observedShadow &&
            stage.getAnimations({ subtree: true }).length
          ) {
            observedShadow = shadow
            shadow.addEventListener(
              'animationend',
              (e) =>
                window.__playback.events.push({
                  name: e.animationName,
                  time: performance.now(),
                  reference: true,
                }),
              true,
            )
            for (const animation of stage.getAnimations({ subtree: true }))
              animation.addEventListener('finish', () =>
                window.__playback.events.push({
                  name: animation.animationName,
                  time: performance.now(),
                  reference: true,
                  type: 'finish',
                }),
              )
          }
          // Sample three real reference layers, not every SVG path's bounding box each frame.
          const targets = ['[id="滴拉熊"]', '[id="左上底板"]', '#HOLD > use']
            .map((s) => stage?.querySelector(s))
            .filter(Boolean)
          let coverage = 0
          const transforms = targets.map((target) => {
            const r = target.getBoundingClientRect(),
              style = getComputedStyle(target)
            const width = Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left))
            const height = Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top))
            if (Number(style.opacity) > 0)
              coverage = Math.max(coverage, (width * height) / (innerWidth * innerHeight))
            return style.transform + '/' + style.opacity
          })
          window.__playback.frames.push({
            phase: overlay.dataset.phase,
            time: performance.now(),
            transform: transforms.join('|'),
            visualTargets: targets.length,
            animations: stage
              ?.getAnimations({ subtree: true })
              .slice(0, 4)
              .map((a) => ({
                name: a.animationName,
                state: a.playState,
                time: a.currentTime,
                duration: a.effect.getTiming().duration,
                delay: a.effect.getTiming().delay,
              })),
            visibility: getComputedStyle(overlay).visibility,
            coverage,
          })
        }
        if (performance.now() < 60000) requestAnimationFrame(sample)
        else observer.disconnect()
      }
      requestAnimationFrame(sample)
      document.addEventListener(
        'animationend',
        (e) => {
          if (e.target.classList?.contains('dx-veil'))
            window.__playback.events.push({ name: e.animationName, time: performance.now() })
        },
        true,
      )
    },
    { prefs },
  )
  const page = await context.newPage()
  page.on('pageerror', (e) => result.errors.push(e.message))
  if (delayScripts)
    await page.route('**/_nuxt/**', async (route) => {
      if (route.request().resourceType() === 'script')
        await new Promise((resolve) => setTimeout(resolve, 450))
      await route.continue()
    })
  if (failedImage)
    await page.route('**/media/wallpaper-glass-picnic.webp', (route) =>
      route.fulfill({ status: 200, contentType: 'image/webp', body: 'invalid' }),
    )
  const cdp = await context.newCDPSession(page)
  const frames = []
  const writes = []
  cdp.on('Page.screencastFrame', (event) => {
    const file = `${prefix}-${name}-${String(frames.length).padStart(3, '0')}.jpg`
    frames.push({ file, timestamp: event.metadata.timestamp })
    writes.push(writeFile(join(dir, file), Buffer.from(event.data, 'base64')))
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 75,
    maxWidth: 960,
    maxHeight: 600,
    everyNthFrame: 3,
  })
  for (let pass = 0; pass <= reloads; pass++) {
    if (pass) await page.reload({ waitUntil: 'domcontentloaded' })
    else await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
    await settle(page)
    const playback = await page.evaluate(async () => ({
      ...window.__playback,
      completion: (await window.__NOZOKI_DX_BOOT__?.done) ?? 'late-bootstrap-skipped',
    }))
    const entry = { name, pass, ...playback }
    result.cases.push(entry)
    if (!before && !reduce && playback.phases.some((p) => p.phase === 'entering')) {
      assert.ok(
        playback.phases.find((p) => p.phase === 'entering').time < playback.themeReady,
        'entry must precede interactive readiness',
      )
      for (const phase of ['entering', 'leaving']) {
        const visible = playback.frames.filter(
          (f) => f.phase === phase && f.visibility === 'visible' && f.coverage > 0.1,
        )
        assert.ok(visible.length >= 2, `${name}/${pass}: ${phase} was not visibly rendered`)
        assert.ok(new Set(visible.map((f) => f.transform)).size >= 2, `${phase} had no real motion`)
      }
      assert.ok(playback.events.some((e) => ['settle-TL', 'settle-BR'].includes(e.name)))
      assert.ok(
        playback.events.some(
          (e) => e.reference && (e.name.includes('-out') || e.name.startsWith('expand-')),
        ),
      )
    }
    if (reduce) assert.equal(playback.frames.filter((f) => f.visibility === 'visible').length, 0)
    assert.equal(await page.locator('.dx-transition').count(), 0)
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden')
  }
  if (name === 'first') {
    const count = await page.evaluate(
      () => window.__playback.phases.filter((p) => p.phase === 'entering').length,
    )
    await page.getByRole('button', { name: '显示纯壁纸' }).click()
    await page.getByRole('button', { name: '恢复看板' }).click()
    await page.getByRole('button', { name: '切换到亮色模式' }).click()
    await settings(page)
    await select(page, '展示方式', '顶部横幅')
    await page.getByRole('slider', { name: '水平位置', exact: true }).press('ArrowRight')
    await page.getByRole('button', { name: '天空蓝', exact: true }).click()
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.waitForTimeout(1100)
    assert.equal(
      await page.evaluate(
        () => window.__playback.phases.filter((p) => p.phase === 'entering').length,
      ),
      count,
    )
  }
  await cdp.send('Page.stopScreencast')
  await Promise.all(writes)
  await page.screenshot({ path: `${dir}/${prefix}-${name}-complete.png` })
  await context.close()
  result.cases.at(-1).screencast = frames
}
try {
  await run('first', { reloads: 2 })
  await run('fast', { prefs: { background: { source: 'off' } } })
  if (!before) {
    await run('delayed-client', { delayScripts: true })
    await run('background-failure', { failedImage: true })
    await run('reduced', { reduce: true })
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto(baseURL)
    assert.equal(await page.locator('[data-module]').count(), 7)
    assert.equal(await page.locator('.dx-transition').count(), 0)
    await context.close()
  }
  assert.deepEqual(result.errors, [])
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(`${dir}/playback-${prefix}.json`, JSON.stringify(result, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ cases: result.cases.length, failure: result.failure }))

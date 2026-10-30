import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle } from './support.mjs'
const dir = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.3-visual-fix'
const before = process.env.CHECK_BEFORE === '1'
const prefix = before ? 'before' : production ? 'production' : 'dev'
await mkdir(dir, { recursive: true })
const browser = await launch()
const results = { baseURL, engine: browser.version(), before, errors: [], hydration: [], cases: [] }
function observe(page) {
  page.on('pageerror', (e) => results.errors.push(e.message))
  page.on('console', (m) => {
    if (/hydration|mismatch/i.test(m.text())) results.hydration.push(m.text())
  })
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  observe(page)
  await context.addInitScript(() =>
    localStorage.setItem(
      'nozoki-appearance-v1',
      JSON.stringify({ background: { layout: 'banner' } }),
    ),
  )
  await page.goto(baseURL)
  await settle(page)
  const box = await page.locator('.banner-wave').boundingBox()
  const frames = []
  const wavePixels = []
  for (let i = 0; i < 4; i++) {
    frames.push(
      await page.locator('.banner-wave').evaluate((e) => ({
        time: performance.now(),
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        savedReduced: document.documentElement.dataset.nozokiReduced,
        layers: [...e.querySelectorAll('path')].map((p) => ({
          transform: getComputedStyle(p).transform,
          duration: getComputedStyle(p).animationDuration,
          playState: getComputedStyle(p).animationPlayState,
        })),
      })),
    )
    wavePixels.push(
      await page.screenshot({
        path: `${dir}/${prefix}-wave-${i}.png`,
        clip: { x: box.x, y: box.y - 30, width: box.width, height: box.height + 30 },
      }),
    )
    if (i < 3) await page.waitForTimeout(1000)
  }
  await page.screenshot({ path: `${dir}/${prefix}-banner.png` })
  const pixelChanges = await page.evaluate(
    async (sources) => {
      const images = await Promise.all(
        sources.map(async (src) => {
          const i = new Image()
          i.src = src
          await i.decode()
          const c = document.createElement('canvas')
          c.width = i.width
          c.height = i.height
          const ctx = c.getContext('2d')
          ctx.drawImage(i, 0, 0)
          return ctx.getImageData(0, 0, i.width, i.height).data
        }),
      )
      return images.slice(1).map((pixels, i) => {
        let changed = 0
        for (let n = 0; n < pixels.length; n += 4)
          if (Math.max(...[0, 1, 2].map((c) => Math.abs(pixels[n + c] - images[i][n + c]))) > 8)
            changed++
        return { changed, fraction: changed / (pixels.length / 4) }
      })
    },
    wavePixels.map((b) => `data:image/png;base64,${b.toString('base64')}`),
  )
  results.cases.push({ name: 'waves', box, frames, pixelChanges })
  if (!before)
    assert.ok(
      pixelChanges.every((p) => p.fraction > 0.01),
      'visible wave pixels, not just computed transforms, must change',
    )
  await context.close()

  const startup = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
  })
  await startup.addInitScript(() => {
    window.__coverSamples = []
    const sample = () => {
      const overlay = document.querySelector('.dx-transition'),
        veil = overlay?.querySelector('.dx-veil')
      if (overlay)
        window.__coverSamples.push({
          count: document.querySelectorAll('.dx-transition').length,
          time: performance.now(),
          phase: overlay.dataset.phase,
          reveal: overlay.dataset.revealing,
          color: getComputedStyle(veil ?? overlay).backgroundColor,
          opacity: getComputedStyle(overlay).opacity,
          veilOpacity: veil ? getComputedStyle(veil).opacity : null,
          veilVisibility: veil ? getComputedStyle(veil).visibility : null,
          ready: !!document.querySelector('[data-theme-ready="true"]'),
        })
      if (performance.now() < 12000) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  const p = await startup.newPage()
  const cdp = await startup.newCDPSession(p)
  const film = []
  const writes = []
  cdp.on('Page.screencastFrame', (frame) => {
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
    if (film.length >= 100) return
    const path = `${dir}/${prefix}-loading-${String(film.length).padStart(3, '0')}.jpg`
    film.push({ path, timestamp: frame.metadata.timestamp })
    writes.push(writeFile(path, Buffer.from(frame.data, 'base64')))
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 })
  observe(p)
  let release
  const gate = new Promise((r) => {
    release = r
  })
  await p.route('**/vendor/maimai-transition/transition.svg', async (route) => {
    await gate
    await route.continue().catch(() => {})
  })
  await p.goto(baseURL, { waitUntil: 'commit' })
  await p.waitForFunction(() => document.querySelector('.dx-transition[data-phase="boot"]'))
  await p.screenshot({ path: `${dir}/${prefix}-boot.png` })
  release()
  if (!before) {
    await p.waitForFunction(() => document.querySelector('.dx-transition[data-phase="entering"]'))
    await p.screenshot({ path: `${dir}/${prefix}-entering.png` })
    await p.waitForFunction(() => document.querySelector('.dx-transition[data-phase="leaving"]'))
    await p.screenshot({ path: `${dir}/${prefix}-leaving.png` })
  }
  await settle(p)
  await p.screenshot({ path: `${dir}/${prefix}-complete.png` })
  const samples = await p.evaluate(() => ({
    frames: window.__coverSamples,
    resources: window.__NOZOKI_DX_BOOT__?.snapshot(),
  }))
  await cdp.send('Page.stopScreencast')
  await Promise.all(writes)
  results.cases.push({ name: 'startup', ...samples, film })
  if (!before) {
    const covered = samples.frames.filter((f) => ['boot', 'entering', 'holding'].includes(f.phase))
    assert.ok(covered.length > 5)
    for (const frame of covered) {
      assert.equal(frame.count, 1)
      assert.equal(frame.opacity, '1')
      assert.equal(frame.veilOpacity, '1')
      assert.equal(frame.veilVisibility, 'visible')
      assert.notEqual(frame.color, 'rgba(0, 0, 0, 0)')
    }
    assert.ok(covered.some((f) => f.phase === 'entering'))
    const leaving = samples.frames.filter((f) => f.phase === 'leaving')
    assert.ok(leaving.length > 0)
    assert.ok(
      leaving.every((f) => f.veilVisibility === 'hidden'),
      'the original expand reveals the page immediately',
    )
    assert.deepEqual(samples.resources, { phase: 'idle', timers: 0, frames: 0, listeners: 0 })
    await p.getByRole('button', { name: '外观偏好', exact: true }).click()
    await p.getByRole('dialog').waitFor()
    await p.keyboard.press('Escape')
  }
  await startup.close()
  assert.deepEqual(results.errors, [])
  assert.deepEqual(results.hydration, [])
} catch (error) {
  results.failure = error.stack
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(`${dir}/${prefix}-visual.json`, JSON.stringify(results, null, 2))
}
console.log(JSON.stringify({ cases: results.cases.length, failure: results.failure }))

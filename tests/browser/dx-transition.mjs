import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { launch, baseURL, production, evidence, settle } from './support.mjs'
await mkdir(evidence, { recursive: true })
const browser = await launch()
const prefix = production ? 'production' : 'dev'
const result = { baseURL, engine: browser.version(), production, checks: [], runtimeErrors: [] }
const check = (name, detail = {}) => {
  result.checks.push({ name, ...detail })
  console.log(`PASS ${name}`)
}
async function create({
  prefs,
  reducedMotion = 'no-preference',
  hidden = false,
  suppressEvents = false,
  captureStages = false,
} = {}) {
  const context = await browser.newContext({
    colorScheme: 'dark',
    reducedMotion,
    viewport: { width: 1440, height: 900 },
  })
  await context.addInitScript(
    ({ prefs, hidden, suppressEvents, captureStages }) => {
      if (prefs) localStorage.setItem('nozoki-appearance-v1', JSON.stringify(prefs))
      if (hidden) Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      window.__dxEvents = []
      window.__dxPhases = []
      window.addEventListener('message', (event) => {
        if (event.origin !== location.origin || event.data?.type !== 'nozoki-maimai-ready') return
        const frame = document.querySelector('.dx-geometry iframe')
        if (event.source !== frame?.contentWindow) return
        const doc = frame.contentDocument
        for (const animation of doc.getAnimations())
          animation.addEventListener('finish', (e) => {
            window.__dxEvents.push({
              name: animation.animationName,
              time: performance.now(),
              reference: true,
            })
            if (suppressEvents) e.stopImmediatePropagation()
          })
        for (const type of ['animationend', 'animationcancel'])
          doc.addEventListener(
            type,
            (event) => {
              window.__dxEvents.push({
                name: event.animationName,
                time: performance.now(),
                reference: true,
              })
              if (suppressEvents) event.stopImmediatePropagation()
            },
            true,
          )
      })
      let previous = 'idle'
      new MutationObserver(() => {
        const phase = document.querySelector('.dx-transition')?.dataset.phase ?? 'idle'
        if (phase !== previous) {
          window.__dxPhases.push({
            phase,
            time: performance.now(),
            interactive: document.querySelector('[data-theme-ready="true"]') !== null,
          })
          previous = phase
          if (captureStages && (phase === 'entering' || phase === 'leaving')) {
            for (const animation of document
              .querySelector('.dx-transition')
              .getAnimations({ subtree: true })) {
              animation.pause()
              animation.currentTime = phase === 'entering' ? 90 : 110
            }
          }
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-phase'],
      })
      for (const type of ['animationend', 'animationcancel'])
        document.addEventListener(
          type,
          (event) => {
            if (event.target.classList?.contains('dx-veil'))
              window.__dxEvents.push({
                name: event.animationName,
                elapsedSeconds: event.elapsedTime,
                time: performance.now(),
              })
            if (suppressEvents && event.target.closest?.('.dx-transition'))
              event.stopImmediatePropagation()
          },
          true,
        )
    },
    { prefs, hidden, suppressEvents, captureStages },
  )
  const p = await context.newPage()
  p.on('pageerror', (error) => result.runtimeErrors.push(error.message))
  return p
}
async function clean(page) {
  await page.locator('[data-theme-ready="true"]').waitFor()
  await page.waitForFunction(() => !document.querySelector('.dx-transition'))
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'),
    false,
  )
  assert.equal(await page.locator('.nozoki-app').getAttribute('data-color-mode'), 'dark')
  await page.getByRole('button', { name: '外观偏好', exact: true }).click()
  await page.getByRole('dialog', { name: '外观偏好' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '外观偏好' }).waitFor({ state: 'hidden' })
  await page.waitForFunction(() => getComputedStyle(document.body).overflow !== 'hidden')
  if (!production) {
    await page.waitForFunction(() => window.__NOZOKI_DX_DEV__)
    await page.waitForFunction(() => {
      const s = window.__NOZOKI_DX_DEV__.stats()
      return s.timers === 0 && s.frames === 0 && s.listeners === 0
    })
  }
}
async function waitPhase(page, phase) {
  await page.waitForFunction((phase) => {
    const e = document.querySelector('.dx-transition')
    return (
      e?.dataset.phase === phase &&
      e.getBoundingClientRect().height > 0 &&
      getComputedStyle(e).display !== 'none'
    )
  }, phase)
}
async function slowPage(options = {}) {
  const p = await create(options)
  if (options.captureStages) {
    const start = new Date()
    await p.clock.install({ time: start })
    await p.clock.pauseAt(new Date(start.getTime() + 1000))
  }
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  await p.route('**/media/wallpaper-glass-picnic.webp', async (route) => {
    await gate
    await route.continue().catch(() => {})
  })
  if (options.clientGate)
    await p.route('**/_nuxt/**', async (route) => {
      if (route.request().resourceType() === 'script') await gate
      await route.continue().catch(() => {})
    })
  await p.goto(baseURL, { waitUntil: 'commit' })
  return { p, release }
}
try {
  const { p: normal, release } = await slowPage({ clientGate: true })
  await waitPhase(normal, 'entering')
  await normal.screenshot({ path: `${evidence}/${prefix}-dx-entering.png` })
  await normal.waitForFunction(() =>
    ['holding', 'leaving'].includes(document.querySelector('.dx-transition')?.dataset.phase),
  )
  if ((await normal.locator('.dx-transition').getAttribute('data-phase')) === 'holding')
    await normal.screenshot({ path: `${evidence}/${prefix}-dx-holding.png` })
  release()
  await waitPhase(normal, 'leaving')
  await normal.screenshot({ path: `${evidence}/${prefix}-dx-leaving.png` })
  await clean(normal)
  const sequence = await normal.evaluate(() => ({
    phases: window.__dxPhases,
    events: window.__dxEvents,
  }))
  assert.ok(sequence.phases.some((p) => p.phase === 'entering'))
  assert.ok(sequence.phases.some((p) => p.phase === 'leaving'))
  assert.ok(sequence.events.some((e) => e.reference && e.name.startsWith('settle-')))
  assert.ok(
    sequence.events.some(
      (e) => e.reference && (e.name.includes('-out') || e.name.startsWith('expand-')),
    ),
  )
  check(
    'normal first load uses original reference animation completion; holding only when readiness remains pending',
    sequence,
  )
  result.representativeFrames =
    'Real browser time and original reference SVG; holding capture exists only if the readiness budget has not expired.'
  await normal.context().close()
  const fast = await create({ prefs: { mode: 'dark', background: { source: 'off' } } })
  await fast.goto(baseURL)
  await settle(fast)
  await clean(fast)
  const fastPhases = await fast.evaluate(() => window.__dxPhases)
  // A prepaint solid cover is already visible; fast readiness retains the original reveal.
  assert.ok(fastPhases.filter((p) => p.phase === 'holding').every((p) => !p.interactive))
  assert.ok(fastPhases.some((p) => p.phase === 'boot' && !p.interactive))
  assert.equal(fastPhases.filter((p) => p.phase === 'entering').length, 1)
  assert.equal(fastPhases.filter((p) => p.phase === 'leaving').length, 1)
  check('fast initialization keeps the prepaint curtain and completes the original reveal once', {
    phases: fastPhases,
  })
  await fast.context().close()
  const { p: budget, release: endBudget } = await slowPage()
  await budget.locator('[data-theme-ready="true"]').waitFor()
  await budget.waitForFunction(() => !document.querySelector('.dx-transition'))
  assert.equal(await budget.locator('.background-scene').getAttribute('data-background'), 'loading')
  endBudget()
  await clean(budget)
  check('slow background exceeds readiness budget without blocking the page', {
    phases: await budget.evaluate(() => window.__dxPhases),
  })
  await budget.context().close()
  const failure = await create()
  await failure.route('**/media/wallpaper-glass-picnic.webp', (route) =>
    route.fulfill({ status: 200, contentType: 'image/webp', body: 'invalid' }),
  )
  await failure.goto(baseURL)
  await settle(failure)
  await clean(failure)
  assert.equal(await failure.locator('.background-scene').getAttribute('data-background'), 'failed')
  check('image failure falls back and cleans the transition')
  await failure.context().close()
  for (const options of [
    { reducedMotion: 'reduce' },
    { prefs: { mode: 'dark', reduceMotion: true } },
  ]) {
    const p = await create(options)
    await p.goto(baseURL)
    await settle(p)
    await clean(p)
    assert.equal(
      (await p.evaluate(() => window.__dxPhases)).some((v) =>
        ['entering', 'holding', 'leaving'].includes(v.phase),
      ),
      false,
    )
    check(
      options.prefs
        ? 'saved reduced motion skips transition'
        : 'system reduced motion skips transition',
    )
    await p.context().close()
  }
  const { p: missing, release: endMissing } = await slowPage({
    suppressEvents: true,
    clientGate: true,
  })
  await waitPhase(missing, 'entering')
  await missing.waitForFunction(() => !document.querySelector('.dx-transition'))
  endMissing()
  await clean(missing)
  const missingSequence = await missing.evaluate(() => window.__dxPhases)
  const entering = missingSequence.find((p) => p.phase === 'entering'),
    following = missingSequence.find((p) => p.phase === 'holding' || p.phase === 'leaving')
  assert.ok(following.time - entering.time >= 2300, JSON.stringify(missingSequence))
  check('missing animation events use bounded fallbacks', { phases: missingSequence })
  await missing.context().close()
  const hidden = await create({ hidden: true })
  await hidden.goto(baseURL)
  await settle(hidden)
  await clean(hidden)
  assert.equal(
    (await hidden.evaluate(() => window.__dxPhases)).some((v) => v.phase === 'entering'),
    false,
  )
  check('initial hidden-document branch (visibility simulated in browser) skips overlay')
  await hidden.context().close()
  const nojs = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' })
  const n = await nojs.newPage()
  await n.goto(baseURL)
  assert.equal(await n.locator('.dx-transition').count(), 0)
  assert.equal(await n.locator('[data-module]').count(), 7)
  assert.ok(await n.locator('#heading-deepseek').isVisible())
  check('JavaScript disabled retains SSR with no overlay')
  await nojs.close()
  if (!production) {
    const p = await create()
    await p.goto(baseURL)
    await settle(p)
    await clean(p)
    await p.evaluate(() => {
      window.__NOZOKI_DX_DEV__.background('loading')
      void window.__NOZOKI_DX_DEV__.play()
      void window.__NOZOKI_DX_DEV__.play()
    })
    await waitPhase(p, 'entering')
    assert.equal(await p.locator('.dx-transition').count(), 1)
    // Child or incorrectly named events must not complete the sentinel stage.
    await p.evaluate(() => {
      document
        .querySelector('.dx-geometry')
        .dispatchEvent(
          new AnimationEvent('animationend', { bubbles: true, animationName: 'nozoki-dx-cover' }),
        )
      document
        .querySelector('.dx-veil')
        .dispatchEvent(
          new AnimationEvent('animationend', { bubbles: true, animationName: 'unrelated' }),
        )
    })
    assert.equal(await p.locator('.dx-transition').getAttribute('data-phase'), 'entering')
    await p.evaluate(() => window.__NOZOKI_DX_DEV__.background('loaded'))
    await clean(p)
    check('duplicate requests share one overlay; wrong child/name events are ignored')
    for (let i = 0; i < 4; i++) {
      await p.evaluate(() => {
        window.__NOZOKI_DX_DEV__.background('loading')
        void window.__NOZOKI_DX_DEV__.play()
      })
      await waitPhase(p, 'entering')
      await p.evaluate(() => window.__NOZOKI_DX_DEV__.cancel())
      await clean(p)
    }
    check(
      'repeated cancellation does not accumulate owned listeners, timers or frames',
      await p.evaluate(() => window.__NOZOKI_DX_DEV__.stats()),
    )
    await p.evaluate(() => {
      window.__NOZOKI_DX_DEV__.background('loading')
      void window.__NOZOKI_DX_DEV__.play()
    })
    await waitPhase(p, 'entering')
    await p.evaluate(() => window.__NOZOKI_DX_DEV__.mount(false))
    await clean(p)
    assert.equal(await p.evaluate(() => window.__NOZOKI_DX_DEV__.stats().phase), 'unmounted')
    await p.evaluate(() => {
      window.__NOZOKI_DX_DEV__.background('loaded')
      window.__NOZOKI_DX_DEV__.mount(true)
    })
    await clean(p)
    check('mid-animation component unmount/remount releases owned resources')
    await p.evaluate(() => window.__NOZOKI_DX_DEV__.play(true))
    await clean(p)
    check('initialization exception falls back and releases resources')
    await p.evaluate(() => {
      window.__NOZOKI_DX_DEV__.background('loading')
      void window.__NOZOKI_DX_DEV__.play()
    })
    await waitPhase(p, 'entering')
    await p.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await clean(p)
    check('visibility change during animation cancels immediately (simulated visibility event)')
    await p.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden')
      window.__NOZOKI_DX_DEV__.background('loaded')
    })
    const cdp = await p.context().newCDPSession(p)
    await p.evaluate(() => {
      window.__NOZOKI_DX_DEV__.background('loading')
      void window.__NOZOKI_DX_DEV__.play()
    })
    await waitPhase(p, 'entering')
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
    await new Promise((r) => setTimeout(r, 350))
    await cdp.send('Page.setWebLifecycleState', { state: 'active' })
    await p.evaluate(() => window.__NOZOKI_DX_DEV__.background('loaded'))
    await clean(p)
    check('actual Chromium freeze/resume does not leave a blocking overlay')
    await p.evaluate(() => {
      window.__NOZOKI_DX_DEV__.background('loading')
      void window.__NOZOKI_DX_DEV__.play()
    })
    await waitPhase(p, 'entering')
    await p.reload()
    await settle(p)
    await clean(p)
    check('reload during animation starts a clean instance')
    await p.setViewportSize({ width: 390, height: 500 })
    await p.waitForFunction(() => document.documentElement.scrollHeight > innerHeight)
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await p.waitForFunction(() => scrollY > 0)
    check('page remains scrollable after all transitions')
    await p.context().close()
  }
  assert.deepEqual(result.runtimeErrors, [])
} catch (error) {
  result.failure = error.stack
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(`${evidence}/dx-${prefix}.json`, JSON.stringify(result, null, 2))
  await browser.close()
}

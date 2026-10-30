import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { launch, baseURL, production, evidence, settle } from './support.mjs'
import { createThemeColors } from '../../shared/domain/theme-colors.ts'
await mkdir(evidence, { recursive: true })
const browser = await launch()
const result = { baseURL, production, engine: browser.version(), cases: [] }
try {
  for (const [name, system, mode, expected] of [
    ['system-dark', 'dark', null, 'dark'],
    ['saved-dark', 'light', 'dark', 'dark'],
    ['saved-light', 'dark', 'light', 'light'],
    ['malformed', 'dark', 'invalid-json', 'dark'],
  ]) {
    const context = await browser.newContext({
      colorScheme: system,
      viewport: { width: 1440, height: 900 },
    })
    await context.addInitScript((mode) => {
      if (mode)
        localStorage.setItem(
          'nozoki-appearance-v1',
          mode === 'invalid-json' ? '{invalid' : JSON.stringify({ preset: 'm2', mode }),
        )
    }, mode)
    const p = await context.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await p.route('**/_nuxt/**', async (route) => {
      if (route.request().resourceType() === 'script') await gate
      await route.continue().catch(() => {})
    })
    await p.goto(baseURL, { waitUntil: 'commit' })
    await p.locator('#heading-deepseek').waitFor()
    await p.waitForFunction(
      () =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-body').trim() !== '',
    )
    const read = () =>
      p.evaluate(() => ({
        scheme: getComputedStyle(document.documentElement).colorScheme,
        card: getComputedStyle(document.querySelector('[data-module="deepseek"]')).backgroundColor,
        text: getComputedStyle(document.querySelector('#heading-deepseek')).color,
        overlay: !!document.querySelector('.dx-transition'),
        cards: document.querySelectorAll('[data-module]').length,
        mainDisplay: getComputedStyle(document.querySelector('main')).display,
        mainVisibility: getComputedStyle(document.querySelector('main')).visibility,
        mainOpacity: getComputedStyle(document.querySelector('main')).opacity,
      }))
    const before = await read()
    assert.equal(before.scheme, expected)
    // An early transition is now allowed; the SSR page itself must never be hidden.
    assert.notEqual(before.mainDisplay, 'none')
    assert.equal(before.mainVisibility, 'visible')
    assert.equal(before.mainOpacity, '1')
    assert.equal(before.cards, 7)
    await p.screenshot({
      path: `${evidence}/paint-${production ? 'production' : 'dev'}-${name}-before.png`,
    })
    release()
    await settle(p)
    const after = await read()
    assert.equal(after.overlay, false)
    assert.equal(after.scheme, expected)
    assert.equal(before.card, after.card)
    assert.equal(before.text, after.text)
    assert.deepEqual(errors, [])
    await p.screenshot({
      path: `${evidence}/paint-${production ? 'production' : 'dev'}-${name}-after.png`,
    })
    result.cases.push({
      name,
      expected,
      before,
      after,
      changed: before.card !== after.card || before.text !== after.text,
      errors,
    })
    console.log(`PASS first paint ${name}`)
    await context.close()
  }
  const context = await browser.newContext({ colorScheme: 'light' })
  await context.addInitScript(() =>
    localStorage.setItem(
      'nozoki-appearance-v1',
      JSON.stringify({ mode: 'dark', sourceColor: '#123456' }),
    ),
  )
  const p = await context.newPage()
  const html = await (await p.request.get(baseURL)).text()
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
    .map((match) => match[0].match(/href="([^"]+)"/)?.[1])
    .filter(Boolean)
  const probe = `${baseURL}/__local_theme_csp_probe`
  await p.route(probe, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/html',
        'content-security-policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'",
      },
      body: `<!doctype html><html><head><script src="/theme-init.js"></script>${css.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head><body>Theme CSP probe</body></html>`,
    }),
  )
  await p.goto(probe)
  assert.equal(await p.locator('html').getAttribute('data-nozoki-mode'), 'dark')
  assert.equal(
    await p.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'dark',
  )
  assert.equal(
    await p.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(),
    ),
    createThemeColors('#123456', true)['--color-primary'],
  )
  result.csp = {
    pass: true,
    scope:
      'External preference bootstrap, custom palette CSSOM assignments and stylesheet under self-only script/style CSP; not a complete Nuxt production CSP policy.',
  }
  console.log('PASS external theme script under self-only script CSP')
  await context.close()
} catch (error) {
  result.failure = error.stack
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(
    `${evidence}/first-paint-${production ? 'production' : 'dev'}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}

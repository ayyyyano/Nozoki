import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { firefox } from 'playwright'
import { baseURL, evidence, settle } from './support.mjs'

await mkdir(evidence, { recursive: true })
const recovered = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'ms-playwright/nozoki-firefox-1538-test/firefox/firefox.exe')
  : ''
const executablePath =
  process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH || (existsSync(recovered) ? recovered : undefined)
const result = {
  baseURL,
  method:
    'Firefox native layout.css.backdrop-filter.enabled=false, not a JavaScript CSS.supports mock or stylesheet replay.',
  cases: [],
  errors: [],
}
let browser
try {
  browser = await firefox.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    firefoxUserPrefs: { 'layout.css.backdrop-filter.enabled': false },
  })
  result.engine = browser.version()
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({
      colorScheme,
      viewport: { width: 1440, height: 900 },
    })
    await context.addInitScript(() =>
      localStorage.setItem(
        'nozoki-appearance-v1',
        JSON.stringify({ background: { layout: 'page', cardOpacity: 0, cardBlur: 20 } }),
      ),
    )
    const page = await context.newPage()
    page.on('pageerror', (error) => result.errors.push(error.message))
    await page.goto(baseURL, { waitUntil: 'networkidle' })
    await settle(page)
    const measured = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.background = 'var(--n-surface)'
      document.querySelector('.nozoki-app').append(probe)
      const expected = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        standard: CSS.supports('backdrop-filter', 'blur(1px)'),
        webkit: CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
        expected,
        cards: [...document.querySelectorAll('.module-card, .link-grid a')].map((el) => ({
          background: getComputedStyle(el).backgroundColor,
          opacity: getComputedStyle(el).opacity,
          filter: getComputedStyle(el).getPropertyValue('backdrop-filter'),
        })),
      }
    })
    assert.equal(measured.standard, false)
    assert.equal(measured.webkit, false)
    for (const card of measured.cards) {
      assert.equal(card.background, measured.expected)
      assert.equal(card.opacity, '1')
      assert.ok(!card.filter.includes('blur'))
    }
    await page.screenshot({ path: `${evidence}/native-fallback-firefox-${colorScheme}.png` })
    result.cases.push({ colorScheme, ...measured })
    console.log(`PASS native unsupported-filter fallback ${colorScheme}`)
    await context.close()
  }
  assert.deepEqual(result.errors, [])
} catch (error) {
  result.failure = error.stack
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(`${evidence}/native-fallback-firefox.json`, JSON.stringify(result, null, 2))
  await browser?.close()
}

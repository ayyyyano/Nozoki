import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launch, baseURL, evidence, production, settle } from './support.mjs'
await mkdir(evidence, { recursive: true })
const browser = await launch()
const result = {
  engine: browser.version(),
  method:
    'This Edge supports backdrop-filter. Replay the actual @supports-not rule body to verify readable fallback surfaces; this is not a native unsupported-engine test.',
  cases: [],
}
try {
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
    await page.goto(baseURL)
    await settle(page)
    const rule = await page.evaluate(() => {
      for (const sheet of document.styleSheets)
        for (const rule of sheet.cssRules) {
          if (
            rule instanceof CSSSupportsRule &&
            rule.conditionText.startsWith('not') &&
            rule.conditionText.includes('backdrop-filter')
          )
            return [...rule.cssRules].map((child) => child.cssText).join('\n')
        }
    })
    assert.ok(rule, 'Actual fallback rule must be in shipped CSS')
    await page.addStyleTag({ content: rule })
    await page.waitForFunction(() => {
      const probe = document.createElement('span')
      probe.style.background = 'var(--n-surface)'
      document.querySelector('.nozoki-app').append(probe)
      const expected = getComputedStyle(probe).backgroundColor
      probe.remove()
      return (
        getComputedStyle(document.querySelector('[data-module="deepseek"]')).backgroundColor ===
        expected
      )
    })
    const checked = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.background = 'var(--n-surface)'
      document.querySelector('.nozoki-app').append(probe)
      const expected = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        expected,
        backgrounds: [...document.querySelectorAll('.module-card, .link-grid a')].map((el) => ({
          bg: getComputedStyle(el).backgroundColor,
          opacity: getComputedStyle(el).opacity,
        })),
        nativeSupports: CSS.supports('backdrop-filter', 'blur(1px)'),
      }
    })
    for (const card of checked.backgrounds) {
      assert.equal(card.bg, checked.expected)
      assert.equal(card.opacity, '1')
    }
    result.cases.push({ colorScheme, ...checked })
    await page.screenshot({
      path: `${evidence}/fallback-${production ? 'production' : 'dev'}-${colorScheme}.png`,
    })
    await context.close()
  }
  console.log(
    'PASS shipped fallback rule replay in light/dark; native unsupported engine unavailable',
  )
} catch (error) {
  result.failure = error.stack
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(
    `${evidence}/fallback-${production ? 'production' : 'dev'}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}

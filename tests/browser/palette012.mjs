import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle, settings } from './support.mjs'
const evidence = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.2'
await mkdir(evidence, { recursive: true })
const browser = await launch(),
  result = { baseURL, production, checks: [], errors: [], firstPaint: [] }
const presets = [
  ['经典紫', '#6750A4'],
  ['天空蓝', '#0061A4'],
  ['青绿色', '#006A60'],
  ['草木绿', '#42691B'],
  ['樱花粉', '#984061'],
  ['暖橙色', '#9A4D00'],
]
const roles = [
  'primary',
  'on-primary',
  'primary-container',
  'on-primary-container',
  'secondary',
  'on-secondary',
  'tertiary',
  'on-tertiary',
  'surface',
  'on-surface',
  'surface-variant',
  'on-surface-variant',
  'outline',
  'outline-variant',
  'error',
  'on-error',
  'inverse-surface',
  'inverse-on-surface',
]
const read = (page) =>
  page.evaluate(
    (roles) =>
      Object.fromEntries(
        roles.map((n) => [
          n,
          getComputedStyle(document.documentElement)
            .getPropertyValue('--color-' + n)
            .trim(),
        ]),
      ),
    roles,
  )
try {
  const page = await browser.newPage({ colorScheme: 'light' })
  page.on('pageerror', (e) => result.errors.push(e.message))
  page.on('console', (m) => {
    if (/hydration|mismatch/i.test(m.text())) result.errors.push(m.text())
  })
  await page.goto(baseURL)
  await settle(page)
  await settings(page)
  for (const [name, hex] of presets) {
    await page.getByRole('button', { name, exact: true }).click()
    assert.equal(
      await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'),
      'true',
    )
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode })
      await page.waitForTimeout(180)
      const c = await read(page)
      for (const v of Object.values(c)) assert.match(v, /^#[a-f0-9]{6}$/)
      const component = await page.evaluate(() => {
        const css = getComputedStyle(document.querySelector('.appearance-dialog'))
        return Object.fromEntries(
          [
            '--slider-thumb-block-background',
            '--switch-handle-background',
            '--button-primary-color',
            '--popup-background',
            '--select-select-text-color',
          ].map((k) => [k, css.getPropertyValue(k)]),
        )
      })
      result.checks.push({ name, hex, mode, roles: c, component })
    }
  }
  const input = page.getByRole('textbox', { name: '自定义主题源色', exact: true })
  for (const value of ['#123456', 'rgb(103, 80, 164)', '#000000', '#FFFFFF']) {
    await input.fill(value)
    await page.getByRole('button', { name: '保存配色', exact: true }).click()
    const c = await read(page)
    assert.equal(await page.locator('.dx-transition').count(), 0)
    result.checks.push({ custom: value, roles: c })
  }
  const previous = await read(page)
  for (const invalid of ['#12', 'rgb(256,0,0)', 'red; background:url(x)']) {
    await input.fill(invalid)
    assert.equal(await page.getByRole('button', { name: '保存配色' }).isDisabled(), true)
    assert.deepEqual(await read(page), previous)
    assert.ok(await page.locator('.field-error').isVisible())
  }
  await input.fill('#006A60')
  await page.getByRole('button', { name: '保存配色' }).click()
  await page.screenshot({
    path: `${evidence}/palette-settings-${production ? 'production' : 'dev'}.png`,
  })
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.reload()
  await settle(page)
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('nozoki-appearance-v2')).overrides.sourceColor,
    ),
    '#006A60',
  )
  await page.close()
  // Delay only Nuxt JS. Theme-init remains an external blocking script; inspect real pre-hydration colors.
  for (const color of ['#6750A4', '#9A4D00', '#123456'])
    for (const mode of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme: mode })
      await context.addInitScript(
        (pref) => localStorage.setItem('nozoki-appearance-v1', JSON.stringify(pref)),
        { sourceColor: color, mode: 'system' },
      )
      const p = await context.newPage()
      let release
      const gate = new Promise((r) => (release = r))
      await p.route('**/_nuxt/**', async (route) => {
        if (route.request().resourceType() === 'script') await gate
        await route.continue()
      })
      await p.goto(baseURL, { waitUntil: 'commit' })
      await p.locator('[data-module="deepseek"]').waitFor()
      await p.waitForFunction(
        () => getComputedStyle(document.querySelector('.module-card')).borderRadius === '22px',
      )
      const before = await read(p)
      // Since 01.3 the external prepaint controller can show one transition
      // before Nuxt hydration. Color roles must already be correct beneath it.
      assert.ok((await p.locator('.dx-transition').count()) <= 1)
      release()
      await settle(p)
      assert.equal(await p.locator('.dx-transition').count(), 0)
      const after = await read(p)
      assert.deepEqual(after, before)
      result.firstPaint.push({ color, mode, before, after })
      await context.close()
    }
  assert.deepEqual(result.errors, [])
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(
    `${evidence}/palette-${production ? 'production' : 'dev'}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
console.log(
  JSON.stringify({
    checks: result.checks.length,
    paint: result.firstPaint.length,
    failure: result.failure,
  }),
)

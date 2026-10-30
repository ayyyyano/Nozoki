import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launch, baseURL, settle, settings } from './support.mjs'
const evidence = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.2'
await mkdir(evidence, { recursive: true })
const before = process.env.SLIDER_BEFORE === '1'
const browser = await launch()
const result = { baseURL, before, engine: browser.version(), records: [], errors: [] }
const initialValues = new WeakMap()
const definitions = [
  ['水平位置', 'x', 100, [25, 50, 75]],
  ['垂直位置', 'y', 100, [20, 35, 65]],
  ['遮罩深浅', 'overlay', 100, [20, 45, 80]],
  ['卡片不透明度', 'cardOpacity', 100, [35, 50, 72]],
  ['卡片背景模糊', 'cardBlur', 20, [3, 6, 12]],
]
async function snapshot(page, label, key, stage, expected) {
  const thumb = page.getByRole('slider', { name: label, exact: true })
  const actual = await thumb.evaluate((e) => ({
    dom: Number(e.getAttribute('aria-valuenow')),
    display: e.closest('.setting-slider').querySelector('output').textContent,
    trackWidth: e.closest('.setting-slider').querySelector('.var-slider__horizontal-block')
      .offsetWidth,
    transform: getComputedStyle(e.closest('.var-popup__content')).transform,
    saved:
      JSON.parse(localStorage.getItem('nozoki-appearance-v2') || 'null')?.overrides?.background ??
      JSON.parse(localStorage.getItem('nozoki-appearance-v1') || 'null')?.background ??
      {},
  }))
  if (!initialValues.has(page)) initialValues.set(page, {})
  const initial = initialValues.get(page)
  if (!Object.hasOwn(initial, key)) initial[key] = actual.dom
  result.records.push({ label, key, stage, expected, ...actual })
  if (!before && expected != null) {
    assert.ok(Math.abs(actual.dom - expected) <= 1, JSON.stringify(result.records.at(-1)))
    // v2 omits unchanged shared defaults; an absent override must still equal
    // this context's initial value. Explicit changes must be persisted exactly.
    assert.equal(Object.hasOwn(actual.saved, key) ? actual.saved[key] : initial[key], actual.dom)
    assert.ok(actual.display.startsWith(String(actual.dom)))
  }
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => result.errors.push(e.message))
  await page.goto(baseURL)
  await settle(page)
  await settings(page)
  // Wait for Popup's CSS transform to finish; values are always changed using actual input.
  await page.waitForTimeout(350)
  for (const [label, key, max, values] of definitions) {
    const thumb = page.getByRole('slider', { name: label, exact: true })
    const track = page
      .locator('.setting-slider')
      .filter({ has: thumb })
      .locator('.var-slider__horizontal-block')
    await track.scrollIntoViewIfNeeded()
    const box = await track.boundingBox()
    await snapshot(page, label, key, 'before', null)
    if (!before) {
      for (const value of [0, max]) {
        await page.mouse.click(
          box.x + (value === 0 ? 0.25 : box.width - 0.25),
          box.y + box.height / 2,
        )
        await snapshot(page, label, key, 'track boundary', value)
      }
    }
    for (const value of values) {
      await page.mouse.click(box.x + (box.width * value) / max, box.y + box.height / 2)
      await snapshot(page, label, key, 'track click', value)
    }
    const t = await thumb.boundingBox()
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
    await page.mouse.down()
    for (const value of [...values, ...values.toReversed()]) {
      await page.mouse.move(box.x + (box.width * value) / max, box.y + box.height / 2, { steps: 8 })
      await snapshot(page, label, key, 'dragging', value)
    }
    await page.mouse.up()
    await snapshot(page, label, key, 'released', values[0])
    if (!before) {
      await thumb.focus()
      await thumb.press('Home')
      await snapshot(page, label, key, 'Home', 0)
      await thumb.press('End')
      await snapshot(page, label, key, 'End', max)
      await thumb.press('ArrowLeft')
      await snapshot(page, label, key, 'ArrowLeft', max - 1)
      await thumb.press('ArrowRight')
      await snapshot(page, label, key, 'ArrowRight', max)
      await thumb.press('Home')
      for (let i = 0; i < values[1]; i++) await thumb.press('ArrowUp')
      await snapshot(page, label, key, 'keyboard middle', values[1])
      await thumb.press('ArrowDown')
      await snapshot(page, label, key, 'ArrowDown', values[1] - 1)
      await thumb.press('ArrowUp')
      await snapshot(page, label, key, 'ArrowUp', values[1])
    }
  }
  await page.screenshot({ path: `${evidence}/slider-${before ? 'before' : 'after'}.png` })
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await settings(page)
  for (const [label, key, , values] of definitions)
    await snapshot(page, label, key, 'reopened', before ? null : values[1])
  await page.reload()
  await settle(page)
  await settings(page)
  for (const [label, key, , values] of definitions)
    await snapshot(page, label, key, 'refreshed', before ? null : values[1])
  await context.close()
  if (!before) {
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    const touchPage = await mobile.newPage()
    await touchPage.goto(baseURL)
    await settle(touchPage)
    await settings(touchPage)
    await touchPage.waitForTimeout(350)
    const cdp = await mobile.newCDPSession(touchPage)
    for (const [label, key, max, values] of definitions) {
      const thumb = touchPage.getByRole('slider', { name: label, exact: true })
      const track = touchPage
        .locator('.setting-slider')
        .filter({ has: thumb })
        .locator('.var-slider__horizontal-block')
      await track.scrollIntoViewIfNeeded()
      const b = await track.boundingBox(),
        t = await thumb.boundingBox()
      await snapshot(touchPage, label, key, 'touch baseline', null)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: t.x + t.width / 2, y: t.y + t.height / 2 }],
      })
      for (const value of [...values, ...values.toReversed()]) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: b.x + (b.width * value) / max, y: b.y + b.height / 2 }],
        })
        await touchPage.evaluate(() => new Promise(requestAnimationFrame))
        await snapshot(touchPage, label, key, 'native touch moving', value)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await snapshot(touchPage, label, key, 'touch released', values[0])
    }
    await mobile.close()
  }
  assert.deepEqual(result.errors, [])
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(
    `${evidence}/slider-${before ? 'before' : 'after'}${process.env.CHECK_PRODUCTION === '1' ? '-production' : ''}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
console.log(JSON.stringify({ records: result.records.length, failure: result.failure }))

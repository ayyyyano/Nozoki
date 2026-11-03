import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle, geometry, settings, select } from './support.mjs'
const dir = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.3'
await mkdir(dir, { recursive: true })
const browser = await launch(),
  prefix = production ? 'production' : 'dev'
const result = { baseURL, engine: browser.version(), layouts: [], themes: [], errors: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  page.on('pageerror', (e) => result.errors.push(e.message))
  await page.addInitScript(() =>
    localStorage.setItem(
      'nozoki-appearance-v1',
      JSON.stringify({ mode: 'dark', background: { layout: 'banner' } }),
    ),
  )
  await page.goto(baseURL)
  await settle(page)
  if (process.env.CHECK_BEFORE === '1') {
    await page.screenshot({ path: `${dir}/before-banner-1440-dark.png`, fullPage: true })
    result.before = await geometry(page)
  } else {
    for (const scenario of production ? ['unconfigured'] : ['unconfigured', 'complete', 'edge']) {
      if (scenario !== 'unconfigured') {
        await page.locator('.fixture-preview > summary').click()
        await select(page, '开发数据场景', scenario)
        await page.locator('.fixture-preview > summary').click()
      }
      for (const [width, height] of [
        [1920, 1080],
        [1440, 900],
        [1280, 720],
        [1024, 768],
        [768, 1024],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height })
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForFunction(() => scrollY === 0)
        const g = await geometry(page)
        Object.assign(
          g,
          await page.evaluate(() => {
            const rect = (selector) => {
              const r = document.querySelector(selector).getBoundingClientRect()
              return {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                bottom: r.bottom,
                right: r.right,
              }
            }
            return {
              banner: rect('.background-scene.banner'),
              wave: rect('.banner-wave'),
              main: rect('main'),
              stage: rect('.dashboard-stage'),
              services: rect('[data-module="services"]'),
              pageHeight: document.querySelector('.nozoki-app').getBoundingClientRect().height,
            }
          }),
          { scenario },
        )
        assert.equal(await page.locator('.banner-wave path').count(), 3)
        assert.ok(Math.abs(g.banner.width - g.wave.width) < 1)
        assert.ok(g.wave.bottom >= g.banner.bottom - 1 && g.wave.bottom <= g.banner.bottom + 2)
        if (width > 1100) {
          const visual = [...g.cards].sort((a, b) =>
            Math.abs(a.y - b.y) < 1 ? a.x - b.x : a.y - b.y,
          )
          assert.deepEqual(
            visual.map((c) => c.id),
            g.cards.map((c) => c.id),
          )
          assert.ok(Math.abs(g.pageHeight - g.services.bottom - 24) < 1, JSON.stringify(g))
          if (scenario === 'unconfigured') {
            assert.equal(g.scrollHeight, height)
            assert.ok(height - g.services.bottom >= 23 && height - g.services.bottom <= 25)
          }
        }
        result.layouts.push(g)
        if (scenario === 'unconfigured' || (scenario === 'edge' && width === 390))
          await page.screenshot({
            path: `${dir}/${prefix}-banner-${scenario}-${width}.png`,
            fullPage: true,
          })
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    if (!production) {
      await page.locator('.fixture-preview > summary').click()
      await select(page, '开发数据场景', 'unconfigured')
      await page.locator('.fixture-preview > summary').click()
    }
    for (const color of ['#6750A4', '#0061A4', '#006A60', '#375B86']) {
      for (const mode of ['light', 'dark']) {
        await settings(page)
        const input = page.getByRole('textbox', { name: '自定义主题源色', exact: true })
        await input.fill(color)
        await page.getByRole('button', { name: '保存配色', exact: true }).click()
        await page.getByRole('button', { name: '完成', exact: true }).click()
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
        if ((await page.locator('.nozoki-app').getAttribute('data-color-mode')) !== mode)
          await page
            .getByRole('button', {
              name: mode === 'light' ? '切换到亮色模式' : '切换到暗色模式',
              exact: true,
            })
            .click()
        await page.waitForTimeout(200)
        const colors = await page.evaluate(() => ({
          source: document.documentElement.dataset.nozokiSource,
          mode: document.querySelector('.nozoki-app').dataset.colorMode,
          background: getComputedStyle(document.querySelector('.dashboard-stage')).backgroundImage,
          wave: getComputedStyle(document.querySelector('.banner-wave .wave-front')).fill,
          card: getComputedStyle(document.querySelector('[data-module="deepseek"]'))
            .backgroundColor,
        }))
        assert.equal(colors.source, color)
        assert.equal(colors.mode, mode)
        assert.match(colors.background, /linear-gradient/)
        assert.notEqual(colors.wave, 'rgb(0, 0, 0)')
        result.themes.push(colors)
        await page.screenshot({ path: `${dir}/${prefix}-banner-${color.slice(1)}-${mode}.png` })
      }
    }
    assert.equal(new Set(result.themes.map((t) => t.background)).size, 8)
    await page.locator('.banner-wave').screenshot({ path: `${dir}/${prefix}-wave-detail.png` })
    await settings(page)
    await select(page, '展示方式', '整页背景')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.banner-wave').count(), 0)
    assert.equal(
      await page.locator('.dashboard-stage').evaluate((e) => getComputedStyle(e).backgroundImage),
      'none',
    )
    await page.screenshot({ path: `${dir}/${prefix}-page-dark.png` })
    await settings(page)
    await select(page, '背景来源', '关闭')
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.banner-wave').count(), 0)
    assert.deepEqual(result.errors, [])
  }
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(
    `${dir}/layout-${process.env.CHECK_BEFORE === '1' ? 'before' : prefix}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
console.log(
  JSON.stringify({
    layouts: result.layouts.length,
    themes: result.themes.length,
    failure: result.failure,
  }),
)

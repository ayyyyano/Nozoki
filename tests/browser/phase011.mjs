import assert from 'node:assert/strict'
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  launch,
  baseURL,
  production,
  evidence,
  select,
  settings,
  settle,
  geometry,
} from './support.mjs'
await mkdir(evidence, { recursive: true })
const browser = await launch()
const prefix = production ? 'production' : 'dev'
const result = {
  baseURL,
  production,
  engine: browser.version(),
  checks: [],
  errors: [],
  hydration: [],
  requests: [],
  layouts: [],
}
const check = (name, detail = {}) => {
  result.checks.push({ name, ...detail })
  console.log(`PASS ${name}`)
}
async function pageAt(viewport = { width: 1440, height: 900 }, colorScheme = 'dark', prefs) {
  const context = await browser.newContext({
    viewport,
    colorScheme,
    reducedMotion: 'no-preference',
  })
  if (prefs)
    await context.addInitScript(
      (value) => localStorage.setItem('nozoki-appearance-v1', JSON.stringify(value)),
      prefs,
    )
  const page = await context.newPage()
  page.on('pageerror', (error) => result.errors.push(error.message))
  page.on('console', (message) => {
    if (/hydration|mismatch/i.test(message.text())) result.hydration.push(message.text())
  })
  page.on('request', (request) => {
    if (
      request.url().startsWith('http') &&
      !['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)
    )
      result.requests.push(request.url())
  })
  return page
}
async function load(page, path = '/') {
  const response = await page.goto(baseURL + path, { waitUntil: 'networkidle' })
  assert.equal(response.status(), 200)
  assert.ok((await response.text()).includes('heading-deepseek'))
  await settle(page)
  assert.equal(await page.locator('[data-module]').count(), 7)
}
async function slider(page, label, value) {
  const control = page.getByRole('slider', { name: label, exact: true })
  await control.focus()
  const max = Number(await control.getAttribute('aria-valuemax'))
  await control.press(value === max ? 'End' : 'Home')
  if (value !== max) for (let i = 0; i < value; i++) await control.press('ArrowRight')
  assert.equal(await control.getAttribute('aria-valuenow'), String(value))
}
try {
  const nojs = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
  })
  const ssr = await nojs.newPage()
  await ssr.goto(baseURL)
  assert.equal(await ssr.locator('[data-module]').count(), 7)
  assert.equal(await ssr.locator('.dx-transition').count(), 0)
  assert.ok(await ssr.locator('[role="timer"]').isVisible())
  assert.equal(
    await ssr.locator('.background-scene img').evaluate((e) => getComputedStyle(e).opacity),
    '1',
  )
  await ssr.screenshot({ path: `${evidence}/${prefix}-no-js.png` })
  check('SSR without JavaScript remains visible and unobstructed')
  await nojs.close()
  for (const [width, height, columns] of [
    [1440, 900, 3],
    [1920, 1080, 3],
    [1280, 720, 3],
    [1024, 768, 2],
    [768, 1024, 2],
    [390, 844, 1],
  ]) {
    for (const color of ['dark', 'light']) {
      const p = await pageAt({ width, height }, color)
      await load(p)
      const measured = await geometry(p)
      assert.equal(measured.columns, columns)
      if (width === 1440 || width === 1920) assert.ok(measured.scrollHeight <= height + 1)
      result.layouts.push({ scenario: 'unconfigured', color, ...measured })
      assert.equal(await p.locator('.page-actions button').count(), 3)
      assert.equal(await p.locator('.nozoki-bar, .page-heading, .page-footer').count(), 0)
      assert.equal(await p.locator('.link-grid a').count(), 4)
      await p.screenshot({
        path: `${evidence}/${prefix}-page-${width}-${color}.png`,
        fullPage: true,
      })
      check(`${width}×${height} ${color} layout`, { scrollHeight: measured.scrollHeight })
      await p.context().close()
    }
  }
  const p = await pageAt()
  await load(p)
  assert.equal(await p.locator('.nozoki-app').getAttribute('data-color-mode'), 'dark')
  await p.emulateMedia({ colorScheme: 'light' })
  await p.waitForFunction(() => document.querySelector('.nozoki-app').dataset.colorMode === 'light')
  await p.emulateMedia({ colorScheme: 'dark' })
  await p.waitForFunction(() => document.querySelector('.nozoki-app').dataset.colorMode === 'dark')
  for (let i = 0; i < 6; i++) await p.getByRole('button', { name: /切换到.*色模式/ }).click()
  assert.equal(await p.locator('.nozoki-app').getAttribute('data-color-mode'), 'dark')
  await p.reload()
  await settle(p)
  assert.equal(await p.locator('.nozoki-app').getAttribute('data-color-mode'), 'dark')
  await p.emulateMedia({ colorScheme: 'light' })
  assert.equal(await p.locator('.nozoki-app').getAttribute('data-color-mode'), 'dark')
  check('system following, rapid explicit toggles and preference restoration')
  const dialog = await settings(p)
  assert.equal(await dialog.locator('select, input[type="range"]').count(), 0)
  assert.equal(await p.getByLabel('设计预设').count(), 0)
  assert.equal(await p.getByLabel('颜色模式', { exact: true }).count(), 0)
  await select(p, '展示方式', '顶部横幅')
  assert.equal(await p.getByRole('slider', { name: '卡片不透明度', exact: true }).count(), 0)
  await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.screenshot({ path: `${evidence}/${prefix}-banner-dark.png`, fullPage: true })
  assert.equal(
    await p.locator('[data-module="deepseek"]').evaluate((e) => getComputedStyle(e).backdropFilter),
    'none',
  )
  check('banner uses opaque surfaces; no M2 or mode dropdown')
  await settings(p)
  await select(p, '展示方式', '整页背景')
  for (const [opacity, blur] of [
    [0, 0],
    [50, 0],
    [50, 6],
    [50, 20],
    [100, 0],
  ]) {
    await slider(p, '卡片不透明度', opacity)
    await slider(p, '卡片背景模糊', blur)
    await p.getByRole('button', { name: '完成', exact: true }).click()
    const computed = await p.locator('[data-module="deepseek"]').evaluate((e) => ({
      opacity: getComputedStyle(e).opacity,
      bg: getComputedStyle(e).backgroundColor,
      filter: getComputedStyle(e).backdropFilter,
      text: getComputedStyle(e.querySelector('h2')).color,
    }))
    assert.equal(computed.opacity, '1')
    assert.equal(computed.filter, blur ? `blur(${blur}px)` : 'none')
    await p.screenshot({ path: `${evidence}/${prefix}-opacity-${opacity}-blur-${blur}.png` })
    check(`background only opacity ${opacity} blur ${blur}`, computed)
    await settings(p)
  }
  await p.getByRole('button', { name: '恢复默认', exact: true }).click()
  await p.screenshot({ path: `${evidence}/${prefix}-settings.png` })
  await p.getByLabel('展示方式', { exact: true }).focus()
  await p.keyboard.press('Enter')
  await p.locator('.var-menu__menu:visible').waitFor()
  await p.screenshot({ path: `${evidence}/${prefix}-settings-menu.png` })
  await p.keyboard.press('Escape')
  assert.ok(await dialog.isVisible(), 'Escape closes the open Select menu first')
  await p.locator('.var-menu__menu:visible').waitFor({ state: 'hidden' })
  await p.keyboard.press('Escape')
  await p.getByRole('button', { name: '外观偏好', exact: true }).waitFor({ state: 'visible' })
  await p.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '外观偏好')
  await settings(p)
  for (let i = 0; i < 24; i++) {
    await p.keyboard.press('Tab')
    assert.ok(
      await p.evaluate(
        () => !!document.activeElement?.closest('.appearance-dialog, .var-menu__menu'),
      ),
    )
  }
  await p.getByRole('slider', { name: '水平位置', exact: true }).focus()
  await p.keyboard.press('End')
  assert.equal(
    await p.getByRole('slider', { name: '水平位置', exact: true }).getAttribute('aria-valuenow'),
    '100',
  )
  await p.getByRole('switch', { name: '减少动态效果', exact: true }).click()
  await p.getByRole('button', { name: '完成', exact: true }).click()
  assert.equal(await p.locator('.nozoki-app').getAttribute('data-reduced-motion'), 'true')
  assert.equal(await p.locator('html').getAttribute('data-nozoki-reduced'), 'true')
  check('keyboard menu, slider, modal focus loop/return, saved reduced motion')
  await settings(p)
  await p.getByRole('button', { name: '恢复默认', exact: true }).click()
  await p.keyboard.press('Escape')
  await p.emulateMedia({ reducedMotion: 'reduce' })
  await p.waitForFunction(
    () => document.querySelector('.nozoki-app').dataset.reducedMotion === 'true',
  )
  check('system reduced motion')
  await p.context().close()
  const light = await pageAt({ width: 1440, height: 900 }, 'light')
  await load(light)
  for (const [opacity, blur] of [
    [0, 0],
    [50, 6],
    [100, 20],
  ]) {
    await settings(light)
    await slider(light, '卡片不透明度', opacity)
    await slider(light, '卡片背景模糊', blur)
    await light.getByRole('button', { name: '完成', exact: true }).click()
    assert.equal(
      await light.locator('[data-module="deepseek"]').evaluate((e) => getComputedStyle(e).opacity),
      '1',
    )
    await light.screenshot({
      path: `${evidence}/${prefix}-light-opacity-${opacity}-blur-${blur}.png`,
    })
  }
  check('light theme opacity 0/50/100 and blur 0/6/20 preserve foreground opacity')
  await light.context().close()
  const legacy = await pageAt({ width: 1440, height: 900 }, 'light', {
    preset: 'm2',
    mode: 'dark',
    background: { layout: 'page', cardOpacity: 50, cardBlur: 0 },
  })
  await load(legacy)
  assert.equal(await legacy.locator('.nozoki-app').getAttribute('data-preset'), 'm3')
  assert.equal(await legacy.locator('.nozoki-app').getAttribute('data-color-mode'), 'dark')
  await settings(legacy)
  await legacy.getByRole('slider', { name: '卡片背景模糊' }).press('ArrowRight')
  await legacy.keyboard.press('Escape')
  assert.equal(
    await legacy.evaluate(
      () => 'preset' in JSON.parse(localStorage.getItem('nozoki-appearance-v1')),
    ),
    false,
  )
  check('legacy M2 normalizes and saves the remaining preferences')
  await legacy.context().close()
  const failed = await pageAt({ width: 390, height: 844 }, 'dark', {
    mode: 'dark',
    background: { source: 'custom', url: 'https://background.invalid/broken.webp', layout: 'page' },
  })
  await failed.route('https://background.invalid/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/webp', body: 'not-an-image' }),
  )
  await load(failed)
  await failed.locator('[data-background="failed"]').waitFor()
  await failed.screenshot({
    path: `${evidence}/${prefix}-background-failure-390.png`,
    fullPage: true,
  })
  await geometry(failed)
  await settings(failed)
  await select(failed, '背景来源', '关闭')
  await failed.keyboard.press('Escape')
  assert.equal(await failed.locator('.background-scene').count(), 0)
  check('failed and disabled backgrounds retain readable theme fallback')
  await failed.context().close()
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    hasTouch: true,
    isMobile: true,
  })
  const touch = await touchContext.newPage()
  await load(touch)
  await settings(touch)
  const thumb = touch.getByRole('slider', { name: '卡片背景模糊', exact: true })
  await thumb.scrollIntoViewIfNeeded()
  const box = await thumb.boundingBox()
  const touchSession = await touchContext.newCDPSession(touch)
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  })
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 35, y }],
  })
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await touch.waitForFunction(
    () =>
      document
        .querySelector('[role="slider"][aria-label="卡片背景模糊"]')
        .getAttribute('aria-valuenow') !== '8',
  )
  await select(touch, '背景来源', '自定义 HTTPS 图片')
  await touch
    .getByRole('textbox', { name: 'HTTPS 图片地址', exact: true })
    .fill('http://example.com/unsafe.webp')
  await touch.getByRole('button', { name: '应用图片地址' }).click()
  assert.ok(await touch.getByRole('alert').isVisible())
  await select(touch, '图片适配', 'contain · 完整显示')
  await touch.screenshot({ path: `${evidence}/${prefix}-settings-390.png` })
  await touch.keyboard.press('Escape')
  await geometry(touch)
  check('mobile touch slider, uncropped Varlet menu and HTTPS validation')
  await touchContext.close()
  if (!production) {
    const fixture = await pageAt()
    await load(fixture)
    await fixture.locator('.fixture-preview summary').click()
    for (const scenario of [
      'complete',
      'edge',
      'stale',
      'error',
      'unsupported',
      'offline',
      'empty',
      'unconfigured',
    ]) {
      await select(fixture, '开发数据场景', scenario)
      if (scenario !== 'unconfigured')
        assert.ok(
          (await fixture.locator('.fixture-preview summary').textContent()).includes('非真实状态'),
        )
      if (scenario === 'edge') {
        assert.ok((await fixture.locator('[data-module="devices"]').textContent()).includes('0%'))
        assert.equal(await fixture.locator('.device-row').count(), 6)
        assert.equal(await fixture.locator('.monitor-row').count(), 6)
        assert.ok(
          (await fixture.locator('[data-module="deepseek"]').textContent()).includes(
            '1,234,567,890,123,456.123456',
          ),
        )
        assert.equal(
          await fixture.locator('.quota-row').count(),
          0,
          'unverified quota never invents percentages',
        )
        await fixture.locator('.fixture-preview summary').click()
        for (const [width, height] of [
          [1440, 900],
          [1024, 768],
          [768, 1024],
          [390, 844],
        ]) {
          await fixture.setViewportSize({ width, height })
          const measured = await geometry(fixture)
          result.layouts.push({ scenario: 'edge', ...measured })
          await fixture.screenshot({ path: `${evidence}/dev-dense-${width}.png`, fullPage: true })
        }
        await fixture.setViewportSize({ width: 1440, height: 900 })
        await fixture.locator('.fixture-preview summary').click()
      }
      if (scenario === 'error') {
        assert.equal(await fixture.locator('.monitor-row').count(), 0)
        assert.ok(
          (await fixture.locator('[data-module="services"]').textContent()).includes(
            '采集失败不代表监控对象离线',
          ),
        )
      }
      if (scenario === 'stale')
        assert.ok(
          (await fixture.locator('[data-module="devices"]').textContent()).includes('最近成功'),
        )
      await geometry(fixture)
      check(`development fixture ${scenario}`)
    }
    await fixture.getByRole('switch', { name: 'DeepSeek', exact: true }).click()
    assert.equal(await fixture.locator('[data-module]').count(), 6)
    await fixture.getByRole('button', { name: '反转展示顺序', exact: true }).click()
    assert.equal(
      await fixture.locator('[data-module]').first().getAttribute('data-module'),
      'services',
    )
    check('module toggling and sorting remain independent from authorization')
    await fixture.context().close()
  } else {
    const isolated = await pageAt()
    await load(isolated, '/?fixture=edge&role=admin&demo=1')
    assert.equal(await isolated.locator('.fixture-preview').count(), 0)
    assert.equal(
      await isolated
        .locator('.device-row, .spend-bars, .quote-chart, .quota-row, .monitor-row')
        .count(),
      0,
    )
    assert.equal(await isolated.evaluate(() => '__NOZOKI_DX_DEV__' in window), false)
    async function scan(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) await scan(path)
        else if (/\.(m?js|json|html|css|map)$/.test(entry.name)) {
          const content = await readFile(path, 'utf8')
          assert.ok(
            !/NOZOKI_FIXTURE_ONLY|__NOZOKI_DX_DEV__|扩展设备|开发数据场景/.test(content),
            path,
          )
        }
      }
    }
    await scan('.output')
    check('production payload and artifacts exclude fixtures, dev APIs and URL activation')
    await isolated.context().close()
  }
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.hydration, [])
  assert.ok(result.requests.every((url) => url.startsWith('https://background.invalid/')))
  check('no runtime/hydration errors or provider requests')
} catch (error) {
  result.failure = error.stack
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(`${evidence}/browser-${prefix}.json`, JSON.stringify(result, null, 2))
  await browser.close()
}

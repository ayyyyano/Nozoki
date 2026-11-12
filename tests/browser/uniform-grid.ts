// Offline DTOs and disposable D1 only. Evidence must be outside the checkout.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { expect } from 'playwright/test'
import { fixture, fixed } from '../fixtures/layout.ts'
import { balanceDays } from '../../shared/domain/daily-balances.ts'
import { MODULE_DISPLAY_ORDER, dashboardPlan } from '../../shared/domain/module-layout.ts'
import { stable, measure, capture } from './layout-support.ts'
import { settle } from './support.ts'

export async function exerciseUniformGrid(page, { origin, evidence, input, request, save, db }) {
  const location = relative(resolve('.'), resolve(evidence))
  assert.ok(
    location.startsWith('..') || isAbsolute(location),
    'Evidence must be outside repository',
  )
  await mkdir(evidence, { recursive: true })
  await page.clock.setFixedTime(fixed)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const full = await fixture({ devices: 7, monitors: 12, disabled: [], stale: true })
  for (const id of ['codex', 'tailscale']) {
    const m = full.modules.find((m) => m.id === id)
    m.snapshot = { ...m.snapshot, status: 'unconfigured', data: null, sourceConfigured: false }
  }
  const balance = full.modules.find((m) => m.id === 'deepseek').snapshot
  balance.data.balances = balance.data.balances.filter((b) => b.currency === 'CNY')
  balance.data.dailyBalances = balanceDays(fixed, 'Asia/Shanghai').map(({ day }, i) => ({
    day,
    currency: 'CNY',
    total: String(100 - i),
    collectedAt: fixed.toISOString(),
  }))
  let current = full
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: current }))
  await page.goto(origin)
  await settle(page)
  const ids = MODULE_DISPLAY_ORDER.filter((id) => id !== 'links')
  const enabledIds = (count) =>
    ids.filter((id) =>
      ['deepseek', 'devices', 'quotes', 'activity', 'services', 'codex', 'tailscale']
        .slice(0, count)
        .includes(id),
    )
  const report = []
  async function refresh(count, links = true, linkCount = 4) {
    current = structuredClone(full)
    current.modules = current.modules.filter(
      (m) => enabledIds(count).includes(m.id) || (links && m.id === 'links'),
    )
    const navigation = current.modules.find((m) => m.id === 'links')
    if (navigation)
      navigation.snapshot.data.items = navigation.snapshot.data.items.slice(0, linkCount)
    const response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await response
    await expect(page.locator('.dashboard-grid > [data-module]')).toHaveCount(count + Number(links))
    await stable(page)
  }
  async function inspect(count, links, label) {
    const m = await measure(page)
    const content = await page.locator('.dashboard-grid > .module-card').evaluateAll((nodes) =>
      nodes.map((el) => {
        const r = el.getBoundingClientRect(),
          style = getComputedStyle(el)
        const children = [
          ...el.querySelectorAll(
            ':scope > .module-header, :scope > .module-body, :scope > .module-footer',
          ),
        ]
        return {
          id: el.dataset.module,
          status: el.dataset.status,
          height: r.height,
          required: el.scrollHeight,
          client: el.clientHeight,
          heading: el.querySelector('h2').getBoundingClientRect().top - r.top,
          footer: el.querySelector('.module-footer')?.getBoundingClientRect().bottom - r.top,
          contentsBottom:
            Math.max(...children.map((c) => c.getBoundingClientRect().bottom)) - r.top,
          padding: parseFloat(style.paddingBottom),
          width: el.clientWidth,
          scrollWidth: el.scrollWidth,
        }
      }),
    )
    const business = content.filter(
      (c) =>
        c.id !== 'links' &&
        (m.grid.width >= 500 || !['unconfigured', 'unsupported'].includes(c.status)),
    )
    await writeFile(
      resolve(evidence, 'latest-measurement.json'),
      JSON.stringify({ label, ...m, content }, null, 2),
    )
    assert.ok(m.pageWidth <= m.clientWidth, JSON.stringify(m))
    if (m.width >= 700 && m.cards.length)
      assert.ok(Math.abs(m.bottomPadding - 24) < 1, JSON.stringify(m))
    for (const card of content) {
      assert.ok(card.required <= card.client + 1, JSON.stringify(card))
      assert.ok(card.contentsBottom <= card.height - card.padding + 1, JSON.stringify(card))
      assert.ok(card.scrollWidth <= card.width + 1, JSON.stringify(card))
    }
    assert.ok(
      m.grid.width < 700 ||
        !business.length ||
        Math.max(...business.map((c) => c.height)) - Math.min(...business.map((c) => c.height)) <=
          1,
      JSON.stringify(content),
    )
    const capacity =
      m.grid.width >= 1328 ? 4 : m.grid.width >= 1040 ? 3 : m.grid.width >= 700 ? 2 : 1
    const navItems = current.modules.find((m) => m.id === 'links')?.snapshot.data.items.length ?? 0
    const plan = dashboardPlan(
      count,
      capacity,
      links && navItems > 0,
      m.grid.width < 1160 ? 'strip-single-tail' : 'fill',
    )
    assert.equal(m.columnCount, plan.columns, JSON.stringify(m))
    assert.deepEqual(m.domOrder, m.visualOrder)
    assert.deepEqual(m.domOrder, [...enabledIds(count), ...(links ? ['links'] : [])])
    if (links && count) {
      const nav = m.cards.at(-1),
        last = m.cards.at(-2)
      assert.ok(
        plan.links === 'cell'
          ? Math.abs(nav.y - last.y) < 1
          : plan.links === 'tail'
            ? Math.abs(nav.bottom - last.bottom) < 1
            : nav.y >= Math.max(...m.cards.slice(0, -1).map((c) => c.bottom)) + m.expectedGap - 1,
        JSON.stringify(m),
      )
    }
    if (links && navItems) {
      const internal = await page
        .locator('.links-module > .link-grid')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
      assert.equal(
        internal,
        plan.links !== 'strip' || m.grid.width < 500 ? Math.min(2, navItems) : navItems,
        JSON.stringify({ label, plan, internal }),
      )
    }
    for (const card of m.cards) {
      const peer = m.cards.find(
        (c) => c.id !== card.id && Math.abs(c.y - card.y) < 1 && c.x > card.x,
      )
      if (peer) assert.ok(Math.abs(peer.x - card.right - m.expectedGap) <= 1)
    }
    report.push({ label, count, links, plan, ...m, content })
    return m
  }
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 900],
    [768, 1024],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height })
    for (let count = 0; count <= 7; count++) {
      await refresh(count)
      await inspect(count, true, `${width}-${count}`)
      if (
        (width === 1440 && [1, 4, 5, 6, 7].includes(count)) ||
        (width === 1024 && [2, 5, 6].includes(count)) ||
        (width === 768 && [3, 4, 5].includes(count)) ||
        (width <= 390 && count === 7) ||
        (width === 1280 && count === 6)
      )
        await capture(page, resolve(evidence, `grid-${width}-${count}-links.png`))
      await refresh(count, false)
      await inspect(count, false, `${width}-${count}-no-links`)
    }
    await refresh(7)
    // Eighth business card is fixture DOM only, never a registered module or production DTO.
    const restore = await page.evaluate(
      (plans) => {
        const grid = document.querySelector('.dashboard-grid')
        const restore = {
          attributes: [...grid.attributes].map((a) => [a.name, a.value]),
          styles: [...grid.querySelectorAll('[data-layout-role="business"]')].map((el) =>
            el.getAttribute('style'),
          ),
        }
        const extra = grid.querySelector('[data-module="codex"]').cloneNode(true)
        extra.setAttribute('data-module', 'future-fixture')
        extra.querySelector('h2').textContent = '未来模块夹具'
        extra.querySelector('h2').id = 'heading-future-fixture'
        extra.setAttribute('aria-labelledby', 'heading-future-fixture')
        grid.insertBefore(extra, grid.querySelector('[data-module="links"]'))
        grid.dataset.businessCount = '8'
        grid.dataset.mediumLinks = 'strip'
        grid.dataset.compactWideLinks = 'cell'
        grid.dataset.wideLinks = 'cell'
        grid.dataset.expandedLinks = 'strip'
        for (const [index, key] of ['medium', 'compact-wide', 'wide', 'expanded'].entries()) {
          grid.style.setProperty(`--${key}-links-span`, String(plans[index].linksSpan))
          grid
            .querySelectorAll('[data-layout-role="business"]')
            .forEach((el, i) =>
              el.style.setProperty(`--${key}-span`, String(plans[index].businessSpans[i])),
            )
        }
        return restore
      },
      [
        dashboardPlan(8, 2, true),
        dashboardPlan(8, 3, true, 'strip-single-tail'),
        dashboardPlan(8, 3, true),
        dashboardPlan(8, 4, true),
      ],
    )
    await stable(page)
    const future = await measure(page)
    assert.equal(future.cards.length, 9)
    assert.deepEqual(future.domOrder, future.visualOrder)
    if (future.grid.width >= 700)
      assert.ok(
        future.cards.slice(0, -1).every((c) => Math.abs(c.height - future.cards[0].height) < 1),
      )
    else
      assert.equal(
        future.cards.find((c) => c.id === 'future-fixture').height,
        future.cards.find((c) => c.id === 'codex').height,
      )
    assert.ok(future.pageWidth <= future.clientWidth)
    report.push({ label: `${width}-future-8`, ...future })
    // Refresh drops the fixture node; normal Vue nodes keep their identity.
    await page.evaluate((restore) => {
      document.querySelector('[data-module="future-fixture"]').remove()
      const grid = document.querySelector('.dashboard-grid')
      for (const [key, value] of restore.attributes) grid.setAttribute(key, value)
      grid
        .querySelectorAll('[data-layout-role="business"]')
        .forEach((el, i) => el.setAttribute('style', restore.styles[i]))
    }, restore)
  }
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const count of [4, 5])
      for (let n = 0; n <= 4; n++) {
        await refresh(count, true, n)
        await expect(page.locator('[data-module="links"] .link-grid a')).toHaveCount(n)
        await inspect(count, true, `links-${width}-${count}-${n}`)
      }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await refresh(7)
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 900 })
    // Unbounded mandatory warnings/text scaling grow safely rather than being clipped.
    await page.locator('[data-module="services"] .module-body').evaluate((el) => {
      const warning = document.createElement('p')
      warning.className = 'fixture-warning'
      warning.setAttribute('role', 'alert')
      warning.textContent = '必须完整保留的重要状态警告。'.repeat(40)
      el.prepend(warning)
    })
    await stable(page)
    const safety = await page.locator('[data-module="services"]').evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }))
    assert.ok(safety.scroll <= safety.client + 1, JSON.stringify(safety))
    report.push({ label: 'mandatory-warning-' + width, ...safety })
    await page.locator('.fixture-warning').evaluate((el) => el.remove())
    await stable(page)
  }
  // Renaming and visibility changes do not affect classification or logical ordering.
  current = await fixture({
    devices: 4,
    monitors: 8,
    customTitles: true,
    longNames: true,
    disabled: [],
  })
  let response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await response
  await stable(page)
  assert.equal((await measure(page)).pageWidth <= 320, true)
  await expect(page.locator('.dashboard-grid > [data-module]')).toHaveCount(8)
  for (const mode of [
    { guest: true },
    { loginOnly: true },
    { guest: true, disabled: ['devices', 'services', 'tailscale'] },
  ]) {
    current = await fixture(mode)
    response = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await response
    await expect(page.locator('.dashboard-grid > [data-module]')).toHaveCount(
      current.modules.length,
    )
    await stable(page)
    assert.deepEqual(
      (await measure(page)).domOrder,
      current.modules.map((m) => m.id),
    )
    assert.equal(
      await page.locator('.dashboard-grid').getAttribute('data-business-count'),
      String(current.modules.filter((m) => m.id !== 'links').length),
    )
    for (const m of current.modules.filter((m) => m.kind === 'login_required'))
      await expect(page.locator(`[data-module="${m.id}"]`)).toContainText('登录后查看')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await refresh(7)
  for (const [title, selector, count] of [
    ['设备', '.device-row', 7],
    ['服务状态', '.monitor-row', 12],
    ['自选行情', '.quote-item', 2],
    ['DeepSeek', '.balance-record', 7],
  ]) {
    const trigger = page.getByRole('button', { name: `查看${title}详情`, exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: title + '详情', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator(selector)).toHaveCount(count)
    if (title === '自选行情') await expect(dialog).toContainText('昨收')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  }
  await page.setViewportSize({ width: 320, height: 844 })
  await page.getByRole('button', { name: '查看服务状态详情', exact: true }).click()
  const detail = page.getByRole('dialog', { name: '服务状态详情', exact: true })
  await expect(detail).toBeVisible()
  assert.ok(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth))
  await page.screenshot({ path: resolve(evidence, 'detail-services-320.png') })
  await page.keyboard.press('Escape')
  // Actual scrolling: fixed wallpaper stays viewport-bound at every card group.
  for (const id of ['deepseek', 'activity', 'quotes', 'services', 'links']) {
    await page.locator(`[data-module="${id}"]`).scrollIntoViewIfNeeded()
    const background = await page.locator('.background-scene.page').evaluate((el) => {
      const r = el.getBoundingClientRect(),
        image = el.querySelector('img')
      return {
        y: scrollY,
        documentHeight: document.documentElement.scrollHeight,
        position: getComputedStyle(el).position,
        top: r.top,
        bottom: r.bottom,
        visible: !!image?.complete && image.naturalWidth > 0,
      }
    })
    assert.equal(background.position, 'fixed')
    assert.ok(
      background.top <= 0 && background.bottom >= 843 && background.visible,
      JSON.stringify(background),
    )
    report.push({ label: 'wallpaper-' + id, ...background })
    await page.screenshot({ path: resolve(evidence, 'scroll-320-' + id + '.png') })
  }
  await page.unroute('**/api/dashboard')
  // Emulate persisted ordering from an old installation; no other settings are changed.
  await db.prepare('UPDATE dashboard_modules SET sort_order=100-sort_order').run()
  const before = await input()
  assert.deepEqual(
    before.config.modules.map((m) => m.id),
    MODULE_DISPLAY_ORDER,
  )
  const legacy = structuredClone(before)
  legacy.config.modules.reverse().forEach((m, i) => {
    m.sortOrder = 100 - i
  })
  legacy.config.modules.find((m) => m.id === 'devices').title = '持久化自定义设备标题'
  const key = crypto.randomUUID()
  const saved = await (await save(legacy, key)).json()
  assert.equal(saved.success, true, JSON.stringify(saved))
  assert.equal((await (await save(legacy, key)).json()).replayed, true)
  const equivalent = structuredClone(legacy)
  equivalent.config.modules.reverse().forEach((m, i) => {
    m.sortOrder = i + 500
  })
  assert.equal((await (await save(equivalent, key)).json()).replayed, true)
  assert.equal((await save(before)).status, 409)
  const after = await input()
  assert.equal(after.config.modules.find((m) => m.id === 'devices').title, '持久化自定义设备标题')
  assert.deepEqual(
    after.config.modules.map((m) => m.id),
    MODULE_DISPLAY_ORDER,
  )
  assert.deepEqual(
    (await db.prepare('SELECT id FROM dashboard_modules ORDER BY sort_order').all()).results.map(
      (m) => m.id,
    ),
    MODULE_DISPLAY_ORDER,
  )
  for (const m of before.config.modules) {
    const actual = after.config.modules.find((x) => x.id === m.id)
    assert.deepEqual({ ...actual, title: m.title }, m)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(origin + '/admin')
  await settle(page)
  await page.getByRole('button', { name: 'Dashboard 模块', exact: true }).click()
  assert.equal(
    await page
      .locator(
        '.admin-module-card button[aria-label^="上移"], .admin-module-card button[aria-label^="下移"]',
      )
      .count(),
    0,
  )
  await expect(page.locator('.admin-module-card > header [role="switch"]')).toHaveCount(8)
  await page.screenshot({ path: resolve(evidence, 'admin-modules.png') })
  await page.getByRole('switch', { name: '启用 devices', exact: true }).click()
  const put = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  assert.equal((await put).status(), 200)
  await page.goto(origin)
  await settle(page)
  await expect(page.locator('[data-module="devices"]')).toHaveCount(0)
  const live = await measure(page)
  assert.equal(await page.locator('.dashboard-grid').getAttribute('data-business-count'), '5')
  assert.equal(live.columnCount, 3)
  assert.ok(Math.abs(live.cards.at(-1).y - live.cards.at(-2).y) < 1)
  report.push({ label: 'saved-toggle-immediate-layout', ...live })
  const guest = await (await request('/api/dashboard', 'GET', undefined, { Cookie: '' })).json()
  assert.ok(
    guest.modules.filter((m) => m.kind === 'login_required').every((m) => !('snapshot' in m)),
  )
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(resolve(evidence, 'measurements.json'), JSON.stringify(report, null, 2))
}

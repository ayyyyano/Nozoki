import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { launch, settle } from './support.mjs'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
const origin = 'http://127.0.0.1:8796',
  out = '.wrangler/test-results/phase-07-schedule'
const credentials = JSON.parse(await readFile('.wrangler/schedule-ui/credentials.json', 'utf8'))
await mkdir(out, { recursive: true })
const browser = await launch(),
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  }),
  page = await context.newPage()
await page.clock.setFixedTime(new Date('2026-10-26T18:45:00+08:00'))
const report = { checks: [], errors: [], layout: [], upstreamRequests: [] }
const attach = (p) => {
  p.on('pageerror', (e) => report.errors.push(e.message))
  p.on('console', (m) => {
    if (
      /hydration.*mismatch|Unhandled error during execution|Failed to resolve component/.test(
        m.text(),
      )
    )
      report.errors.push(m.text())
  })
  p.on('request', (r) => {
    if (new URL(r.url()).protocol.startsWith('http') && new URL(r.url()).hostname !== '127.0.0.1')
      report.upstreamRequests.push(r.url())
  })
}
attach(page)
const field = (label, p = page) => p.getByLabel(label, { exact: true }).last()
const config = async () => {
  const r = await context.request.get(origin + '/api/admin/config')
  assert.equal(r.status(), 200)
  return r.json()
}
async function check(name, fn) {
  await fn()
  report.checks.push(name)
  console.log('PASS ' + name)
}
async function section(label, p = page) {
  const trigger = p.getByRole('button', { name: '选择管理分区', exact: true })
  if (await trigger.isVisible()) {
    await trigger.click()
    await p
      .getByRole('dialog', { name: '选择管理分区', exact: true })
      .getByRole('button', { name: label, exact: true })
      .click()
    await p.getByRole('dialog', { name: '选择管理分区', exact: true }).waitFor({ state: 'hidden' })
  } else
    await p
      .getByRole('navigation', { name: '管理分区', exact: true })
      .getByRole('button', { name: label, exact: true })
      .click()
}
async function choose(label, value, p = page) {
  await field(label, p).click()
  await p.locator('.var-menu__menu:visible .var-option').filter({ hasText: value }).click()
}
async function save(p = page) {
  const response = p.waitForResponse(
    (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
  )
  await p.getByRole('button', { name: '保存配置', exact: true }).click()
  assert.equal((await response).status(), 200)
  await p.getByText('已保存并确认持久化', { exact: true }).waitFor()
}
async function noOverflow(p, label) {
  const d = await p.evaluate(() => ({
    width: innerWidth,
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  assert.ok(d.scroll <= d.client, JSON.stringify(d))
  report.layout.push({ label, ...d })
}
async function shot(p, name) {
  if (await p.getByText('已保存并确认持久化', { exact: true }).isVisible())
    await p.locator('.admin-feedback-toast').waitFor({ state: 'hidden', timeout: 6000 })
  const style = await p.addStyleTag({
    content:
      'body::after{content:"离线日程夹具 · 隔离 D1 · 2026-10-26";position:fixed;bottom:4px;left:4px;z-index:2147483647;pointer-events:none;background:#222;color:white;font:11px sans-serif;padding:4px;max-width:calc(100vw - 16px)}',
  })
  await p.screenshot({ path: out + '/' + name, fullPage: true })
  await style.evaluate((e) => e.remove())
}
let guest, home
try {
  await check(
    'guest cannot read or change schedule; legacy editor remains equivalent',
    async () => {
      assert.equal((await context.request.get(origin + '/api/admin/config')).status(), 401)
      assert.equal(
        (
          await context.request.put(origin + '/api/admin/config', {
            headers: { Origin: origin },
            data: {},
          })
        ).status(),
        401,
      )
      await page.goto(origin + '/login')
      await settle(page)
      await field('邮箱').fill(credentials.email)
      await field('密码').fill(credentials.password)
      await page.getByRole('button', { name: '登录', exact: true }).click()
      await page.waitForURL('**/admin')
      await field('站点名称').waitFor()
      const baseline = await config(),
        fixture = editableConfig(baseline)
      fixture.site.schedule = createDefaultConfig().site.schedule
      fixture.site.timezone = fixture.site.schedule.timezone
      const module = fixture.modules.find((m) => m.id === 'activity')
      module.enabled = true
      module.visibility = 'public'
      module.fields = {}
      const token = await (await context.request.get(origin + '/api/auth/csrf')).json()
      const reset = await context.request.put(origin + '/api/admin/config', {
        headers: {
          Origin: origin,
          'X-Nozoki-CSRF': token.token,
          'Idempotency-Key': crypto.randomUUID(),
        },
        data: { expectedVersion: baseline.site.configVersion, config: fixture },
      })
      assert.equal(reset.status(), 200)
      await page.reload()
      await field('站点名称').waitFor()
      await section('日程安排')
      assert.equal((await config()).site.schedule.start, await field('上班时间 HH:mm').inputValue())
      await page.locator('[data-schedule-preview-state]').filter({ hasText: '下班啦' }).waitFor()
      await shot(page, 'legacy-preview-1440.png')
    },
  )
  await check(
    'create Monday multi-period schedule, retain days, copy and protect referenced templates',
    async () => {
      await choose('日程编辑模式', '自定义周计划')
      await choose('周一安排类型', '独立时段')
      while (await page.getByRole('button', { name: '删除周一时段 1', exact: true }).count())
        await page.getByRole('button', { name: '删除周一时段 1', exact: true }).click()
      for (const [i, name, start, end, category] of [
        [1, '晚自习', '18:30', '19:00', '活动'],
        [2, '课间休息', '19:00', '19:10', '休息'],
        [3, '晚课', '19:10', '20:40', '活动'],
      ]) {
        await page.getByRole('button', { name: '添加周一时段', exact: true }).click()
        await field(`周一时段 ${i} 名称`).fill(name)
        await field(`周一时段 ${i} 开始 HH:mm`).fill(start)
        await field(`周一时段 ${i} 结束 HH:mm`).fill(end)
        if (category === '休息') await choose(`周一时段 ${i} 类别`, category)
      }
      await page.locator('[data-schedule-preview-state]').filter({ hasText: '晚自习' }).waitFor()
      await page.getByRole('button', { name: '周二', exact: true }).click()
      await page.getByRole('button', { name: '周三', exact: true }).click()
      await choose('周三安排类型', '独立时段')
      await field('周三时段 1 名称').fill('复制前隐藏草稿')
      await choose('周三安排类型', '引用模板')
      await page.getByRole('button', { name: '周一', exact: true }).click()
      assert.equal(await field('周一时段 3 名称').inputValue(), '晚课')
      await choose('复制到星期', '周三')
      await page.getByRole('button', { name: '复制当天安排', exact: true }).click()
      await page.getByRole('button', { name: '周三', exact: true }).click()
      assert.equal(await field('周三时段 3 名称').inputValue(), '晚课')
      await choose('周三安排类型', '引用模板')
      await choose('周三安排类型', '独立时段')
      assert.equal(await field('周三时段 1 名称').inputValue(), '晚自习')
      await page.getByRole('button', { name: '周一', exact: true }).click()
      await page.locator('summary').getByText('日程模板', { exact: true }).click()
      await page.getByRole('button', { name: '添加模板', exact: true }).click()
      await field('模板名称').fill('周末学习')
      await page.getByRole('button', { name: '添加模板时段', exact: true }).click()
      await page.getByRole('button', { name: '周六', exact: true }).click()
      await choose('周六安排类型', '引用模板')
      await choose('星期模板', '周末学习')
      await page.getByRole('button', { name: '删除模板', exact: true }).click()
      await page
        .getByText('该模板仍被星期规则或日期例外引用，请先更换引用。', { exact: true })
        .waitFor()
      await page.getByRole('button', { name: '周一', exact: true }).click()
      await choose('日程编辑模式', '基础模式')
      await page
        .getByText('当前自定义安排无法无损转换为基础模式，已保留全部草稿。', { exact: true })
        .waitFor()
      assert.equal(await field('周一时段 3 名称').inputValue(), '晚课')
      await save()
      const c = await config()
      assert.equal(c.site.schedule.version, 2)
      assert.equal(c.site.schedule.weekdays['1'].slots.length, 3)
      assert.equal(c.site.schedule.weekdays['3'].slots[2].name, '晚课')
      await noOverflow(page, 'admin-1440')
      await shot(page, 'weekly-editor-1440.png')
    },
  )
  await check('reopened admin restores the persisted weekly draft and the preview', async () => {
    const reopened = await context.newPage()
    attach(reopened)
    await reopened.clock.setFixedTime(new Date('2026-10-26T18:45:00+08:00'))
    await reopened.goto(origin + '/admin')
    await field('站点名称', reopened).waitFor()
    await section('日程安排', reopened)
    assert.equal(await field('周一时段 1 名称', reopened).inputValue(), '晚自习')
    await reopened.locator('[data-schedule-preview-state]').filter({ hasText: '晚自习' }).waitFor()
    await reopened.close()
  })
  await check(
    'guest Dashboard uses the same evening plan and switches at exact half-open boundaries',
    async () => {
      guest = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark',
      })
      home = await guest.newPage()
      attach(home)
      await home.clock.setFixedTime(new Date('2026-10-26T18:45:00+08:00'))
      await home.goto(origin)
      await settle(home)
      await home
        .locator('[data-module="activity"] .activity-headline strong')
        .filter({ hasText: '晚自习' })
        .waitFor()
      assert.equal(
        await home.locator('[data-module="activity"] .countdown').textContent(),
        '00:15:00',
      )
      await shot(home, 'dashboard-evening-1440.png')
      await home.clock.setFixedTime(new Date('2026-10-26T19:00:00+08:00'))
      await home
        .locator('[data-module="activity"] .activity-headline[data-schedule-state="break"]')
        .waitFor()
      assert.equal(
        await home.locator('[data-module="activity"] .activity-headline strong').textContent(),
        '课间休息',
      )
      await home.clock.setFixedTime(new Date('2026-10-26T19:10:00+08:00'))
      await home
        .locator('[data-module="activity"] .activity-headline strong')
        .filter({ hasText: '晚课' })
        .waitFor()
    },
  )
  await check(
    'a date exception overrides the weekly plan; rest hides progress and custom periods are restored',
    async () => {
      await page.locator('summary').getByText('手动日程例外', { exact: true }).click()
      await field('例外日期 YYYY-MM-DD').fill('2026-10-26')
      await field('例外名称').fill('测试日期例外')
      await page.getByRole('button', { name: '添加或更新日程例外', exact: true }).click()
      await save()
      await home.reload()
      await settle(home)
      await home
        .locator('[data-module="activity"] .activity-headline strong')
        .filter({ hasText: '今日休息' })
        .waitFor()
      assert.equal(await home.locator('[data-module="activity"] .var-progress').count(), 0)
      await choose('例外安排类型', '替换当天时段')
      await page.getByRole('button', { name: '添加例外时段', exact: true }).click()
      await field('例外时段 1 名称').fill('临时课程')
      await field('例外时段 1 开始 HH:mm').fill('18:00')
      await field('例外时段 1 结束 HH:mm').fill('22:00')
      await save()
      await home.reload()
      await settle(home)
      await home
        .locator('[data-module="activity"] .activity-headline strong')
        .filter({ hasText: '临时课程' })
        .waitFor()
      await page.getByRole('button', { name: '删除例外 2026-10-26', exact: true }).click()
      await save()
    },
  )
  await check('timezone changes persist and reevaluate both preview and Dashboard', async () => {
    await field('IANA 时区').fill('America/New_York')
    await page.locator('[data-schedule-preview-state]').filter({ hasText: '等待安排' }).waitFor()
    await save()
    assert.equal((await config()).site.timezone, 'America/New_York')
    await home.reload()
    await settle(home)
    await home
      .locator('[data-module="activity"] .activity-headline strong')
      .filter({ hasText: '等待安排' })
      .waitFor()
    assert.ok(
      (await home.locator('[data-module="activity"] .scope-note').allTextContents())
        .join(' ')
        .includes('America/New_York'),
    )
    await field('IANA 时区').fill('Asia/Shanghai')
    await save()
    await home.reload()
    await settle(home)
    await home
      .locator('[data-module="activity"] .activity-headline strong')
      .filter({ hasText: '晚课' })
      .waitFor()
  })
  await check('explicit next-day setting preserves a period across midnight', async () => {
    await page.getByRole('button', { name: '添加周一时段', exact: true }).click()
    await field('周一时段 4 名称').fill('夜间学习')
    await field('周一时段 4 开始 HH:mm').fill('22:00')
    await field('周一时段 4 结束 HH:mm').fill('02:00')
    await choose('周一时段 4 结束日期', '次日')
    await save()
    await home.clock.setFixedTime(new Date('2026-10-26T23:59:59+08:00'))
    await home.reload()
    await settle(home)
    await home
      .locator('[data-module="activity"] .activity-headline strong')
      .filter({ hasText: '夜间学习' })
      .waitFor()
    const id = await home.locator('.activity-headline').getAttribute('data-period-id')
    await home.clock.setFixedTime(new Date('2026-10-27T00:00:00+08:00'))
    await home.waitForTimeout(1200)
    assert.equal(await home.locator('.activity-headline').getAttribute('data-period-id'), id)
    assert.equal(await home.locator('.activity-headline strong').textContent(), '夜间学习')
    await shot(home, 'dashboard-midnight.png')
    await page.getByRole('button', { name: '删除周一时段 4', exact: true }).click()
    await save()
    await home.clock.setFixedTime(new Date('2026-10-26T19:10:00+08:00'))
    await home.reload()
    await settle(home)
  })
  await check(
    'lost V2 save response retries the same idempotent request without a second version increment',
    async () => {
      const before = (await config()).site.configVersion,
        keys = []
      let first = true
      await page.route('**/api/admin/config', async (route) => {
        if (route.request().method() === 'PUT') {
          keys.push(route.request().headers()['idempotency-key'])
          if (first) {
            first = false
            const response = await route.fetch()
            assert.equal(response.status(), 200)
            return route.abort('failed')
          }
        }
        return route.continue()
      })
      await field('周一时段 1 名称').fill('幂等重试自习')
      await page.getByRole('button', { name: '保存配置', exact: true }).click()
      await page
        .getByText('未能确认保存结果。草稿已保留；原样重试会复用请求标识。', { exact: true })
        .waitFor()
      assert.equal((await config()).site.configVersion, before + 1)
      await save()
      assert.equal((await config()).site.configVersion, before + 1)
      assert.equal(keys[0], keys[1])
      await page.unroute('**/api/admin/config')
      await field('周一时段 1 名称').fill('晚自习')
      await save()
    },
  )
  await check(
    'mobile day switching keeps drafts; discard and actual save remain usable without overflow',
    async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      await field('周一时段 1 名称').fill('移动端草稿')
      await page.getByRole('button', { name: '周二', exact: true }).click()
      await choose('周二安排类型', '独立时段')
      await field('周二时段 1 名称').fill('隐藏草稿')
      await choose('周二安排类型', '引用模板')
      await page.getByRole('button', { name: '周一', exact: true }).click()
      assert.equal(await field('周一时段 1 名称').inputValue(), '移动端草稿')
      await page.getByRole('button', { name: '更多管理操作', exact: true }).click()
      await page.getByRole('menuitem', { name: '放弃修改', exact: true }).click()
      await page.getByRole('button', { name: '确认放弃', exact: true }).click()
      assert.equal(await field('周一时段 1 名称').inputValue(), '晚自习')
      await page.getByRole('button', { name: '周二', exact: true }).click()
      await choose('周二安排类型', '独立时段')
      assert.equal(await field('周二时段 1 名称').inputValue(), '工作中')
      await choose('周二安排类型', '引用模板')
      await page.getByRole('button', { name: '周一', exact: true }).click()
      await field('周一时段 1 名称').fill('移动端保存')
      await save()
      assert.equal((await config()).site.schedule.weekdays['1'].slots[0].name, '移动端保存')
      await field('周一时段 1 名称').fill('晚自习')
      await save()
      await noOverflow(page, 'admin-390')
      await shot(page, 'weekly-editor-390.png')
      await page.setViewportSize({ width: 320, height: 844 })
      await noOverflow(page, 'admin-320')
      await shot(page, 'weekly-editor-320.png')
      await home.setViewportSize({ width: 390, height: 844 })
      await home.reload()
      await settle(home)
      await noOverflow(home, 'home-390')
      await shot(home, 'dashboard-evening-390.png')
    },
  )
  await check('custom schedule CAS conflicts preserve the second window draft', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const other = await context.newPage()
    attach(other)
    await other.goto(origin + '/admin')
    await field('站点名称', other).waitFor()
    await section('日程安排', other)
    await field('周一时段 1 名称', other).fill('第二窗口草稿')
    await field('周一时段 1 名称').fill('第一窗口保存')
    await save()
    const response = other.waitForResponse(
      (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
    )
    await other.getByRole('button', { name: '保存配置', exact: true }).click()
    assert.equal((await response).status(), 409)
    assert.equal(await field('周一时段 1 名称', other).inputValue(), '第二窗口草稿')
    await shot(other, 'schedule-cas-conflict.png')
    await other.close()
  })
  await check(
    'Activity disabled removes schedule only; authentication and other modules stay intact',
    async () => {
      const before = (
        await (await guest.request.get(origin + '/api/dashboard')).json()
      ).modules.map((m) => m.id)
      await section('Dashboard 模块')
      const row = page.locator('[data-edit-module="activity"]')
      await row.locator('.admin-item-toggle').click()
      await field('启用 activity').click()
      await save()
      await home.reload()
      await settle(home)
      assert.equal(await home.locator('[data-module="activity"]').count(), 0)
      const after = (await (await guest.request.get(origin + '/api/dashboard')).json()).modules.map(
        (m) => m.id,
      )
      assert.deepEqual(
        after,
        before.filter((id) => id !== 'activity'),
      )
      assert.equal(
        (
          await guest.request.put(origin + '/api/admin/config', {
            headers: { Origin: origin },
            data: {},
          })
        ).status(),
        401,
      )
    },
  )
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.upstreamRequests, [])
  report.result = 'PASS'
} finally {
  await writeFile(out + '/browser.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}

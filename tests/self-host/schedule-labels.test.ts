import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { SqliteDatabase } from '../../platform/node/sqlite.mjs'
import { migrateDatabase } from '../../platform/node/migrations.mjs'

test(
  'schedule state text edits, mode conversion, save/reload and Activity use the same labels',
  { timeout: 120000, skip: process.env.NOZOKI_TEST_BROWSER !== '1' },
  async (t) => {
    const { launch, settle, select } = await import('../browser/support.ts')
    const { expect } = await import('playwright/test')
    const directory = await mkdtemp(resolve('.wrangler/schedule-labels-ui-'))
    const dbPath = resolve(directory, 'test.sqlite'),
      db = new SqliteDatabase(dbPath)
    await migrateDatabase(db, 'migrations', resolve(directory, 'backups'))
    await db.prepare('UPDATE integrations SET enabled=0').run()
    db.close()
    const socket = createServer()
    await new Promise((r) => socket.listen(0, '127.0.0.1', r))
    const port = socket.address().port
    await new Promise((r) => socket.close(r))
    const origin = `http://127.0.0.1:${port}`,
      password = 'Fixture-' + crypto.randomUUID()
    const child = spawn(process.execPath, [resolve('.output-node/start.mjs')], {
      env: {
        SYSTEMROOT: process.env.SYSTEMROOT,
        PATH: process.env.PATH,
        HOST: '127.0.0.1',
        PORT: String(port),
        NOZOKI_SQLITE_PATH: dbPath,
        ADMIN_EMAIL: 'owner@example.invalid',
        ADMIN_PASSWORD: password,
        AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString('base64url'),
        AUTH_VERSION: '1',
        AUTH_ORIGIN: origin,
        AUTH_ALLOW_LOCAL_HTTP: '1',
        COLLECTOR_EPOCH: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '',
      browser
    child.stdout.on('data', (v) => {
      output += v
    })
    child.stderr.on('data', (v) => {
      output += v
    })
    t.after(async () => {
      if (browser) await browser.close()
      if (child.exitCode === null && child.signalCode === null) {
        const done = new Promise((r) => child.once('exit', r))
        child.kill('SIGTERM')
        await done
      }
    })
    for (let n = 0; !output.includes('Nozoki listening'); n++) {
      assert.ok(n < 400 && child.exitCode === null, 'Node server did not start: ' + output)
      await new Promise((r) => setTimeout(r, 50))
    }
    browser = await launch()
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }),
      page = await context.newPage(),
      errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.clock.setFixedTime(new Date('2026-10-26T01:00:00Z'))
    await page.goto(origin + '/login')
    await page.getByLabel('邮箱', { exact: true }).fill('owner@example.invalid')
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForURL('**/admin')
    await settle(page)
    const section = async () => {
      await page
        .getByRole('navigation', { name: '管理分区', exact: true })
        .getByRole('button', { name: '主页模块', exact: true })
        .click()
      await page.locator('[data-edit-module="activity"] .admin-item-toggle').click()
    }
    const field = (label) => page.getByLabel(label, { exact: true }).last()
    const labelsButton = page.getByRole('button', { name: '自定义状态文案', exact: true })
    const labelsDialog = page.getByRole('dialog', { name: '自定义状态文案', exact: true })
    const labelField = (name) => labelsDialog.getByRole('textbox', { name, exact: true })
    const openLabels = async () => {
      await labelsButton.click()
      await expect(labelsDialog).toBeVisible()
    }
    const closeLabels = async (name) => {
      await labelsDialog.getByRole('button', { name, exact: true }).click()
      await expect(labelsDialog).toBeHidden()
    }
    const save = async () => {
      const response = page.waitForResponse(
        (r) => r.url().endsWith('/api/admin/config') && r.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: '保存配置', exact: true }).click()
      assert.equal((await response).status(), 200)
      await page.getByText('已保存并确认持久化', { exact: true }).waitFor()
    }
    const preview = page.locator('[data-schedule-preview-state]')
    await section()
    await openLabels()
    await labelField('活动状态文字').fill('专注中')
    await labelField('休息时段状态文字').fill('午间休息')
    await labelField('开始前状态文字').fill('准备中')
    await closeLabels('应用')
    await field('预览日期 YYYY-MM-DD').fill('2026-10-26')
    await field('预览时间 HH:mm').fill('09:00')
    await expect(preview).toHaveText('专注中')
    await field('预览时间 HH:mm').fill('12:00')
    await expect(preview).toHaveText('午间休息')
    await select(page, '日程编辑模式', '自定义周计划')
    await openLabels()
    await expect(labelField('活动状态文字')).toHaveValue('专注中')
    await closeLabels('取消')
    await select(page, '日程编辑模式', '基础模式')
    await openLabels()
    await expect(labelField('休息时段状态文字')).toHaveValue('午间休息')
    await closeLabels('取消')
    await save()
    await page.reload()
    await section()
    await openLabels()
    await expect(labelField('活动状态文字')).toHaveValue('专注中')
    await closeLabels('取消')
    await page.goto(origin + '/')
    await settle(page)
    await expect(page.locator('.activity-headline strong')).toHaveText('专注中')
    await page.clock.setFixedTime(new Date('2026-10-26T04:00:00Z'))
    await expect(page.locator('.activity-headline strong')).toHaveText('午间休息')
    await page.clock.setFixedTime(new Date('2026-10-26T01:00:00Z'))
    await page.goto(origin + '/admin')
    await section()
    await select(page, '日程编辑模式', '自定义周计划')
    await page.getByText('日程模板', { exact: true }).click()
    await select(page, '编辑模板', '工作日')
    const override = field('模板时段 1 状态文字（可选）')
    await override.fill('读书中')
    await expect(preview).toHaveText('读书中')
    await override.fill('')
    await expect(preview).toHaveText('专注中')
    await override.fill('读书中')
    await save()
    await page.reload()
    await section()
    await expect(field('日程编辑模式')).toContainText('自定义周计划')
    await page.goto(origin + '/')
    await settle(page)
    await expect(page.locator('.activity-headline strong')).toHaveText('读书中')
    await page.goto(origin + '/admin')
    await section()
    await openLabels()
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await labelField('活动状态文字').fill('窄屏编辑中')
      const bounds = await labelsDialog.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    }
    await page.keyboard.press('Escape')
    await expect(labelsButton).toBeFocused()
    assert.deepEqual(errors, [])
    await context.close()
  },
)

// Isolated migrated D1 / real Worker / synthetic image only. No production state.
import assert from 'node:assert/strict'
import { expect } from 'playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { backgroundFixture } from '../fixtures/background.ts'
import {
  backgroundImageHash,
  decodeBackgroundImage,
} from '../../shared/contracts/background-image.ts'

export async function exerciseSharedBackground(
  page,
  { browser, origin, input, request, save, db, evidence },
) {
  await mkdir(evidence, { recursive: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const initial = await input()
  const hash = await backgroundImageHash(decodeBackgroundImage(backgroundFixture))
  const path = '/api/background/' + hash
  const upload = structuredClone(initial)
  upload.backgroundUpload = backgroundFixture
  upload.config.site.background.source = 'uploaded'
  upload.config.site.background.url = path
  assert.equal(
    (
      await request('/api/admin/config', 'PUT', upload, {
        'Idempotency-Key': crypto.randomUUID(),
        'X-Nozoki-CSRF': '',
      })
    ).status,
    403,
  )
  const invalid = structuredClone(upload)
  invalid.backgroundUpload = btoa('<svg onload="evil()"/>')
  assert.equal((await save(invalid)).status, 400)
  assert.deepEqual(await input(), initial)
  const unknown = structuredClone(upload)
  delete unknown.backgroundUpload
  assert.equal((await save(unknown)).status, 400, 'An unpersisted image cannot be selected')
  const mismatch = structuredClone(upload)
  mismatch.config.site.background.url = '/api/background/' + '0'.repeat(64)
  assert.equal(
    (await save(mismatch)).status,
    400,
    'The URL must identify the exact submitted bytes',
  )
  // A later failure rolls back both image insertion and configuration changes.
  await db
    .prepare(
      "CREATE TRIGGER fixture_fail_background BEFORE INSERT ON site_background_images BEGIN SELECT RAISE(ABORT,'fixture'); END",
    )
    .run()
  assert.equal((await save(upload)).status, 503)
  assert.deepEqual(await input(), initial)
  assert.equal((await db.prepare('SELECT count(*) n FROM site_background_images').first()).n, 0)
  await db.prepare('DROP TRIGGER fixture_fail_background').run()
  const key = crypto.randomUUID()
  assert.equal((await save(upload, key)).status, 200)
  assert.equal((await (await save(upload, key)).json()).replayed, true)
  assert.equal((await save(upload)).status, 409)
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const response = await guest.request.get(origin + path)
  assert.equal(response.status(), 200)
  assert.equal(response.headers()['content-type'], 'image/webp')
  assert.equal(response.headers()['x-content-type-options'], 'nosniff')
  assert.deepEqual(await response.body(), Buffer.from(backgroundFixture, 'base64'))
  const dto = await (await guest.request.get(origin + '/api/dashboard')).json()
  assert.equal(dto.site.background.url, path)
  assert.ok(!JSON.stringify(dto).includes(backgroundFixture))
  await page.reload()
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 64
    const context = canvas.getContext('2d')
    context.fillStyle = '#6750a4'
    context.fillRect(8, 8, 112, 48)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.getByLabel('选择站点背景图片').setInputFiles({
    name: 'fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect(page.locator('.admin-background-thumbnail')).toHaveAttribute(
    'src',
    /^data:image\/webp;base64,/,
  )
  const beforeDraft = await input()
  assert.equal(beforeDraft.config.site.background.url, path, 'Choosing a file does not write D1')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.locator('.admin-background-thumbnail')).toHaveAttribute(
    'src',
    /^\/api\/background\//,
  )
  const after = await input()
  const savedUrl = after.config.site.background.url
  const visitor = await guest.newPage()
  await visitor.goto(origin)
  await expect(visitor.locator('.background-scene img')).toHaveAttribute('src', savedUrl)
  await expect(visitor.locator('.background-scene')).toHaveAttribute('data-background', 'loaded')
  await page.screenshot({ path: resolve(evidence, 'background-admin-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 320, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: resolve(evidence, 'background-admin-320.png'), fullPage: true })
  await page.getByRole('button', { name: '恢复内置背景', exact: true }).click()
  assert.equal((await input()).config.site.background.source, 'uploaded', 'Reset remains a draft')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect.poll(async () => (await input()).config.site.background.source).toBe('builtin')
  assert.equal((await db.prepare('SELECT count(*) n FROM site_background_images').first()).n, 0)
  assert.equal((await guest.request.get(origin + savedUrl)).status(), 404)
  await visitor.reload()
  await expect(visitor.locator('.background-scene img')).toHaveAttribute(
    'src',
    '/media/wallpaper-glass-picnic.webp',
  )
  await guest.close()
  assert.deepEqual(errors, [])
}

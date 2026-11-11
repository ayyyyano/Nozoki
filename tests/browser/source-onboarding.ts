// Synthetic upstreams and a disposable migrated D1 database are supplied by the harness.
import assert from 'node:assert/strict'
import { expect } from 'playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createIntegrationDraft } from '../../shared/integration-presets/index.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { bindSources } from '../../shared/integration-presets/bindings.ts'
import { saveConfig } from '../../server/services/config.ts'
import { settle } from './support.ts'

export async function exerciseSourceOnboarding(
  page,
  { origin, input, request, save, db, collector, evidence },
) {
  await mkdir(evidence, { recursive: true })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const section = async (name) => {
    const trigger = page.getByRole('button', { name: '选择管理分区', exact: true })
    if (await trigger.isVisible()) {
      await trigger.click()
      await page
        .getByRole('dialog', { name: '选择管理分区' })
        .getByRole('button', { name, exact: true })
        .click()
    } else await page.getByRole('button', { name, exact: true }).click()
  }
  const initial = await input()
  // HTTP clients must pass the same gate as the browser.
  const untested = createIntegrationDraft('sleepy', initial.config.integrations, 'fixture')
  untested.baseUrl = 'https://source.example.com/'
  untested.enabled = true
  untested.access.approved = true
  untested.access.approvedTarget = sourceTargetKey(untested, untested.access)
  const forged = {
    ...initial,
    config: bindSources({
      ...initial.config,
      integrations: [...initial.config.integrations, untested],
    }),
  }
  const denied = await save(forged)
  assert.equal(denied.status, 400)
  assert.equal((await denied.json()).reason, 'SOURCE_TEST_REQUIRED')
  assert.deepEqual(await input(), initial)
  const probePath = '/api/admin/integrations/sleepy/test'
  const probeInput = { expectedVersion: initial.expectedVersion, draft: untested, quoteSymbols: [] }
  assert.equal((await request(probePath, 'POST', probeInput, { 'X-Nozoki-CSRF': '' })).status, 403)
  for (const host of ['blocked', 'html', 'redirect']) {
    const bad = structuredClone(probeInput)
    bad.draft.baseUrl = `https://${host}.example.com/`
    bad.draft.access.approved = false
    bad.draft.access.approvedTarget = null
    const result = await (await request(probePath, 'POST', bad)).json()
    assert.equal(result.protocolMatched, false)
    assert.equal(result.connectionProof, undefined)
  }
  await section('数据源')
  const addSource = page.getByRole('button', { name: '添加来源', exact: true })
  const picker = page.getByRole('dialog', { name: '选择数据源类型' })
  for (const [provider, field, value, hint] of [
    ['Tailscale', 'OAuth Client ID', 'synthetic-client-id', 'devices:core:read'],
    ['CLIProxyAPI', '实例 HTTPS 地址', 'https://proxy.example.com/', 'Management Key'],
    ['DeepSeek', 'API Key', 'synthetic-key', 'DeepSeek 开放平台'],
  ]) {
    await addSource.click()
    await expect(picker.getByRole('button').filter({ hasText: 'Uptime Kuma' })).not.toContainText(
      '尚未完成真实实例兼容性验证',
    )
    await picker.getByRole('button').filter({ hasText: provider }).click()
    const configure = page.getByRole('dialog', { name: '配置 ' + provider, exact: true })
    const inputField = configure.getByLabel(field, { exact: true }).and(configure.locator('input'))
    await inputField.fill(value)
    const guideButton = configure.getByRole('button', { name: `查看 ${provider} 配置说明` })
    await guideButton.click()
    const guide = page.getByRole('dialog', { name: provider + ' 配置说明', exact: true })
    await expect(guide).toContainText(hint)
    await expect(guide.getByRole('link')).toHaveAttribute('target', '_blank')
    await page.keyboard.press('Escape')
    await expect(inputField).toHaveValue(value)
    await expect(guideButton).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(configure).toBeHidden()
  }
  assert.deepEqual(await input(), initial)
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await page
    .getByRole('dialog', { name: '选择数据源类型' })
    .getByRole('button')
    .filter({ hasText: 'Sleepy' })
    .click()
  const dialog = page.getByRole('dialog', { name: '配置 Sleepy', exact: true })
  await expect(dialog).toBeVisible()
  const add = dialog.getByRole('button', { name: '添加来源', exact: true })
  await expect(add).toBeDisabled()
  await expect(page.locator('.source-card')).toHaveCount(initial.config.integrations.length)
  await dialog
    .getByRole('textbox', { name: '实例 HTTPS 地址', exact: true })
    .fill('https://blocked.example.com/')
  await dialog.getByRole('button', { name: '测试并确认访问' }).click()
  await expect(dialog.locator('[data-test-status="error"]')).toBeVisible()
  await expect(add).toBeDisabled()
  await dialog
    .getByRole('textbox', { name: '实例 HTTPS 地址', exact: true })
    .fill('https://new-sleepy.example.com/')
  await dialog.getByRole('button', { name: '测试并确认访问' }).click()
  await expect(dialog.locator('[data-test-status="ok"]')).toBeVisible()
  await expect(add).toBeEnabled()
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  await dialog.screenshot({ path: resolve(evidence, 'tested-source-desktop.png') })
  await add.click()
  await expect(dialog).toBeHidden()
  assert.deepEqual(
    await input(),
    initial,
    'Adding a tested source still only edits the local draft',
  )
  await section('Dashboard 模块')
  const devices = page.locator('[data-edit-module="devices"]')
  await devices.locator('.admin-item-toggle').click()
  await expect(devices).toContainText('自动匹配：Sleepy')
  await expect(devices.getByText('数据源引用', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect
    .poll(async () => (await input()).config.integrations.some((i) => i.id === 'sleepy'))
    .toBe(true)
  await expect
    .poll(
      async () =>
        (
          await db
            .prepare(
              "SELECT count(*) n FROM integration_snapshot_views WHERE source_id='sleepy' AND module_id='devices'",
            )
            .first()
        ).n,
    )
    .toBe(1)
  const saved = await input()
  assert.equal(saved.config.modules.find((m) => m.id === 'devices').sources.main.sourceId, 'sleepy')
  assert.equal(saved.config.integrations.find((i) => i.id === 'sleepy').connectionProof, undefined)
  // Reusing a tested grant for a new address is rejected at save time.
  const changed = structuredClone(saved)
  const changedSource = changed.config.integrations.find((i) => i.id === 'sleepy')
  changedSource.baseUrl = 'https://changed-sleepy.example.com/'
  changedSource.access.approvedTarget = sourceTargetKey(changedSource, changedSource.access)
  assert.equal((await (await save(changed)).json()).reason, 'SOURCE_TEST_REQUIRED')
  await section('数据源')
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await expect(picker.getByRole('button').filter({ hasText: 'Sleepy' })).toBeDisabled()
  await expect(picker).toContainText('已添加')
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  const card = page.locator('[data-source-id="sleepy"]')
  if ((await card.locator('.admin-item-toggle').getAttribute('aria-expanded')) === 'false')
    await card.locator('.admin-item-toggle').click()
  await card
    .getByRole('textbox', { name: '实例 HTTPS 地址', exact: true })
    .fill('https://changed-sleepy.example.com/')
  await expect(card.getByRole('button', { name: '撤销访问批准' })).toHaveCount(0)
  await expect(card.locator('.source-test-result')).toHaveCount(0)
  await card.getByRole('button', { name: '测试并确认访问' }).click()
  await expect(card.locator('[data-test-status="ok"]')).toBeVisible()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect
    .poll(async () => (await input()).config.integrations.find((i) => i.id === 'sleepy').baseUrl)
    .toBe('https://changed-sleepy.example.com/')
  // Known types keep historical IDs and protected records when the new UI reads them.
  const legacy = await input()
  const flare = createIntegrationDraft('uptimeflare', legacy.config.integrations, 'fixture')
  flare.id = 'uptimeflare-56982f4b7bab'
  flare.baseUrl = 'https://flare.example.com/'
  flare.enabled = true
  flare.access.approved = true
  flare.access.approvedTarget = sourceTargetKey(flare, flare.access)
  legacy.config.integrations.push(flare)
  assert.equal((await saveConfig(db, legacy, { actor: { kind: 'system' } })).success, true)
  await collector.fetch(origin + '/collect')
  await page.reload()
  await settle(page)
  await section('数据源')
  await expect(page.locator('.source-manager')).not.toContainText('56982f4b7bab')
  await page.screenshot({ path: resolve(evidence, 'sources-desktop.png'), fullPage: true })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: '添加来源', exact: true }).click()
    const pick = page.getByRole('dialog', { name: '选择数据源类型' })
    await pick.getByRole('button').filter({ hasText: 'Uptime Kuma' }).click()
    const configure = page.getByRole('dialog', { name: '配置 Uptime Kuma' })
    await expect(configure).toBeVisible()
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running'),
    )
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: resolve(evidence, `source-dialog-${width}.png`), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(configure).toBeHidden()
    await expect(page.locator('[data-source-id="kuma"]')).toHaveCount(0)
  }
  // Separate this scenario from the earlier deliberate failed attempts.
  await db.prepare('DELETE FROM login_limits').run()
  // Both monitor types are added independently and feed one module without manual references.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await page
    .getByRole('dialog', { name: '选择数据源类型' })
    .getByRole('button')
    .filter({ hasText: 'Uptime Kuma' })
    .click()
  const kumaDialog = page.getByRole('dialog', { name: '配置 Uptime Kuma' })
  await kumaDialog
    .getByRole('textbox', { name: '实例 HTTPS 地址', exact: true })
    .fill('https://kuma.example.com/')
  await kumaDialog.getByRole('textbox', { name: '状态页标识（slug）', exact: true }).fill('public')
  await kumaDialog.getByRole('button', { name: '测试并确认访问' }).click()
  await expect(kumaDialog.locator('[data-test-status="ok"]')).toBeVisible()
  await kumaDialog.getByRole('button', { name: '添加来源', exact: true }).click()
  await expect(kumaDialog).toBeHidden()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect
    .poll(
      async () =>
        (
          await db
            .prepare("SELECT count(*) n FROM integration_snapshot_views WHERE module_id='services'")
            .first()
        ).n,
    )
    .toBe(2)
  const dashboard = await (await request('/api/dashboard')).json()
  const combined = dashboard.modules.find((m) => m.id === 'services').snapshot
  assert.ok(combined.data.monitors.some((m) => m.id.startsWith('kuma/')))
  assert.ok(combined.data.monitors.some((m) => m.id.startsWith('uptimeflare-56982f4b7bab/')))
  await db
    .prepare(
      "UPDATE collection_state SET status='error',error_code='UPSTREAM_UNAVAILABLE' WHERE source_id='kuma'",
    )
    .run()
  const partial = (await (await request('/api/dashboard')).json()).modules.find(
    (m) => m.id === 'services',
  ).snapshot
  assert.equal(partial.partialFailures, 1)
  assert.ok(partial.data.monitors.some((m) => m.id.startsWith('uptimeflare-56982f4b7bab/')))
  assert.deepEqual(errors, [])
}

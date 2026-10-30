import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
export const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Local previews only')
export const production = process.env.CHECK_PRODUCTION === '1'
export const evidence = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.1'
await mkdir(evidence, { recursive: true })
export async function launch() {
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  return chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : existsSync(edge)
        ? { executablePath: edge }
        : {}),
  })
}
export async function select(page, name, value) {
  await page.getByLabel(name, { exact: true }).click()
  await page.locator('.var-menu__menu:visible .var-option').filter({ hasText: value }).click()
}
export async function settings(page) {
  await page.getByRole('button', { name: '外观偏好', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '外观偏好', exact: true })
  await dialog.waitFor()
  return dialog
}
export async function settle(page) {
  await page.locator('[data-theme-ready="true"]').waitFor()
  await page.waitForFunction(() => !document.querySelector('.dx-transition'))
}
export async function geometry(page) {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    columns: getComputedStyle(document.querySelector('.dashboard-grid')).gridTemplateColumns.split(
      ' ',
    ).length,
    cards: [...document.querySelectorAll('[data-module]')].map((e) => {
      const r = e.getBoundingClientRect(),
        s = getComputedStyle(e)
      return {
        id: e.dataset.module,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
        clientWidth: e.clientWidth,
        scrollWidth: e.scrollWidth,
        border: s.borderTopColor,
      }
    }),
  }))
  assert.ok(result.scrollWidth <= result.width, JSON.stringify(result))
  for (const c of result.cards) {
    assert.ok(
      c.x >= 0 && c.right <= result.width + 1 && c.scrollWidth <= c.clientWidth + 1,
      JSON.stringify(c),
    )
    if (c.id !== 'links') assert.notEqual(c.border, 'rgb(0, 0, 0)')
  }
  return result
}

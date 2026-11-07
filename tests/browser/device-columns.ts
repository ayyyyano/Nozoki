// Offline display fixtures only; no device data is saved to D1.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect } from 'playwright/test'
import { fixture, fixed } from '../fixtures/layout.ts'
import { settle } from './support.ts'
import { stable } from './layout-support.ts'

export async function exerciseDeviceColumns(page, { origin, evidence }) {
  await mkdir(evidence, { recursive: true })
  const errors = [],
    measurements = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.clock.setFixedTime(fixed)
  let current
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: current }))
  for (const [width, count] of [
    [1440, 4],
    [1280, 4],
    [1024, 4],
    [768, 4],
    [600, 4],
    [390, 4],
    [320, 4],
    [320, 1],
    [320, 5],
  ]) {
    current = await fixture({ devices: count, stale: true })
    const devices = current.modules.find((m) => m.id === 'devices').snapshot.data.devices
    devices[0].name = 'Fixture-iPhone-very-long-device-name-for-layout'
    devices[0].stateText = 'Fixture status with a long application name'
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin)
    await settle(page)
    const refreshed = page.waitForResponse((r) => r.url().endsWith('/api/dashboard'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await refreshed
    await stable(page)
    await expect(page.locator('.device-row')).toHaveCount(count)
    const geometry = await page.evaluate(() => {
      const box = (e) => {
        const r = e.getBoundingClientRect()
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
          client: e.clientWidth,
          scroll: e.scrollWidth,
        }
      }
      const list = document.querySelector('.device-list')
      return {
        viewport: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
        list: box(list),
        card: box(document.querySelector('[data-module="devices"]')),
        rows: [...document.querySelectorAll('.device-row')].map((e) => ({
          id: e.dataset.deviceId,
          ...box(e),
        })),
        copy: [...document.querySelectorAll('.device-copy')].map(box),
      }
    })
    assert.equal(geometry.columns, 2, JSON.stringify(geometry))
    assert.ok(geometry.pageWidth <= width, JSON.stringify(geometry))
    for (const row of [...geometry.rows, ...geometry.copy]) {
      assert.ok(row.scroll <= row.client + 1, JSON.stringify(row))
      assert.ok(row.right <= geometry.list.right + 1, JSON.stringify(row))
    }
    assert.deepEqual(
      geometry.rows.map((r) => r.id),
      devices.map((d) => d.id),
    )
    for (let i = 0; i + 1 < count; i += 2) {
      assert.ok(Math.abs(geometry.rows[i].y - geometry.rows[i + 1].y) < 1)
      assert.ok(geometry.rows[i].right < geometry.rows[i + 1].x)
    }
    for (let i = 2; i < count; i++) assert.ok(geometry.rows[i].y >= geometry.rows[i - 2].bottom)
    measurements.push({ count, ...geometry })
    if ([1440, 768, 320].includes(width) && count === 4)
      await page
        .locator('[data-module="devices"]')
        .screenshot({ path: resolve(evidence, `device-columns-${width}.png`) })
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(evidence, 'device-columns.json'), JSON.stringify(measurements, null, 2))
}

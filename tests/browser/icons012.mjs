import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { launch, baseURL, production, settle, settings } from './support.mjs'
const evidence = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.2'
await mkdir(evidence, { recursive: true })
const browser = await launch(),
  result = { baseURL, production, icons: [], requests: [] }
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  p.on('request', (r) => {
    if (r.url().includes('fonts.google')) result.requests.push(r.url())
  })
  await p.goto(baseURL)
  await settle(p)
  await settings(p)
  result.icons = await p.locator('.app-icon:visible').evaluateAll((icons) =>
    icons.map((e) => ({
      symbol: e.dataset.symbol,
      size: e.getAttribute('width'),
      hidden: e.getAttribute('aria-hidden'),
      pathCount: e.querySelectorAll('path').length,
      bounds: (() => {
        const r = e.getBBox()
        return { width: r.width, height: r.height }
      })(),
    })),
  )
  for (const icon of result.icons) {
    assert.equal(icon.hidden, 'true')
    assert.ok(icon.pathCount > 0)
    assert.ok(icon.bounds.width > 0 && icon.bounds.height > 0)
  }
  assert.ok(result.icons.some((i) => i.size === '24'))
  assert.ok(result.icons.some((i) => i.size === '20'))
  assert.equal(
    await p.getByRole('button', { name: '经典紫', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  await p.getByRole('button', { name: '完成', exact: true }).click()
  await p.getByRole('dialog').waitFor({ state: 'hidden' })
  await p.getByRole('button', { name: '显示纯壁纸' }).click()
  assert.equal(await p.locator('.page-actions .app-icon:visible').getAttribute('data-fill'), '1')
  assert.equal(
    await p.locator('.page-actions .app-icon:visible').getAttribute('data-symbol'),
    'visibility_off',
  )
  assert.deepEqual(result.requests, [])
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  await writeFile(
    `${evidence}/icons-${production ? 'production' : 'dev'}.json`,
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
console.log(JSON.stringify({ icons: result.icons.length, failure: result.failure }))

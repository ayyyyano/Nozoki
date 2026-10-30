import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { launch, baseURL, settle } from './support.mjs'
await mkdir(process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.3', { recursive: true })
const file = 'app/components/common/DxTransition.vue'
const original = await readFile(file, 'utf8')
const modified = original.replace(
  'const props =',
  '// phase-01.3 temporary script HMR probe\nconst props =',
)
const browser = await launch()
const result = { baseURL }
try {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    window.__hmrRuns = 0
    let previous = ''
    new MutationObserver(() => {
      const phase = document.querySelector('.dx-transition')?.dataset.phase
      if (phase === 'entering' && previous !== phase) window.__hmrRuns++
      previous = phase
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-phase'],
    })
  })
  await page.goto(baseURL)
  await settle(page)
  const before = await page.evaluate(() => ({
    runs: window.__hmrRuns,
    origin: performance.timeOrigin,
  }))
  assert.ok(before.runs === 0 || before.runs === 1)
  const updated = page.waitForEvent('console', {
    predicate: (msg) => /hot updated.*DxTransition/.test(msg.text()),
    timeout: 15000,
  })
  if ((await readFile(file, 'utf8')) !== original)
    throw new Error('Source changed before HMR probe')
  await writeFile(file, modified)
  result.hmrMessage = (await updated).text()
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => ({
    runs: window.__hmrRuns,
    origin: performance.timeOrigin,
  }))
  assert.deepEqual(after, before)
  assert.equal(await page.locator('.dx-transition').count(), 0)
  result.before = before
  result.after = after
} catch (e) {
  result.failure = e.stack
  process.exitCode = 1
} finally {
  if ((await readFile(file, 'utf8')) === modified) await writeFile(file, original)
  else if ((await readFile(file, 'utf8')) !== original)
    result.restore = 'User changes preserved; temporary probe not blindly overwritten'
  await browser.close()
  await writeFile(
    `${process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-01.3'}/hmr.json`,
    JSON.stringify(result, null, 2),
  )
}
console.log(result)

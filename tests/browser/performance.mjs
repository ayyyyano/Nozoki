import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { launch, baseURL, production, evidence, select, settings, settle } from './support.mjs'
assert.equal(production, false, 'A/B uses dense development fixtures only')
await mkdir(evidence, { recursive: true })
const browser = await launch()
const result = {
  engine: browser.version(),
  headless: true,
  viewport: { width: 1440, height: 900 },
  notes:
    'Local Edge, dense six-device/six-monitor fixture, same cached static image, dark M3. rAF timing and Chromium CPU metrics measure this run; no physical-GPU, battery or field-performance claim.',
  cases: [],
}
try {
  const browserSession = await browser.newBrowserCDPSession()
  const system = await browserSession.send('SystemInfo.getInfo')
  result.gpu = system.gpu.devices
  result.driver = system.gpu.auxAttributes?.glRenderer
  const page = await browser.newPage({ viewport: result.viewport, colorScheme: 'dark' })
  await page.goto(baseURL)
  await settle(page)
  await page.locator('.fixture-preview summary').click()
  await select(page, '开发数据场景', 'edge')
  await page.locator('.fixture-preview summary').click()
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  for (const [opacity, blur] of [
    [100, 0],
    [50, 0],
    [50, 6],
    [50, 20],
  ]) {
    await settings(page)
    for (const [label, value] of [
      ['卡片不透明度', opacity],
      ['卡片背景模糊', blur],
    ]) {
      const control = page.getByRole('slider', { name: label, exact: true })
      await control.focus()
      await control.press('Home')
      for (let i = 0; i < value; i++) await control.press('ArrowRight')
    }
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.screenshot({
      path: `${evidence}/perf-opacity-${opacity}-blur-${blur}.png`,
      fullPage: false,
    })
    const samples = []
    for (let repeat = 0; repeat < 3; repeat++) {
      const before = Object.fromEntries(
        (await session.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
      )
      const frames = await page.evaluate(async () => {
        const samples = []
        const longTasks = []
        let observer
        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
          observer = new PerformanceObserver((list) =>
            longTasks.push(...list.getEntries().map((e) => e.duration)),
          )
          observer.observe({ type: 'longtask' })
        }
        let previous
        for (let i = 0; i < 120; i++) {
          const time = await new Promise(requestAnimationFrame)
          if (previous !== undefined) samples.push(time - previous)
          previous = time
          window.scrollTo(
            0,
            Math.round(
              ((Math.sin(i / 10) + 1) / 2) *
                Math.max(0, document.documentElement.scrollHeight - innerHeight),
            ),
          )
        }
        observer?.disconnect()
        window.scrollTo(0, 0)
        const sorted = samples.toSorted((a, b) => a - b)
        return {
          medianMs: sorted[Math.floor(sorted.length / 2)],
          p95Ms: sorted[Math.floor(sorted.length * 0.95)],
          maxMs: Math.max(...samples),
          slowFrames: samples.filter((t) => t > 25).length,
          frameCount: samples.length,
          longTasksMs: longTasks,
        }
      })
      const after = Object.fromEntries(
        (await session.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
      )
      const cpu = Object.fromEntries(
        ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map((key) => [
          key,
          (after[key] - before[key]) * 1000,
        ]),
      )
      samples.push({ repeat, ...frames, cpuMs: cpu })
    }
    result.cases.push({ opacity, blur, samples })
    console.log(JSON.stringify({ opacity, blur, samples }))
  }
} catch (error) {
  result.failure = error.stack
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(`${evidence}/performance-ab.json`, JSON.stringify(result, null, 2))
  await browser.close()
}

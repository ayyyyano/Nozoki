import { spawnSync } from 'node:child_process'
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs'
const dir = '.wrangler/test-results/phase-01.3-followup'
mkdirSync(dir, { recursive: true })
const production = process.env.CHECK_PRODUCTION === '1'
const result = { baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000', production, scripts: [] }
const selected = process.argv.slice(2)
for (const script of selected.length
  ? selected
  : [
      'loading-followup',
      'dx-transition',
      'dx-assets013',
      'first-paint',
      'sliders',
      'layout013',
      'interaction012',
    ]) {
  const log = `${dir}/${script}-${production ? 'production' : 'dev'}${selected.length ? '-retry' : ''}.log`,
    fd = openSync(log, 'w'),
    start = Date.now()
  const run = spawnSync(process.execPath, [`tests/browser/${script}.mjs`], {
    env: { ...process.env, EVIDENCE_DIR: dir },
    stdio: ['ignore', fd, fd],
    timeout: 180000,
  })
  closeSync(fd)
  result.scripts.push({
    script,
    exitCode: run.status,
    elapsedMs: Date.now() - start,
    error: run.error?.message,
    log,
  })
  console.log(`${run.status === 0 ? 'PASS' : 'FAIL'} ${script}`)
}
writeFileSync(
  `${dir}/${selected.length ? 'retry' : 'regression'}-${production ? 'production' : 'dev'}.json`,
  JSON.stringify(result, null, 2),
)
if (result.scripts.some((s) => s.exitCode !== 0)) process.exitCode = 1

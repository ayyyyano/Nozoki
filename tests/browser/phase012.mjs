import { spawnSync } from 'node:child_process'
import { openSync, closeSync, mkdirSync, writeFileSync } from 'node:fs'
const dir = '.wrangler/test-results/phase-01.2'
mkdirSync(dir, { recursive: true })
const production = process.env.CHECK_PRODUCTION === '1'
const result = { baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000', production, scripts: [] }
for (const script of [
  'phase011',
  'sliders',
  'layout012',
  'wallpaper012',
  'palette012',
  'icons012',
  'first-paint',
  'dx-transition',
]) {
  const log = `${dir}/${script}-${production ? 'production' : 'dev'}.log`
  const fd = openSync(log, 'w')
  const started = Date.now()
  const run = spawnSync(process.execPath, [`tests/browser/${script}.mjs`], {
    env: { ...process.env, EVIDENCE_DIR: dir },
    stdio: ['ignore', fd, fd],
    timeout: 180000,
  })
  closeSync(fd)
  result.scripts.push({
    script,
    exitCode: run.status,
    elapsedMs: Date.now() - started,
    error: run.error?.message,
    log,
  })
  console.log(`${run.status === 0 ? 'PASS' : 'FAIL'} ${script}`)
}
writeFileSync(
  `${dir}/suite-${production ? 'production' : 'dev'}.json`,
  JSON.stringify(result, null, 2),
)
if (result.scripts.some((r) => r.exitCode !== 0)) process.exitCode = 1

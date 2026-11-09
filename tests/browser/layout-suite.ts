import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

if (!existsSync('.output/server/index.mjs'))
  throw new Error('Run pnpm build before pnpm test:layout')
const evidence = resolve(
  process.env.LAYOUT_EVIDENCE ?? resolve(tmpdir(), 'nozoki-layout-' + Date.now()),
)
await mkdir(resolve('.wrangler/tmp'), { recursive: true })
const child = spawn(
  process.execPath,
  ['--experimental-strip-types', '--test', 'tests/integration/source-access.test.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NOZOKI_TEST_COMPACT_GRID: '1',
      NOZOKI_SOURCE_UI_EVIDENCE: evidence,
      EVIDENCE_DIR: evidence,
      TEMP: resolve('.wrangler/tmp'),
      TMP: resolve('.wrangler/tmp'),
    },
  },
)
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})

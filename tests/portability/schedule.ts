import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const out = resolve('.wrangler/test-results/phase-07-schedule')
await mkdir(out, { recursive: true })
const archiveRoot = resolve('..', 'Nozoki-Archives')
await mkdir(archiveRoot, { recursive: true })
const directory = await mkdtemp(resolve(archiveRoot, 'nozoki-schedule-portability-'))
await cp('shared/schedule', resolve(directory, 'schedule'), { recursive: true })
await writeFile(
  resolve(directory, 'package.json'),
  JSON.stringify(
    {
      private: true,
      type: 'module',
      dependencies: { '@js-temporal/polyfill': '0.5.1', zod: '4.6.7' },
    },
    null,
    2,
  ),
)
const npm =
  process.env.NPM_CLI ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const install = spawnSync(
  process.execPath,
  [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
  { cwd: directory, encoding: 'utf8' },
)
await writeFile(
  resolve(out, 'portability-install.log'),
  (install.stdout ?? '') + (install.stderr ?? ''),
)
assert.equal(install.status, 0, 'Standalone dependency installation failed')
const source = await readFile('tests/unit/schedule-engine.test.ts', 'utf8')
await writeFile(
  resolve(directory, 'schedule.test.ts'),
  source.replace('../../shared/schedule/index.ts', './schedule/index.ts'),
)
const run = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', 'schedule.test.ts'],
  { cwd: directory, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
)
await writeFile(resolve(out, 'portability-tests.log'), (run.stdout ?? '') + (run.stderr ?? ''))
assert.equal(run.status, 0, 'Standalone schedule tests failed')
const modules = (await readdir(resolve(directory, 'node_modules'))).filter(
  (n) => !n.startsWith('.'),
)
assert.deepEqual(modules.sort(), ['@js-temporal', 'jsbi', 'zod'])
const files = await readdir(resolve(directory, 'schedule'))
await writeFile(
  resolve(out, 'portability.json'),
  JSON.stringify(
    {
      directory,
      node: process.version,
      copiedCore: files,
      testImportOnlyAdjusted: true,
      installedDependencies: modules,
      copiedNodeModules: false,
      result: 'PASS',
    },
    null,
    2,
  ),
)
console.log(
  'PASS standalone copied schedule core; only Temporal, JSBI and Zod installed: ' + directory,
)

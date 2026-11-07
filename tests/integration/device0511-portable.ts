// This test deliberately copies only the portable code and its Node built-in tests outside the repo.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const destination = await mkdtemp(join(tmpdir(), 'nozoki-device-core-'))
const files = [
  'shared/device-state/types.ts',
  'shared/device-state/sleepy.ts',
  'shared/device-state/presentation.ts',
  'tests/unit/device0511-core.test.ts',
]
const hashes = {}
for (const path of files) {
  const target = join(destination, path)
  await mkdir(join(target, '..'), { recursive: true })
  await copyFile(path, target)
  const original = await readFile(path),
    copied = await readFile(target)
  assert.deepEqual(copied, original)
  hashes[path] = createHash('sha256').update(copied).digest('hex')
  if (path.startsWith('shared/')) {
    for (const entry of copied.toString().matchAll(/from ['"]([^'"]+)['"]/g))
      assert.ok(entry[1].startsWith('./'), entry[1])
  }
}
const log = execFileSync(
  process.execPath,
  ['--experimental-strip-types', '--test', join(destination, 'tests/unit/device0511-core.test.ts')],
  { encoding: 'utf8', cwd: destination },
)
assert.ok(log.includes('fail 0'))
const evidence = process.env.EVIDENCE_DIR ?? '.wrangler/test-results/phase-05.1.1'
await writeFile(evidence + '/portable.log', log)
await writeFile(
  evidence + '/portable.json',
  JSON.stringify(
    {
      destination,
      files: hashes,
      unchangedCopy: true,
      externalDependencies: [],
      runtime: process.version,
      noNuxtD1OrAuth: true,
    },
    null,
    2,
  ),
)
console.log(log)

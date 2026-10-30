// Explicit test-only workaround for this host's unbound Miniflare email-store failure.
// The original dependency and D1/workerd code are never modified.
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const wrangler = createRequire(require.resolve('wrangler/package.json'))
const original = wrangler.resolve('miniflare')
const source = await readFile(original, 'utf8')
const binding =
  /\{\s*name: CoreBindings\.SERVICE_EMAIL_STORE,\s*service: \{ name: EMAIL_STORE_SERVICE_NAME \}\s*\},?/g
const count = [...source.matchAll(binding)].length
if (count !== 3 || !source.includes('services.push(...getEmailStoreServices(tmpPath));'))
  throw new Error('Unexpected Miniflare source; refuse an unverified patch')
let removed = 0
const patched = source
  .replace(binding, (match) => (++removed <= 2 ? '' : match))
  .replace('services.push(...getEmailStoreServices(tmpPath));', '')
const target = join(dirname(original), 'index.nozoki-test.cjs')
await writeFile(target, patched)
const evidence = resolve('.wrangler/test-results/phase-02-fixes')
await mkdir(evidence, { recursive: true })
await writeFile(
  join(evidence, 'runtime-workaround.json'),
  JSON.stringify(
    {
      original,
      target,
      version: wrangler('miniflare/package.json').version,
      originalSha256: createHash('sha256').update(source).digest('hex'),
      patchedSha256: createHash('sha256').update(patched).digest('hex'),
      removed: [
        'two unconditional references to unused email-store service',
        'one email-store service registration',
      ],
      d1AndWorkerdUnchanged: true,
    },
    null,
    2,
  ),
)
console.log(target)

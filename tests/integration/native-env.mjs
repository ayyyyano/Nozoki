import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
const evidence = resolve('.wrangler/test-results/phase-07')
await mkdir(evidence, { recursive: true })
if (process.argv[2] === '--probe') {
  const require = createRequire(import.meta.url)
  const mfRequire = createRequire(require.resolve('wrangler/package.json'))
  const { Miniflare, convertV4MiniflareOptions } = mfRequire('miniflare')
  let mf
  try {
    const opts = convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("native-ok")}}',
      ...(process.argv[3] === 'resource-temp'
        ? { resourceTmpPath: resolve('.wrangler/phase07-env') }
        : {}),
    })
    mf = new Miniflare(opts)
    const r = await mf.dispatchFetch('http://localhost/')
    console.log(
      JSON.stringify({ native: true, tmp: tmpdir(), status: r.status, body: await r.text() }),
    )
  } catch (e) {
    console.error(JSON.stringify({ native: true, tmp: tmpdir(), error: String(e) }))
    process.exitCode = 1
  } finally {
    await mf?.dispose()
  }
} else {
  const base = await mkdtemp(resolve('.wrangler/phase07-env-'))
  const results = []
  for (const variant of ['default', 'workspace-temp', 'resource-temp']) {
    const env = { ...process.env }
    delete env.NOZOKI_TEST_MINIFLARE
    if (variant === 'workspace-temp') {
      env.TMP = base
      env.TEMP = base
    }
    const r = spawnSync(
      process.execPath,
      [resolve('tests/integration/native-env.mjs'), '--probe', variant],
      { env, timeout: 30000, encoding: 'utf8' },
    )
    const item = {
      variant,
      status: r.status,
      error: r.error?.message,
      stdout: r.stdout,
      stderr: r.stderr,
    }
    results.push(item)
    console.log(JSON.stringify(item))
  }
  await writeFile(evidence + '/native-env.json', JSON.stringify({ base, results }, null, 2))
}

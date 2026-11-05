import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const wrangler = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')

/** Only an explicit deployment command may change remote D1. Builds remain offline. */
export async function deployCloudflare(run = runWrangler) {
  const config = 'wrangler.jsonc'
  // Wrangler tracks applied names in d1_migrations and applies only pending files.
  // A migration or permissions failure stops publication of the new Worker.
  await run(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config])
  await run(['deploy', '--config', config])
}

function runWrangler(args) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? accept() : reject(new Error('CLOUDFLARE_DEPLOY_STEP_FAILED')),
    )
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('USAGE: deploy-cloudflare.mjs')
  try {
    await deployCloudflare()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'CLOUDFLARE_DEPLOY_FAILED')
    process.exitCode = 1
  }
}

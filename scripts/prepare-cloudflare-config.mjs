import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const uuid = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/

/** Keep the JSONC source intact: Wrangler allows comments and trailing commas. */
function readConfig(source) {
  const text = readFileSync(resolve(root, source), 'utf8')
  if (!/"binding"\s*:\s*"DB"/.test(text)) {
    throw new Error('DB_BINDING_NOT_FOUND')
  }
  const names = [...text.matchAll(/"database_name"\s*:\s*"([^"]+)"/g)]
  if (names.length !== 1 || !names[0][1]) {
    throw new Error('SINGLE_DB_BINDING_REQUIRED')
  }
  return { text, name: names[0][1] }
}

function printDatabaseName(source) {
  process.stdout.write(readConfig(source).name)
}

/** Wrangler resolves main, assets and migrations relative to the config file. */
function prepareConfig(databaseId, source, target) {
  if (!uuid.test(databaseId ?? '')) {
    throw new Error('INVALID_DATABASE_ID')
  }
  const { text } = readConfig(source)
  const pattern = /("database_id"\s*:\s*")[^"]*(")/g
  const matches = [...text.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error('SINGLE_DATABASE_ID_REQUIRED')
  }
  const updated = text.replace(pattern, (_match, before, after) => `${before}${databaseId}${after}`)
  writeFileSync(resolve(root, target), updated, 'utf8')
}

function main() {
  const [, , command, ...args] = process.argv
  switch (command) {
    case 'name':
      printDatabaseName(args[0] ?? 'wrangler.jsonc')
      break
    case 'config':
      prepareConfig(args[0], args[1] ?? 'wrangler.jsonc', args[2] ?? 'wrangler.bootstrap.jsonc')
      break
    default:
      throw new Error('USAGE: prepare-cloudflare-config.mjs name|config')
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'CLOUDFLARE_CONFIG_PREPARATION_FAILED')
  process.exitCode = 1
}

import { stat, readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { createPrivateRelay } from '../../server/adapters/private-relay.ts'

export function databasePath(env = process.env) {
  const path = env.NOZOKI_SQLITE_PATH
  if (!path || !isAbsolute(path)) throw new Error('NOZOKI_SQLITE_PATH_MUST_BE_ABSOLUTE')
  return path
}
export async function nodeEnvironment(values = process.env, wire = fetch) {
  const names = [
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
    'AUTH_VERSION',
    'AUTH_ORIGIN',
    'AUTH_RATE_LIMIT_SECRET',
    'AUTH_ALLOW_LOCAL_HTTP',
    'AUTH_ABSOLUTE_SECONDS',
    'AUTH_IDLE_SECONDS',
    'AUTH_TOUCH_SECONDS',
    'INTEGRATION_ENCRYPTION_KEY',
    'INTEGRATION_KEY_VERSION',
    'INTEGRATION_DECRYPTION_KEYS',
    'COLLECTOR_EPOCH',
    'COLLECTOR_BINDING_REVISION',
    'NOZOKI_PRIVATE_ROUTES',
    'NOZOKI_PRIVATE_RELAY_TOKEN',
  ]
  const env = Object.fromEntries(
    names.filter((k) => typeof values[k] === 'string').map((k) => [k, values[k]]),
  )
  // A Node deployment never has Cloudflare's authenticated request.cf metadata.
  env.AUTH_TRUST_CF_IP = '0'
  if (values.NOZOKI_RELAY_CONFIG_FILE) {
    const file = values.NOZOKI_RELAY_CONFIG_FILE
    if (!isAbsolute(file) || (await stat(file)).size > 65536)
      throw new Error('INVALID_RELAY_CONFIGURATION')
    const bytes = await readFile(file)
    if (bytes.length > 65536) throw new Error('INVALID_RELAY_CONFIGURATION')
    const configuration = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!configuration || !Array.isArray(configuration.sources))
      throw new Error('INVALID_RELAY_CONFIGURATION')
    const handler = await createPrivateRelay(
      configuration.sources,
      env.NOZOKI_PRIVATE_RELAY_TOKEN ?? '',
      wire,
      values.NOZOKI_RELAY_ID_KEY,
    )
    env.NOZOKI_PRIVATE_RELAY = {
      fetch: (input, init) => handler(new Request(input, init)),
    }
  }
  return env
}

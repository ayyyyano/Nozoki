import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
/** Workerd child processes on this Windows host cannot create storage in system TEMP. */
export function localRuntimeEnv(env = process.env) {
  if (process.platform !== 'win32') return { ...env }
  const directory = resolve('.wrangler/tmp')
  mkdirSync(directory, { recursive: true })
  return { ...env, TEMP: directory, TMP: directory }
}

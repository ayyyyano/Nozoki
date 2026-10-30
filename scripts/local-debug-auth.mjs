import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'

// Node CLI only. No import from server/client code or production Worker.
export async function prepareLocalAuth(root = process.cwd()) {
  const base = resolve(root, '.wrangler/local-debug')
  await mkdir(base, { recursive: true })
  const databaseDirectory = resolve(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
  const files = (await readdir(databaseDirectory)).filter((f) => /^[a-f0-9]{64}\.sqlite$/.test(f))
  if (files.length !== 1)
    throw new Error('Expected one initialized local D1; run pnpm db:init first')
  const destinationDirectory = resolve(base, 'state/v3/d1/miniflare-D1DatabaseObject')
  await mkdir(destinationDirectory, { recursive: true })
  const destination = resolve(destinationDirectory, files[0])
  try {
    await access(destination)
  } catch {
    const source = new DatabaseSync(resolve(databaseDirectory, files[0]), { readOnly: true })
    try {
      await backup(source, destination)
    } finally {
      source.close()
    }
  }
  const copy = new DatabaseSync(destination, { readOnly: true })
  try {
    if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
      throw new Error('Local debug database integrity failed')
  } finally {
    copy.close()
  }
  const credentialsFile = resolve(base, 'credentials.json')
  const varsFile = resolve(base, '.dev.vars')
  const loginFile = resolve(base, 'LOGIN.txt')
  const secret = () => randomBytes(32).toString('base64url')
  let credentials
  try {
    credentials = JSON.parse(await readFile(credentialsFile, 'utf8'))
    await access(varsFile)
    await access(loginFile)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    // Do not overwrite partial/existing credentials: require explicit manual recovery.
    for (const file of [credentialsFile, varsFile, loginFile]) {
      try {
        await access(file)
      } catch {
        continue
      }
      throw new Error('Partial local auth configuration exists; preserve it and recover manually')
    }
    credentials = { email: 'debug@nozoki.local', password: secret() }
    await writeFile(credentialsFile, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 })
    await writeFile(
      varsFile,
      [
        `ADMIN_EMAIL=${credentials.email}`,
        `ADMIN_PASSWORD=${credentials.password}`,
        'AUTH_VERSION=1',
        `AUTH_RATE_LIMIT_SECRET=${secret()}`,
        'AUTH_ORIGIN=http://127.0.0.1:3000',
        'AUTH_ALLOW_LOCAL_HTTP=1',
      ].join('\n') + '\n',
      { flag: 'wx', mode: 0o600 },
    )
    await writeFile(
      loginFile,
      `LOCAL DEBUG ONLY\nURL: http://127.0.0.1:3000/\nEmail: ${credentials.email}\nPassword: ${credentials.password}\n\nStart: pnpm dev:local\nReal authentication and isolated persistent D1. Never upload these files.\n`,
      { flag: 'wx', mode: 0o600 },
    )
  }
  const config = resolve(base, 'wrangler.jsonc')
  await writeFile(
    config,
    JSON.stringify(
      {
        name: 'nozoki-local-debug',
        compatibility_date: '2026-10-19',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'nozoki-db',
            database_id: '00000000-0000-0000-0000-000000000002',
            remote: false,
            migrations_dir: resolve(root, 'migrations'),
          },
        ],
      },
      null,
      2,
    ),
  )
  return { config, loginFile }
}

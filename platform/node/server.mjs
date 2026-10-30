import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { SqliteDatabase } from './sqlite.mjs'
import { assertMigrated } from './migrations.mjs'
import { databasePath, nodeEnvironment } from './environment.mjs'
import { requestURL, boundedBody, fixedError } from './http.mjs'

// These paths are resolved against the deployed bundle, independent of process.cwd().
const { listener } = await import(new URL('./server/index.mjs', import.meta.url).href)
const db = new SqliteDatabase(databasePath())
await assertMigrated(db, fileURLToPath(new URL('./migrations', import.meta.url)))
const env = await nodeEnvironment()
const server = createServer({ maxHeaderSize: 16384 }, async (req, res) => {
  try {
    let url
    try {
      url = requestURL(req, env)
    } catch {
      fixedError(res, 421, 'REQUEST_HOST_REJECTED')
      return
    }
    if (!(await boundedBody(req, res, url))) return
    // h3 forwards this platform context to SSR's internal API requests.
    req.__unenv__ = { _platform: { nozokiNode: { db, env, request: new Request(url) } } }
    delete req.headers['x-forwarded-host']
    delete req.headers['x-forwarded-proto']
    delete req.headers.forwarded
    await listener(req, res)
  } catch {
    if (!res.headersSent) fixedError(res, 503, 'SERVER_UNAVAILABLE')
    else res.destroy()
  }
})
server.requestTimeout = 15000
server.headersTimeout = 10000
server.keepAliveTimeout = 5000
const host = process.env.HOST ?? '127.0.0.1'
if (!['127.0.0.1', '::1', 'localhost'].includes(host))
  throw new Error('NODE_SERVER_REQUIRES_LOOPBACK_REVERSE_PROXY')
const port = Number(process.env.PORT ?? '3000')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT')
server.listen(port, host, () => console.log(`Nozoki listening on loopback port ${port}`))
server.on('error', () => {
  console.error('NODE_LISTEN_FAILED')
  process.exitCode = 1
  db.close()
})
let closing = false
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    if (closing) return
    closing = true
    const timer = setTimeout(() => {
      db.close()
      process.exit(1)
    }, 20000).unref()
    server.close(() => {
      clearTimeout(timer)
      db.close()
    })
  })

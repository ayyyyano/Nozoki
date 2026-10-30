// Local, explicit read-only process. cloudflared/VPC setup remains an operator action.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createPrivateRelay } from '../server/adapters/private-relay.ts'
const path = process.env.NOZOKI_RELAY_CONFIG_FILE
if (!path) throw new Error('NOZOKI_RELAY_CONFIG_FILE required')
const bytes = await readFile(path)
if (bytes.length > 65536) throw new Error('RELAY_CONFIG_TOO_LARGE')
const configuration = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
if (!Array.isArray(configuration.sources)) throw new Error('INVALID_RELAY_CONFIG')
const handler = await createPrivateRelay(
  configuration.sources,
  process.env.NOZOKI_PRIVATE_RELAY_TOKEN ?? '',
  fetch,
  process.env.NOZOKI_RELAY_ID_KEY,
)
const server = createServer(async (req, res) => {
  const host = req.headers.host
  if (
    !['127.0.0.1:8976', 'localhost:8976', 'nozoki-private.internal'].includes(host) ||
    req.method !== 'GET' ||
    req.headers['transfer-encoding'] ||
    Number(req.headers['content-length'] ?? 0) !== 0
  ) {
    res.writeHead(400)
    res.end()
    return
  }
  const headers = new Headers()
  for (const key of ['authorization', 'x-nozoki-request', 'origin'])
    if (req.headers[key]) headers.set(key, String(req.headers[key]))
  const controller = new AbortController()
  res.once('close', () => controller.abort())
  try {
    const response = await handler(
      new Request('http://nozoki-private.internal' + req.url, {
        headers,
        signal: controller.signal,
      }),
    )
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    res.writeHead(502)
    res.end('{"code":"RELAY_UNAVAILABLE"}')
  }
})
server.listen(8976, '127.0.0.1', () =>
  process.stdout.write('Read-only relay listening on loopback port 8976\n'),
)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close())

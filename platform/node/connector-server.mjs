import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createSourceConnector } from './source-connector.mjs'
const handler = createSourceConnector(process.env.NOZOKI_CONNECTOR_TOKEN ?? '', {
  privateCidrs: process.env.NOZOKI_CONNECTOR_PRIVATE_CIDRS ?? '',
})
const host = process.env.HOST ?? '127.0.0.1',
  port = Number(process.env.PORT ?? 3100)
if (!['127.0.0.1', '::1'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('CONNECTOR_REQUIRES_LOOPBACK_PROXY')
const server = createServer({ maxHeaderSize: 16384 }, async (req, res) => {
  try {
    const request = new Request('https://connector.invalid' + req.url, {
      method: req.method,
      headers: req.headers,
      ...(['GET', 'HEAD'].includes(req.method)
        ? {}
        : { body: Readable.toWeb(req), duplex: 'half' }),
    })
    const response = await handler(request)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    if (!res.headersSent) res.writeHead(503, { 'Cache-Control': 'no-store' })
    res.end()
  }
})
server.requestTimeout = 10000
server.headersTimeout = 5000
server.keepAliveTimeout = 1000
server.maxConnections = 64
server.listen(port, host, () => console.log(`Nozoki source connector on loopback port ${port}`))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close())

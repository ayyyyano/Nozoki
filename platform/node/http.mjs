import { CONFIG_BODY_LIMIT, AUTH_BODY_LIMIT } from '../../shared/contracts/admin.ts'

/** TLS is terminated by a loopback reverse proxy preserving the configured public Host. */
export function requestURL(req, env) {
  const path = req.url ?? '/'
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n\u0000]/.test(path))
    throw new Error('INVALID_REQUEST_TARGET')
  const host = req.headers.host ?? ''
  let configured = null
  try {
    if (env.AUTH_ORIGIN) configured = new URL(env.AUTH_ORIGIN)
  } catch {
    // Missing/invalid auth configuration keeps guest pages available; authSettings rejects login.
  }
  const origin = configured?.origin ?? 'http://127.0.0.1'
  if (configured && host.toLowerCase() !== configured.host.toLowerCase())
    throw new Error('REQUEST_HOST_REJECTED')
  const url = new URL(origin + path)
  if (url.origin !== origin) throw new Error('INVALID_REQUEST_TARGET')
  return url.href
}
export function fixedError(res, status, code) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close',
  })
  res.end(JSON.stringify({ code, message: '请求无法完成' }))
}
/** Buffer at most the route budget before invoking Nitro, including chunked bodies. */
export async function boundedBody(req, res, url) {
  const limit =
    req.method === 'PUT' && new URL(url).pathname === '/api/admin/config'
      ? CONFIG_BODY_LIMIT
      : AUTH_BODY_LIMIT
  const length = req.headers['content-length']
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    fixedError(res, 413, 'INVALID_REQUEST')
    return false
  }
  return new Promise((resolve) => {
    const chunks = []
    let size = 0,
      ended = false
    const done = (result) => {
      if (ended) return
      ended = true
      req.off('data', data)
      req.off('end', end)
      req.off('error', error)
      req.off('aborted', error)
      resolve(result)
    }
    const data = (chunk) => {
      size += chunk.length
      if (size > limit) {
        req.pause()
        fixedError(res, 413, 'INVALID_REQUEST')
        res.once('finish', () => req.destroy())
        done(false)
      } else chunks.push(chunk)
    }
    const end = () => {
      req.rawBody = Buffer.concat(chunks, size)
      done(true)
    }
    const error = () => done(false)
    req.on('data', data)
    req.once('end', end)
    req.once('error', error)
    req.once('aborted', error)
  })
}

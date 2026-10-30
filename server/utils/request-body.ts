import { CONFIG_BODY_LIMIT, AUTH_BODY_LIMIT } from '../../shared/contracts/admin.ts'
export async function guardRequestBody(request: Request): Promise<Request | Response> {
  const limit =
    request.method === 'PUT' && new URL(request.url).pathname === '/api/admin/config'
      ? CONFIG_BODY_LIMIT
      : AUTH_BODY_LIMIT
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const reject = () =>
      new Response(JSON.stringify({ code: 'INVALID_REQUEST', message: '请求无法完成' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    const length = request.headers.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) return reject()
    const reader = request.body?.getReader()
    if (reader) {
      const parts: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const item = await reader.read()
          if (item.done) break
          size += item.value.length
          if (size > limit) {
            await reader.cancel()
            return reject()
          }
          parts.push(item.value)
        }
      } finally {
        reader.releaseLock()
      }
      const body = new Uint8Array(size)
      let offset = 0
      for (const part of parts) {
        body.set(part, offset)
        offset += part.length
      }
      // Keep Cloudflare's non-standard request metadata when replacing the Request:
      // rate-limit source identity uses request.cf.colo, and a synthetic Request drops it.
      const cf = (request as Request & { cf?: unknown }).cf
      request = new Request(request, { body })
      if (cf !== undefined && !('cf' in request))
        try {
          Object.defineProperty(request, 'cf', {
            value: cf,
            enumerable: true,
            configurable: true,
          })
        } catch {
          // Some runtimes expose Request.cf as a non-extensible native property. The
          // caller then falls back to the conservative unknown-source rate-limit bucket.
        }
    }
  }
  return request
}

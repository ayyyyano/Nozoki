// Stream cap before Nitro buffers request.arrayBuffer().
import worker from '#nozoki-cloudflare-entry'
import { guardRequestBody } from './utils/request-body.ts'
export default {
  ...worker,
  async fetch(request: Request, env: unknown, context: unknown) {
    const checked = await guardRequestBody(request)
    return checked instanceof Response ? checked : worker.fetch(checked, env, context)
  },
}

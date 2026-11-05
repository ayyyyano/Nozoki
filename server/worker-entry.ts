// Stream cap before Nitro buffers request.arrayBuffer().
import worker from '#nozoki-cloudflare-entry'
import { guardRequestBody } from './utils/request-body.ts'
import { scheduledCollection } from './collection/scheduled.ts'
export default {
  ...worker,
  scheduled: scheduledCollection,
  async fetch(request: Request, env: unknown, context: unknown) {
    const checked = await guardRequestBody(request)
    return checked instanceof Response ? checked : worker.fetch(checked, env, context)
  },
}

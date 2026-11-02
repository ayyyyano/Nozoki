// Offline-only harness, absent from both deployment configurations.
import { runCollection } from '../../server/collection/run.ts'
import { readGuestDashboard, readAdminDashboard } from '../../server/services/dashboard.ts'
import type { Database } from '../../server/types/database.ts'
export default {
  async fetch(request: Request, env: Record<string, unknown> & { DB: Database }) {
    const path = new URL(request.url).pathname
    if (path === '/collect') return Response.json(await runCollection(env.DB, env, Date.now()))
    if (path === '/guest') return Response.json(await readGuestDashboard(env.DB))
    if (path === '/admin') return Response.json(await readAdminDashboard(env.DB))
    return new Response(null, { status: 404 })
  },
}

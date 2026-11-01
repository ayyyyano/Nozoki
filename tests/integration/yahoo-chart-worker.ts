// Isolated HTTP test harness; no deployment configuration references this file.
import { runCollection } from '../../server/collection/run.ts'
import { readGuestDashboard } from '../../server/services/dashboard.ts'
import { testIntegration } from '../../server/services/integration-test.ts'
import { authSettings } from '../../server/services/auth-settings.ts'
import type { Database } from '../../server/types/database.ts'
export default {
  async fetch(request: Request, env: Record<string, unknown> & { DB: Database }) {
    const path = new URL(request.url).pathname
    if (path === '/collect') return Response.json(await runCollection(env.DB, env, Date.now()))
    if (path === '/api/dashboard') return Response.json(await readGuestDashboard(env.DB))
    if (path === '/probe')
      return Response.json(
        await testIntegration(
          env.DB,
          'yahoo',
          {
            hash: 'a'.repeat(64),
            settings: await authSettings(env),
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          env,
        ),
      )
    return new Response('Not found', { status: 404 })
  },
}

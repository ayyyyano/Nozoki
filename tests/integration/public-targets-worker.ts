// HTTP harness for an isolated Miniflare instance. Deployment configs do not reference this file.
import { authSettings } from '../../server/services/auth-settings.ts'
import { testIntegration } from '../../server/services/integration-test.ts'
import { runCollection } from '../../server/collection/run.ts'
import { collectionEnvironment } from '../../server/collection/environment.ts'
import type { Database } from '../../server/types/database.ts'
export default {
  async fetch(request: Request, env: Record<string, unknown> & { DB: Database }) {
    const path = new URL(request.url).pathname
    if (path === '/probe')
      return Response.json(
        await testIntegration(
          env.DB,
          'fixture',
          {
            hash: 'a'.repeat(64),
            settings: await authSettings(env),
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          env,
        ),
      )
    if (path === '/collect') return Response.json(await runCollection(env.DB, env, Date.now()))
    if (path === '/environment') {
      const { routes, epoch } = (await request.json()) as { routes: string; epoch: number }
      try {
        await collectionEnvironment(env.DB, {
          ...env,
          NOZOKI_PUBLIC_ROUTES: routes,
          COLLECTOR_EPOCH: String(epoch),
        })
        return Response.json('ok')
      } catch (error) {
        return Response.json((error as Error).message)
      }
    }
    return new Response('Not found', { status: 404 })
  },
}

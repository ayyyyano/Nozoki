// Isolated transport fixture; never included in a production bundle.
import { managedTransport, managedEgressStatus } from '../../server/adapters/managed-transport.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { source } from '../fixtures/adapters.ts'
import { readManagedSource } from '../../server/collection/managed-read.ts'

export default {
  async fetch(request: Request, env: Record<string, unknown>) {
    const input = (await request.json()) as {
      root?: string
      endpoint?: string
      credential?: string
      authentication?: 'none' | 'bearer'
      mode?: 'public' | 'private'
      approved?: boolean
      operation?: 'probe' | 'network' | 'status'
      timeoutMs?: number
    }
    if (input.operation === 'status') return Response.json(managedEgressStatus(env))
    try {
      if (input.operation === 'network') {
        const result = await fetch(input.root!, {
          redirect: 'manual',
          signal: AbortSignal.timeout(2000),
        })
        return Response.json({ status: result.status, body: await result.text() })
      }
      const s = source('sleepy')
      s.baseUrl = input.root ?? 'https://source.example.com/service/'
      s.access = {
        mode: input.mode ?? 'public',
        authentication: input.authentication ?? 'none',
        approved: input.approved ?? true,
        approvedTarget: null,
      }
      s.access.approvedTarget = sourceTargetKey(s, s.access)
      if (input.operation === 'probe')
        return Response.json(await readManagedSource(s, null, null, env, new Date(), 'probe'))
      const result = await managedTransport(s, input.credential, env, {
        timeoutMs: input.timeoutMs ?? 1000,
      }).get(input.endpoint ?? 'api/meta')
      return Response.json({ value: result.value })
    } catch (error) {
      return Response.json({ code: error instanceof Error ? error.message : 'failed' })
    }
  },
}

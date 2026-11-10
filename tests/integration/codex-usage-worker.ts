// Isolated RPC harness; never referenced by a deployment configuration.
import { WorkerEntrypoint } from 'cloudflare:workers'
import type { Database } from '../../server/types/database.ts'
import { runCollection } from '../../server/collection/run.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { readManagedSource } from '../../server/collection/managed-read.ts'
import { testIntegrationDraft } from '../../server/services/integration-draft-test.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import { authSettings } from '../../server/services/auth-settings.ts'
export default class Harness extends WorkerEntrypoint<Record<string, unknown> & { DB: Database }> {
  async fetch(request: Request) {
    const url = new URL(request.url)
    return Response.json(
      url.pathname === '/collect'
        ? JSON.parse(await this.collect(Number(url.searchParams.get('at'))))
        : await this.probe(Number(url.searchParams.get('at')), url.pathname === '/draft'),
    )
  }
  async collect(at: number) {
    return JSON.stringify(
      await runCollection(this.env.DB, this.env, at, {
        clock: () => new Date(at),
        sourceIds: ['usage-fixture'],
      }),
    )
  }
  async probe(at: number, draft = false) {
    const state = await readStoredState(this.env.DB)
    const entry = state.integrations.find((i) => i.settings.id === 'usage-fixture')!
    if (draft) {
      const config = editableConfig(state.config)
      const result = await testIntegrationDraft(
        this.env.DB,
        entry.settings.id,
        {
          expectedVersion: config.site.configVersion,
          draft: config.integrations.find((i) => i.id === entry.settings.id),
          quoteSymbols: [],
        },
        {
          hash: 'a'.repeat(64),
          settings: await authSettings(this.env),
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        this.env,
      )
      return result.protocolMatched
    }
    const result = await readManagedSource(
      entry.settings,
      entry.envelope,
      entry.identityEnvelope,
      this.env,
      new Date(at),
      'probe',
    )
    return result.code ?? true
  }
}

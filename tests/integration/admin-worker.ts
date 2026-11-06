import { issueSourceTestProof } from '../../server/services/source-test-proof.ts'
import { readStoredState } from '../../server/repositories/config.ts'
import { DraftIntegrationTestSchema } from '../../shared/contracts/integration-test.ts'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { saveAdminConfig } from '../../server/services/admin-config.ts'
import { authSettings } from '../../server/services/auth-settings.ts'
import type { Database } from '../../server/types/database.ts'
import { guardRequestBody } from '../../server/utils/request-body.ts'
export default class AdminHarness extends WorkerEntrypoint<
  Record<string, unknown> & { DB: Database }
> {
  fetch() {
    return new Response('No HTTP test route', { status: 404 })
  }
  async bodyProbe(declared: string | null, size: number, path = '/api/admin/config') {
    const headers: Record<string, string> = {}
    if (declared !== null) headers['content-length'] = declared
    const request = new Request('https://dashboard.invalid' + path, {
      method: 'PUT',
      headers,
      body: new Uint8Array(size),
    })
    const result = await guardRequestBody(request)
    return result instanceof Response ? result.status : (await result.arrayBuffer()).byteLength
  }
  // Test-only RPC: HTTP onboarding separately validates the real probe-to-proof path.
  async testProof(id: string, value: unknown) {
    const { draft, expectedVersion } = DraftIntegrationTestSchema.parse(value)
    const state = await readStoredState(this.env.DB)
    return JSON.stringify({
      connectionProof: await issueSourceTestProof(
        draft,
        state.integrations.find((s) => s.settings.id === id),
        {
          hash: 'a'.repeat(64),
          settings: await authSettings(this.env),
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        expectedVersion,
      ),
    })
  }
  async save(value: unknown, key: string, scope = 'a'.repeat(64)) {
    return JSON.stringify(
      await saveAdminConfig(
        this.env.DB,
        value,
        key,
        {
          hash: scope,
          settings: await authSettings(this.env),
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        this.env,
      ),
    )
  }
}

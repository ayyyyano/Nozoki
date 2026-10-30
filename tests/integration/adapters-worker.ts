import { WorkerEntrypoint } from 'cloudflare:workers'
import type { Database } from '../../server/types/database.ts'
import { authSettings } from '../../server/services/auth-settings.ts'
import {
  reserveIntegrationTest,
  releaseIntegrationTest,
  deferIntegrationTest,
} from '../../server/services/integration-test-limits.ts'
import { testIntegration } from '../../server/services/integration-test.ts'
export default class AdapterHarness extends WorkerEntrypoint<
  Record<string, unknown> & { DB: Database }
> {
  fetch() {
    return new Response('No HTTP test route', { status: 404 })
  }
  async session() {
    return {
      hash: 'a'.repeat(64),
      settings: await authSettings(this.env),
      expiresAt: '2099-01-01T00:00:00.000Z',
    }
  }
  async reserve(id: string, at: string) {
    try {
      return {
        ok: true,
        slot: await reserveIntegrationTest(this.env.DB, await this.session(), id, new Date(at)),
      }
    } catch (e) {
      const error = e as { code?: string; status?: number }
      return { ok: false, code: error.code, status: error.status }
    }
  }
  async release(slot: { id: number; token: string }) {
    await releaseIntegrationTest(this.env.DB, slot)
  }
  async defer(hash: string, seconds: number, at: string) {
    await deferIntegrationTest(this.env.DB, hash, seconds, new Date(at))
  }
  async probe(id: string) {
    try {
      return JSON.stringify(await testIntegration(this.env.DB, id, await this.session(), this.env))
    } catch (e) {
      return JSON.stringify({ code: (e as { code?: string }).code ?? 'DATABASE_ERROR' })
    }
  }
}

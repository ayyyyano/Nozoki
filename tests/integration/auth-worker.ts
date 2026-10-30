import { WorkerEntrypoint } from 'cloudflare:workers'
import { authSettings, AuthError } from '../../server/services/auth-settings.ts'
import { login } from '../../server/services/auth.ts'
import { findSession, csrfToken, checkCsrf } from '../../server/services/sessions.ts'
import type { Database } from '../../server/types/database.ts'
export default class AuthHarness extends WorkerEntrypoint<
  Record<string, unknown> & { DB: Database }
> {
  fetch() {
    return new Response('No test HTTP API', { status: 404 })
  }
  async attempt(body: unknown, at: string, previous?: string, source = 'loopback') {
    try {
      const settings = await authSettings(this.env)
      return JSON.stringify({
        success: true,
        ...(await login(this.env.DB, settings, body, source, previous, new Date(at))),
      })
    } catch (error) {
      return JSON.stringify({
        success: false,
        code: error instanceof AuthError ? error.code : 'DATABASE_ERROR',
        status: error instanceof AuthError ? error.status : 503,
      })
    }
  }
  async inspect(token: string, at: string, touch = true) {
    const session = await findSession(
      this.env.DB,
      token,
      await authSettings(this.env),
      new Date(at),
      touch,
    )
    return JSON.stringify(
      session ? { viewer: 'admin', csrf: await csrfToken(session) } : { viewer: 'guest' },
    )
  }
  async verifyCsrf(token: string, csrf: string, at: string) {
    try {
      const session = await findSession(
        this.env.DB,
        token,
        await authSettings(this.env),
        new Date(at),
        false,
      )
      if (!session) return false
      await checkCsrf(session, csrf)
      return true
    } catch {
      return false
    }
  }
}

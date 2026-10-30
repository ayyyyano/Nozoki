import { now, source } from './adapters.ts'
export { now }
export function cpaSource() {
  return { ...source('cliproxy-bridge'), protocolVersion: 'cliproxy-v8-accounts' }
}
export function credentials() {
  return {
    observed_at: now.toISOString(),
    files: [
      {
        id: 'private-ready@example.invalid',
        auth_index: 'a1',
        provider: 'codex',
        status: 'active',
        disabled: false,
        unavailable: false,
        success: 9,
        failed: 0,
        email: 'private-ready@example.invalid',
        access_token: 'PRIVATE-ACCESS-051',
        refresh_token: 'PRIVATE-REFRESH-051',
        id_token: { secret: 'PRIVATE-IDTOKEN-051' },
        path: 'PRIVATE-PATH-051',
        status_message: 'PRIVATE-MESSAGE-051',
        quota: {
          observed_at: now.toISOString(),
          signals: {
            'X-Codex-Primary-Used-Percent': '25.125',
            'X-Codex-Primary-Reset-At': String(now.getTime() / 1000 + 3600),
          },
        },
      },
      {
        id: 'private-disabled@example.invalid',
        provider: 'codex',
        status: 'disabled',
        disabled: true,
        unavailable: false,
      },
      {
        id: 'private-auth-error@example.invalid',
        provider: 'codex',
        status: 'error',
        disabled: false,
        unavailable: true,
        cooldowns: [
          {
            scope: 'credential',
            reason: 'unauthorized',
            http_status: 401,
            retry_at: new Date(now.getTime() + 60000).toISOString(),
          },
        ],
      },
      {
        id: 'private-pending@example.invalid',
        provider: 'codex',
        status: 'pending',
        disabled: false,
      },
      {
        id: 'private-other@example.invalid',
        provider: 'claude',
        status: 'active',
        disabled: false,
        unavailable: false,
      },
    ],
  }
}

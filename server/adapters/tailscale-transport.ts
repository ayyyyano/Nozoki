import { z } from 'zod'
import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import { AdapterError, type ReadTransport } from './types.ts'
import { boundedReadTransport, type TransportOptions } from './transport.ts'

const secretText = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/)
export const TailscaleCredentialsSchema = z.strictObject({
  clientId: secretText,
  clientSecret: secretText,
})
const tokenResponse = z.object({
  access_token: secretText,
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive().max(86400),
})
const devicesPath = 'api/v2/tailnet/-/devices'

/** Only the fixed official token exchange may POST; it cannot call device management operations. */
export function tailscaleTransport(
  source: IntegrationSettings,
  secret: string | undefined,
  options: TransportOptions,
): ReadTransport {
  if (
    source.provider !== 'tailscale' ||
    source.protocolVersion !== 'tailscale-devices-v2' ||
    source.baseUrl !== 'https://api.tailscale.com/'
  )
    throw new AdapterError('TARGET_NOT_APPROVED')
  if (!secret) throw new AdapterError('AUTH_REQUIRED')
  let client: z.infer<typeof TailscaleCredentialsSchema>
  try {
    client = TailscaleCredentialsSchema.parse(JSON.parse(secret))
  } catch {
    throw new AdapterError('CREDENTIAL_INVALID')
  }
  const wire = options.fetch ?? fetch
  let accessToken: string | undefined
  const bounded = boundedReadTransport(
    ['oauth-token', devicesPath],
    async (endpoint, signal) => {
      options.onRequest?.()
      const isToken = endpoint === 'oauth-token'
      return wire('https://api.tailscale.com/' + (isToken ? 'api/v2/oauth/token' : devicesPath), {
        method: isToken ? 'POST' : 'GET',
        headers: isToken
          ? { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }
          : { Accept: 'application/json', Authorization: 'Bearer ' + accessToken },
        ...(isToken
          ? {
              body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: client.clientId,
                client_secret: client.clientSecret,
                scope: 'devices:core:read',
              }).toString(),
            }
          : {}),
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal,
      })
    },
    options,
    2,
  )
  let used = false
  return {
    async get(endpoint) {
      if (endpoint !== devicesPath) throw new AdapterError('TARGET_NOT_APPROVED')
      if (used) throw new AdapterError('REQUEST_BUDGET')
      used = true
      try {
        const token = tokenResponse.safeParse((await bounded.get('oauth-token')).value)
        if (!token.success) throw new AdapterError('INVALID_RESPONSE')
        accessToken = token.data.access_token
        return await bounded.get(devicesPath)
      } finally {
        accessToken = undefined
        client = { clientId: '', clientSecret: '' }
      }
    },
  }
}

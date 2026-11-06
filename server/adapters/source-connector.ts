import { z } from 'zod'
import {
  IntegrationSettingsSchema,
  type IntegrationSettings,
} from '../../shared/contracts/config.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
import { endpointCatalog, responseTransport, type TransportOptions } from './transport.ts'
import { AdapterError } from './types.ts'
import { hmacKey, mac, hex, randomToken, tokenValid } from '../services/auth-crypto.ts'
import { publicServiceRoot } from './public-targets.ts'
import { selectedAdapter } from './registry.ts'

export const ConnectorMessageSchema = z.strictObject({
  source: IntegrationSettingsSchema,
  endpoint: z.string().min(1).max(512),
  symbols: z
    .array(z.strictObject({ market: z.string().max(16), symbol: z.string().max(32) }))
    .max(20),
  credential: z
    .string()
    .min(1)
    .max(8192)
    .refine((v) => !/[\r\n\u0000]/.test(v))
    .optional(),
})
export const CONNECTOR_BODY_LIMIT = 32768
export function assertManagedSource(source: IntegrationSettings) {
  const access = source.access
  if (!source.enabled) throw new AdapterError('SOURCE_DISABLED')
  if (
    !access ||
    access.mode === 'legacy' ||
    !access.approved ||
    access.approvedTarget !== sourceTargetKey(source, access)
  )
    throw new AdapterError('ACCESS_NOT_APPROVED')
  if (
    (source.provider === 'tailscale') !== (access.authentication === 'tailscale-oauth') ||
    (access.authentication === 'tailscale-oauth' &&
      (access.mode !== 'public' ||
        source.baseUrl !== 'https://api.tailscale.com/' ||
        source.protocolVersion !== 'tailscale-devices-v2'))
  )
    throw new AdapterError('UNSUPPORTED_PROTOCOL')
  selectedAdapter(source)
  return access
}
export function connectorReady(env: Record<string, unknown>): boolean {
  return (
    typeof env.NOZOKI_CONNECTOR_TOKEN === 'string' &&
    tokenValid(env.NOZOKI_CONNECTOR_TOKEN) &&
    (typeof (env.NOZOKI_SOURCE_CONNECTOR as { fetch?: unknown })?.fetch === 'function' ||
      typeof env.NOZOKI_CONNECTOR_URL === 'string')
  )
}
export function connectorTransport(
  source: IntegrationSettings,
  credential: string | undefined,
  env: Record<string, unknown>,
  options: TransportOptions = {},
) {
  const access = assertManagedSource(source)
  if (access.authentication === 'tailscale-oauth') throw new AdapterError('UNSUPPORTED_PROTOCOL')
  if (!connectorReady(env)) throw new AdapterError('CONNECTOR_UNAVAILABLE')
  if (access.authentication === 'bearer' && !credential) throw new AdapterError('AUTH_REQUIRED')
  const binding = env.NOZOKI_SOURCE_CONNECTOR as
    { fetch(input: Request): Promise<Response> } | undefined
  let url = 'https://nozoki-connector.internal/v1/read'
  if (!binding) {
    try {
      url = new URL('v1/read', publicServiceRoot(String(env.NOZOKI_CONNECTOR_URL))).href
    } catch {
      throw new AdapterError('CONNECTOR_UNAVAILABLE')
    }
  }
  return responseTransport(
    source,
    async (endpoint, signal) => {
      const body = JSON.stringify({
        source,
        endpoint,
        symbols: options.quoteSymbols ?? [],
        ...(access.authentication === 'bearer' ? { credential } : {}),
      })
      if (new TextEncoder().encode(body).length > CONNECTOR_BODY_LIMIT)
        throw new AdapterError('REQUEST_BUDGET')
      const timestamp = String(Date.now()),
        nonce = randomToken()
      const signature = hex(
        await mac(await hmacKey(String(env.NOZOKI_CONNECTOR_TOKEN)), [
          'nozoki-connector-v1',
          timestamp,
          nonce,
          body,
        ]),
      )
      options.onRequest?.()
      const request = new Request(url, {
        method: 'POST',
        body,
        signal,
        redirect: 'manual',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          'X-Nozoki-Time': timestamp,
          'X-Nozoki-Nonce': nonce,
          'X-Nozoki-Signature': signature,
        },
      })
      const response = await (binding ? binding.fetch(request) : fetch(request))
      const code = response.headers.get('X-Nozoki-Connector-Error')
      if (code) {
        void response.body?.cancel()
        if (code === 'DESTINATION_BLOCKED') throw new AdapterError('DESTINATION_BLOCKED')
        if (code === 'RATE_LIMITED') throw new AdapterError('RATE_LIMITED', 60)
        throw new AdapterError('CONNECTOR_UNAVAILABLE')
      }
      return response
    },
    {
      ...options,
      timeoutMs: options.timeoutMs ?? (source.provider === 'quotes-custom' ? 10000 : 3500),
    },
  )
}
export function validateConnectorMessage(value: unknown) {
  const message = ConnectorMessageSchema.parse(value)
  const access = assertManagedSource(message.source)
  if (access.authentication === 'tailscale-oauth') throw new AdapterError('UNSUPPORTED_PROTOCOL')
  if (!endpointCatalog(message.source, message.symbols).includes(message.endpoint))
    throw new AdapterError('TARGET_NOT_APPROVED')
  if (access.authentication === 'none' && message.credential !== undefined)
    throw new AdapterError('CREDENTIAL_INVALID')
  if (access.authentication === 'bearer' && !message.credential)
    throw new AdapterError('AUTH_REQUIRED')
  return message
}

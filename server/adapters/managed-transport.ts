import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import { managedServiceRoot } from '../../shared/contracts/source-access.ts'
import { assertManagedSource, connectorReady, connectorTransport } from './source-connector.ts'
import { responseTransport, serviceEndpoint, type TransportOptions } from './transport.ts'
import { AdapterError } from './types.ts'
import { tailscaleTransport } from './tailscale-transport.ts'

// Runtime detection is independent of source configuration and deployment variables.
export function workerPublicEgress(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
}

export function managedEgressStatus(env: Record<string, unknown>) {
  const worker = workerPublicEgress()
  return {
    configured: worker || connectorReady(env),
    publicMode: worker ? 'worker' : connectorReady(env) ? 'connector' : 'unavailable',
    privateConfigured: !worker && connectorReady(env),
  }
}

export function managedTransport(
  source: IntegrationSettings,
  credential: string | undefined,
  env: Record<string, unknown>,
  options: TransportOptions = {},
) {
  const access = assertManagedSource(source)
  if (access.authentication === 'tailscale-oauth') {
    const wire =
      options.fetch ??
      (workerPublicEgress() ? fetch : (env.NOZOKI_TAILSCALE_FETCH as typeof fetch | undefined))
    if (typeof wire !== 'function') throw new AdapterError('CONNECTOR_UNAVAILABLE')
    return tailscaleTransport(source, credential, { ...options, fetch: wire })
  }
  if (!workerPublicEgress()) return connectorTransport(source, credential, env, options)
  // Workers' public fetch network filters resolved addresses at connection time.
  // Never route private-mode sources or use a connector binding through this path.
  if (access.mode !== 'public') throw new AdapterError('DESTINATION_BLOCKED')
  if (!source.baseUrl) throw new AdapterError('NOT_CONFIGURED')
  const root = managedServiceRoot(source.baseUrl, 'public')
  if (access.authentication === 'bearer' && !credential) throw new AdapterError('AUTH_REQUIRED')
  if (access.authentication === 'bearer' && /[\r\n\u0000]/.test(credential!))
    throw new AdapterError('CREDENTIAL_INVALID')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (access.authentication === 'bearer') headers.Authorization = 'Bearer ' + credential
  const wire = options.fetch ?? fetch
  return responseTransport(
    source,
    (endpoint, signal) => {
      const url = serviceEndpoint(root, endpoint)
      options.onRequest?.()
      return wire(url, {
        method: 'GET',
        headers,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal,
      })
    },
    {
      ...options,
      timeoutMs: options.timeoutMs ?? (source.provider === 'quotes-custom' ? 10000 : 3500),
    },
  )
}

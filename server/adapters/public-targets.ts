import { z } from 'zod'
import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import { normalizeServiceTarget } from '../services/service-target.ts'
import { AdapterError } from './types.ts'

const PublicRoute = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  provider: z.enum(['deepseek', 'sleepy', 'uptime-kuma', 'uptimeflare', 'quotes-custom']),
  protocolVersion: z.string().min(1).max(64),
  baseUrl: z.string().max(2048),
  authentication: z.enum(['none', 'bearer']),
})
const Routes = z
  .array(PublicRoute)
  .max(10)
  .refine((routes) => new Set(routes.map((route) => route.id)).size === routes.length)
export interface PublicTarget {
  baseUrl: string
  authentication: 'none' | 'bearer'
}
/** Fixed, reviewed public services. Editable source metadata cannot extend this list. */
export const PUBLIC_SERVICES = [
  {
    provider: 'deepseek',
    protocolVersion: 'deepseek-balance-v1',
    baseUrl: 'https://api.deepseek.com/',
    authentication: 'bearer',
  },
] as const

export function publicServiceRoot(value: string): string {
  try {
    // Preserve the existing strict service-directory rules before WHATWG normalization.
    if (!/^https:\/\//i.test(value) || /[%\\\s]/.test(value)) throw new Error()
    const rawPath = value.replace(/^https:\/\/[^/]+/i, '')
    if (
      !/^(?:\/[A-Za-z0-9._~-]+)*\/?$/.test(rawPath) ||
      rawPath.split('/').some((part) => part === '.' || part === '..')
    )
      throw new Error()
    const root = normalizeServiceTarget(value)!
    const url = new URL(root)
    // No IP literals, nonstandard ports, single-label or reserved local host names.
    if (
      url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|onion|arpa)$/.test(url.hostname)
    )
      throw new Error()
    return root
  } catch {
    throw new AdapterError('TARGET_NOT_APPROVED')
  }
}

/** Deployment-owned exact targets: trust the approved service operator and its DNS.
 * This is not DNS/IP pinning. Never populate routes from HTTP bodies or editable D1 config.
 * Private or untrusted DNS destinations still require the constrained Relay.
 */
export function publicTarget(
  source: IntegrationSettings,
  env: Record<string, unknown> = {},
): PublicTarget | undefined {
  let routes: z.infer<typeof Routes> = []
  if (env.NOZOKI_PUBLIC_ROUTES !== undefined) {
    try {
      const raw = env.NOZOKI_PUBLIC_ROUTES
      if (typeof raw !== 'string' || raw.length > 16384) throw new Error()
      routes = Routes.parse(JSON.parse(raw))
      for (const route of routes) publicServiceRoot(route.baseUrl)
    } catch {
      throw new AdapterError('TARGET_NOT_APPROVED')
    }
  }
  const route = routes.find((item) => item.id === source.id)
  if (route) {
    const baseUrl = publicServiceRoot(route.baseUrl)
    if (
      source.provider !== route.provider ||
      source.protocolVersion !== route.protocolVersion ||
      !source.baseUrl ||
      publicServiceRoot(source.baseUrl) !== baseUrl
    )
      throw new AdapterError('TARGET_NOT_APPROVED')
    return { baseUrl, authentication: route.authentication }
  }
  const builtin = PUBLIC_SERVICES.find(
    (item) =>
      item.provider === source.provider &&
      item.protocolVersion === source.protocolVersion &&
      source.baseUrl &&
      publicServiceRoot(source.baseUrl) === item.baseUrl,
  )
  return builtin ? { baseUrl: builtin.baseUrl, authentication: builtin.authentication } : undefined
}

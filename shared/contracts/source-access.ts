import { z } from 'zod'

export const SourceAccessSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('legacy') }),
  z.strictObject({
    mode: z.enum(['public', 'private']),
    approved: z.boolean(),
    approvedTarget: z.string().max(3000).nullable().default(null),
    authentication: z.enum(['none', 'bearer']),
  }),
])
export type SourceAccess = z.infer<typeof SourceAccessSchema>
export function sourceTargetKey(
  source: { id: string; provider: string; protocolVersion: string; baseUrl: string | null },
  access: Exclude<SourceAccess, { mode: 'legacy' }>,
): string {
  return JSON.stringify([
    source.id,
    source.provider,
    source.protocolVersion,
    access.mode,
    access.authentication,
    source.baseUrl ? managedServiceRoot(source.baseUrl, access.mode) : null,
  ])
}

/** HTTPS service directory; the platform transport enforces resolved-address restrictions. */
export function managedServiceRoot(value: string, scope: 'public' | 'private'): string {
  if (!/^https:\/\//i.test(value) || /[%\\\s]/.test(value)) throw new Error('INVALID_SOURCE_TARGET')
  const rawPath = value.replace(/^https:\/\/[^/]+/i, '')
  if (
    !/^(?:\/[A-Za-z0-9._~-]+)*\/?$/.test(rawPath) ||
    rawPath.split('/').some((p) => p === '.' || p === '..')
  )
    throw new Error('INVALID_SOURCE_TARGET')
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('INVALID_SOURCE_TARGET')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost'))
    throw new Error('INVALID_SOURCE_TARGET')
  if (
    scope === 'public' &&
    (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname) ||
      /(?:^|\.)(?:local|internal|home|lan|test|invalid|onion|arpa)$/.test(hostname))
  )
    throw new Error('INVALID_SOURCE_TARGET')
  url.pathname = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/'
  return url.href
}

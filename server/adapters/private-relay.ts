import { z } from 'zod'
import { IntegrationSettingsSchema, CapabilitySchema } from '../../shared/contracts/config.ts'
import { AdapterCodeSchema } from '../../shared/contracts/adapter.ts'
import { snapshotSchema } from '../../shared/contracts/snapshots.ts'
import type { ModuleId } from '../../shared/contracts/dashboard.ts'
import type { AdapterRead } from './types.ts'
import { AdapterError } from './types.ts'
import { normalizeServiceTarget } from '../services/service-target.ts'
import {
  responseTransport,
  boundedReadTransport,
  serviceEndpoint,
  RESPONSE_LIMIT,
} from './transport.ts'
import { runAdapter, selectedAdapter } from './registry.ts'
import { hmacKey, mac, verifyMac, tokenValid } from '../services/auth-crypto.ts'
import { stampISO } from './common.ts'
import { canonical } from '../../shared/contracts/admin.ts'
import { hashToken } from '../services/auth-crypto.ts'
const Provider = z.enum(['sleepy', 'cliproxy-bridge', 'uptime-kuma', 'uptimeflare'])
// Deployment-owned routes are independent of the editable D1 metadata.
const Routes = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      provider: Provider,
      protocolVersion: z.string().min(1).max(64),
      baseUrl: z.string().max(2048),
      refreshInterval: z.number().int().min(60).max(86400),
      fieldMappings: z.record(z.string(), z.string()),
      identityVersion: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    }),
  )
  .max(10)
  .refine((v) => new Set(v.map((x) => x.id)).size === v.length)
const allowedViews: Record<string, ModuleId> = {
  sleepy: 'devices',
  'cliproxy-bridge': 'codex',
  'uptime-kuma': 'services',
  uptimeflare: 'services',
}
const Envelope = z.strictObject({
  contractVersion: z.literal(1),
  nonce: z.uuid(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  identityVersion: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  target: z.string().max(2048),
  sourceId: z.string().max(64),
  provider: Provider,
  protocolVersion: z.string().max(64),
  status: z.enum(['ok', 'stale', 'error', 'unconfigured', 'unsupported', 'offline']),
  capabilities: z.record(z.string().max(64), CapabilitySchema),
  observedAt: z.string().nullable(),
  collectedAt: z.string(),
  items: z.number().int().min(0).max(200),
  views: z.record(z.string(), z.unknown()),
  code: AdapterCodeSchema.optional(),
  retryAfterSeconds: z.number().int().min(1).max(31536000).optional(),
})
type Source = z.infer<typeof IntegrationSettingsSchema>
type Fetcher = { fetch(input: Request | string, init?: RequestInit): Promise<Response> }
export function privateRoute(source: Source) {
  return {
    id: source.id,
    provider: source.provider,
    protocolVersion: source.protocolVersion,
    baseUrl: normalizeServiceTarget(source.baseUrl),
    refreshInterval: source.refreshInterval,
    fieldMappings: source.fieldMappings,
  }
}
export function privatePlan(source: Source, env: Record<string, unknown>) {
  try {
    if (typeof env.NOZOKI_PRIVATE_ROUTES !== 'string' || env.NOZOKI_PRIVATE_ROUTES.length > 16384)
      throw new Error()
    const routes = Routes.parse(JSON.parse(env.NOZOKI_PRIVATE_ROUTES)),
      route = routes.find((r) => r.id === source.id)
    const { identityVersion, ...settings } = route ?? {}
    if (
      !route ||
      canonical({ ...settings, baseUrl: normalizeServiceTarget(route.baseUrl) }) !==
        canonical(privateRoute(source))
    )
      throw new Error()
    if (source.protocolVersion === 'cliproxy-v8-accounts' && !identityVersion) throw new Error()
    serviceEndpoint(route.baseUrl, 'probe')
    const binding = env.NOZOKI_PRIVATE_RELAY as Fetcher | undefined,
      token = env.NOZOKI_PRIVATE_RELAY_TOKEN
    if (
      !binding ||
      typeof binding.fetch !== 'function' ||
      typeof token !== 'string' ||
      !tokenValid(token)
    )
      throw new Error()
    return { binding, token, identityVersion: identityVersion ?? null }
  } catch {
    throw new AdapterError('TARGET_NOT_APPROVED')
  }
}
export async function readPrivateSource(
  source: Source,
  env: Record<string, unknown>,
  mode: 'probe' | 'read',
  now = new Date(),
  options: { signal?: AbortSignal; onRead?: (bytes: number) => void } = {},
): Promise<AdapterRead> {
  const { binding, token, identityVersion } = privatePlan(source, env),
    nonce = crypto.randomUUID()
  // Reuse the bounded JSON/timeout/redirect machinery. No hostname fetch is performed here.
  const transport = boundedReadTransport(
    ['probe', 'read'],
    (_endpoint, signal) =>
      binding.fetch(`http://nozoki-private.internal/v1/sources/${source.id}/${mode}`, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
          'X-Nozoki-Request': nonce,
        },
        signal,
      }),
    { timeoutMs: 8500, ...options },
  )
  const { value } = await transport.get(mode),
    parsed = Envelope.safeParse(value)
  if (!parsed.success) throw new AdapterError('INVALID_RESPONSE')
  const e = parsed.data
  if (
    e.nonce !== nonce ||
    e.sourceId !== source.id ||
    e.provider !== source.provider ||
    e.protocolVersion !== source.protocolVersion ||
    e.target !== normalizeServiceTarget(source.baseUrl) ||
    e.revision !== (await hashToken(canonical(privateRoute(source)))) ||
    e.identityVersion !== identityVersion
  )
    throw new AdapterError('INVALID_RESPONSE')
  const collectedAt = stampISO(e.collectedAt)
  if (Math.abs(Date.parse(collectedAt) - now.getTime()) > 60000)
    throw new AdapterError('INVALID_RESPONSE')
  const views: AdapterRead['views'] = {}
  for (const [id, raw] of Object.entries(e.views)) {
    if (id !== allowedViews[source.provider]) throw new AdapterError('INVALID_RESPONSE')
    const view = snapshotSchema(id as ModuleId).safeParse(raw)
    if (!view.success || view.data.sourceId !== source.id)
      throw new AdapterError('INVALID_RESPONSE')
    Object.assign(views, { [id]: view.data })
  }
  const capabilities = Object.fromEntries(
    Object.entries(e.capabilities).map(([id, c]) => [
      id,
      { supported: c.supported, verified: c.verified },
    ]),
  )
  return {
    sourceId: e.sourceId,
    provider: e.provider,
    protocolVersion: e.protocolVersion,
    status: e.status,
    capabilities,
    observedAt: e.observedAt === null ? null : stampISO(e.observedAt),
    collectedAt,
    items: e.items,
    views,
    ...(e.code ? { code: e.code } : {}),
    ...(e.retryAfterSeconds ? { retryAfterSeconds: e.retryAfterSeconds } : {}),
  }
}
export interface RelaySource {
  source: Source
  credential?: string
}
/** Runs next to the upstream services. Static operator configuration is the sole target authority. */
export async function createPrivateRelay(
  entries: RelaySource[],
  token: string,
  wire: typeof fetch = fetch,
  identitySecret?: string,
) {
  if (
    !tokenValid(token) ||
    entries.length > 10 ||
    new Set(entries.map((e) => e.source.id)).size !== entries.length
  )
    throw new Error('INVALID_RELAY_CONFIGURATION')
  const hasAccounts = entries.some((e) => e.source.protocolVersion === 'cliproxy-v8-accounts')
  if (hasAccounts && (!identitySecret || !tokenValid(identitySecret) || identitySecret === token))
    throw new Error('STABLE_RELAY_IDENTITY_KEY_REQUIRED')
  const key = await hmacKey(token),
    tag = new Uint8Array(await mac(key, ['nozoki-relay-token-v1', token]))
  const identityKey = hasAccounts ? await hmacKey(identitySecret!) : key
  const identityVersion = hasAccounts ? await hashToken(identitySecret!) : null
  const sources = new Map(
    entries.map((entry) => {
      const source = IntegrationSettingsSchema.parse(entry.source)
      if (!Provider.safeParse(source.provider).success) throw new Error('INVALID_RELAY_PROVIDER')
      selectedAdapter(source)
      if (source.baseUrl) serviceEndpoint(source.baseUrl, 'probe')
      if (
        entry.credential !== undefined &&
        (typeof entry.credential !== 'string' ||
          entry.credential.length > 8192 ||
          /[\r\n\u0000]/.test(entry.credential))
      )
        throw new Error('INVALID_RELAY_CREDENTIAL')
      return [source.id, { source, credential: entry.credential }] as const
    }),
  )
  let active = 0
  return async (request: Request): Promise<Response> => {
    const reject = (status: number) =>
      Response.json(
        { code: 'RELAY_REJECTED' },
        { status, headers: { 'Cache-Control': 'no-store' } },
      )
    const url = new URL(request.url),
      match = /^\/v1\/sources\/([a-zA-Z0-9_-]{1,64})\/(probe|read)$/.exec(url.pathname)
    if (
      request.method !== 'GET' ||
      url.search ||
      url.hash ||
      !match ||
      request.headers.has('origin')
    )
      return reject(400)
    const supplied = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
    if (!tokenValid(supplied) || !(await verifyMac(key, ['nozoki-relay-token-v1', supplied], tag)))
      return reject(401)
    const nonce = request.headers.get('X-Nozoki-Request') ?? ''
    if (!z.uuid().safeParse(nonce).success) return reject(400)
    const entry = sources.get(match[1]!)
    if (!entry) return reject(404)
    if (active >= 2) return reject(429)
    active++
    try {
      const { source, credential } = entry
      const transport = responseTransport(
        source,
        (endpoint, signal) => {
          if (!source.baseUrl || !source.enabled) throw new AdapterError('SOURCE_DISABLED')
          if (source.provider === 'cliproxy-bridge' && !credential)
            throw new AdapterError('AUTH_REQUIRED')
          return wire(serviceEndpoint(source.baseUrl, endpoint), {
            method: 'GET',
            redirect: 'manual',
            credentials: 'omit',
            headers: {
              Accept: 'application/json',
              ...(source.provider === 'cliproxy-bridge'
                ? { Authorization: 'Bearer ' + credential }
                : {}),
            },
            signal,
          })
        },
        { signal: request.signal },
      )
      const result = await runAdapter(
        { source, transport, now: new Date(), identityKey },
        match[2] as 'probe' | 'read',
      )
      const { facts: _facts, ...safe } = result
      const body = JSON.stringify({
        ...safe,
        contractVersion: 1,
        nonce,
        revision: await hashToken(canonical(privateRoute(source))),
        identityVersion: source.protocolVersion === 'cliproxy-v8-accounts' ? identityVersion : null,
        target: normalizeServiceTarget(source.baseUrl),
      })
      if (new TextEncoder().encode(body).length > RESPONSE_LIMIT) return reject(502)
      return new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
      })
    } catch {
      return reject(502)
    } finally {
      active--
    }
  }
}

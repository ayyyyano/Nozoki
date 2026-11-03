import { z } from 'zod'
import { CapabilitySchema, IdSchema, UtcSchema } from './config.ts'
export const ADAPTER_PROTOCOLS = {
  deepseek: ['deepseek-balance-v1'],
  'deepseek-spend': [],
  sleepy: ['sleepy-v5-status'],
  tailscale: ['tailscale-devices-v2'],
  'cliproxy-bridge': ['cliproxy-v8-toggle', 'cliproxy-v8-accounts'],
  'uptime-kuma': ['kuma-public-2.0.2'],
  uptimeflare: ['uptimeflare-data-2024'],
  'quotes-custom': ['tencent-us-v1', 'yahoo-chart-v8'],
} as const
export function defaultProtocol(provider: keyof typeof ADAPTER_PROTOCOLS): string {
  if (provider === 'cliproxy-bridge') return 'cliproxy-v8-accounts'
  return ADAPTER_PROTOCOLS[provider][0] ?? 'unverified'
}
export const AdapterCodeSchema = z.enum([
  'NOT_CONFIGURED',
  'SOURCE_DISABLED',
  'UNSUPPORTED_PROTOCOL',
  'TARGET_NOT_APPROVED',
  'ACCESS_NOT_APPROVED',
  'CONNECTOR_UNAVAILABLE',
  'DESTINATION_BLOCKED',
  'AUTH_REQUIRED',
  'CREDENTIAL_UNAVAILABLE',
  'CREDENTIAL_INVALID',
  'TIMEOUT',
  'ABORTED',
  'REDIRECT_REJECTED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'UPSTREAM_UNAVAILABLE',
  'INVALID_RESPONSE',
  'RESPONSE_TOO_LARGE',
  'REQUEST_BUDGET',
  'SOURCE_CHANGED',
])
export type AdapterCode = z.infer<typeof AdapterCodeSchema>
export const ProbeResultSchema = z.strictObject({
  sourceId: IdSchema,
  provider: z.string().max(64),
  protocolVersion: z.string().max(64),
  configVersion: z.number().int().min(1),
  status: z.enum(['ok', 'stale', 'error', 'unconfigured', 'unsupported', 'offline']),
  reachable: z.boolean().nullable(),
  protocolMatched: z.boolean(),
  authentication: z.enum(['accepted', 'not_required', 'rejected', 'unverified']),
  capabilities: z.record(z.string().max(64), CapabilitySchema),
  observedAt: UtcSchema.nullable(),
  collectedAt: UtcSchema,
  code: AdapterCodeSchema.optional(),
  retryAfterSeconds: z.number().int().min(1).max(31536000).optional(),
  summary: z.strictObject({
    items: z.number().int().min(0).max(10000),
    views: z.number().int().min(0).max(8),
  }),
})
export type ProbeResult = z.infer<typeof ProbeResultSchema>

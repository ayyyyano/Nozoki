import { z } from 'zod'
import { COLLECTION_CODES } from '../collection/policy.ts'
import {
  CapabilitySchema,
  DaySchema,
  DecimalSchema,
  HttpsSchema,
  LinkSettingsSchema,
  ScheduleSchema,
  UtcSchema,
} from './config.ts'
import type { ModuleId } from './dashboard.ts'
const caps = z.record(z.string().max(64), CapabilitySchema)
const text = z.string().max(500)
const stamp = UtcSchema.nullable()
const decimal = DecimalSchema.nullable()
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const currency = z.string().regex(/^[A-Z]{3}$/)
const quote = z.strictObject({
  market: text,
  symbol: text,
  provider: text.nullable(),
  currency: currency.nullable(),
  name: text,
  price: decimal,
  previousClose: decimal,
  change: decimal,
  changePercent: decimal,
  amplitudePercent: decimal,
  volume: decimal,
  volumeUnit: text.nullable(),
  asOf: stamp,
  delayedMinutes: count.nullable(),
  history: z.array(z.strictObject({ at: UtcSchema, close: DecimalSchema })).max(500),
  capabilities: caps,
})
export const DataSchemas = {
  deepseek: z.strictObject({
    balances: z
      .array(
        z.strictObject({
          currency,
          total: DecimalSchema,
          toppedUp: DecimalSchema,
          granted: DecimalSchema,
        }),
      )
      .max(20),
    spend: z
      .array(z.strictObject({ day: DaySchema, currency, amount: DecimalSchema, sourceId: text }))
      .max(500),
    capabilities: z.strictObject({ balance: CapabilitySchema, spend: CapabilitySchema }),
  }),
  devices: z.strictObject({
    devices: z
      .array(
        z.strictObject({
          id: text,
          name: text,
          using: z.boolean().nullable(),
          stateText: z.string().max(4096).nullable(),
          foregroundApp: z.string().max(4096).nullable().optional(),
          online: z.boolean().nullable(),
          batteryPercent: z.number().min(0).max(100).nullable(),
          charging: z.boolean().nullable(),
          observedAt: stamp,
          heartbeatAt: stamp,
          statusUpdatedAt: stamp.optional(),
          capabilities: caps,
        }),
      )
      .max(100),
  }),
  tailscale: z.strictObject({
    devices: z
      .array(
        z.strictObject({
          id: text,
          name: text,
          connectedToControl: z.boolean().nullable(),
          lastSeen: stamp,
          addresses: z.array(z.union([z.ipv4(), z.ipv6()])).max(10),
        }),
      )
      .max(100),
  }),
  codex: z.strictObject({
    accounts: z
      .array(
        z.strictObject({
          id: text,
          provider: z.literal('codex'),
          state: z.enum([
            'ready',
            'disabled',
            'auth_error',
            'error',
            'cooldown',
            'unavailable',
            'pending',
            'refreshing',
            'unknown',
          ]),
          disabled: z.boolean().nullable(),
          unavailable: z.boolean().nullable(),
          retryAt: stamp,
          observedAt: stamp,
          executionCounts: z
            .strictObject({
              success: count,
              failed: count,
              scope: z.literal('source_runtime'),
              since: z.null(),
            })
            .nullable()
            .optional(),
        }),
      )
      .max(100)
      .optional(),
    usage: z
      .strictObject({
        scope: text,
        coverageStart: stamp,
        days: z
          .array(
            z.strictObject({
              day: DaySchema,
              input: count,
              output: count,
              reasoning: count,
              cached: count,
              total: count,
              requests: count,
              failed: count,
            }),
          )
          .max(500),
      })
      .nullable(),
    quota: z
      .strictObject({
        accounts: z
          .array(
            z.strictObject({
              id: text,
              windows: z
                .array(
                  z.strictObject({
                    id: text,
                    label: text,
                    remainingPercent: decimal,
                    resetAt: stamp,
                    observedAt: stamp.optional(),
                    basis: z.enum(['passive_headers', 'reviewed_plugin']).optional(),
                    status: z.enum(['ok', 'stale']).optional(),
                  }),
                )
                .max(30),
            }),
          )
          .max(100),
      })
      .nullable(),
    estimatedCost: z.strictObject({ currency, amount: DecimalSchema, basis: text }).nullable(),
    capabilities: z.strictObject({
      accounts: CapabilitySchema.optional(),
      executionCounts: CapabilitySchema.optional(),
      usage: CapabilitySchema,
      quota: CapabilitySchema,
      estimatedCost: CapabilitySchema,
    }),
  }),
  activity: z.strictObject({
    schedule: ScheduleSchema,
    resolved: z
      .strictObject({
        phase: text,
        label: text,
        caption: text,
        targetAt: stamp,
        progressPercent: z.number().min(0).max(100),
        restDay: z.boolean(),
      })
      .optional(),
    presence: z.null().optional(),
    music: z.null().optional(),
    gaming: z.null().optional(),
    capabilities: z.strictObject({
      presence: CapabilitySchema,
      music: CapabilitySchema,
      gaming: CapabilitySchema,
    }),
  }),
  quotes: z.strictObject({ items: z.array(quote).max(100) }),
  links: z.strictObject({
    items: z
      .array(
        z.strictObject({
          id: text,
          title: text,
          url: LinkSettingsSchema.shape.url,
          icon: text,
          sortOrder: count,
        }),
      )
      .max(100),
  }),
  services: z.strictObject({
    monitors: z
      .array(
        z.strictObject({
          id: text,
          name: text,
          state: z.enum(['up', 'down', 'maintenance', 'pending', 'unknown']),
          latencyMs: z.number().finite().min(0).nullable(),
          checkedAt: stamp,
          statusPageUrl: HttpsSchema.nullable(),
          uptimePercent: decimal,
          capabilities: caps,
        }),
      )
      .max(200),
  }),
} satisfies Record<ModuleId, z.ZodType>
export function snapshotSchema(id: ModuleId) {
  return z.strictObject({
    status: z.enum(['ok', 'stale', 'error', 'unconfigured', 'unsupported', 'offline']),
    data: DataSchemas[id].nullable(),
    sourceId: text.min(1),
    observedAt: stamp,
    collectedAt: stamp,
    lastSuccessAt: stamp,
    expiresAt: stamp,
    errorCode: z.enum(COLLECTION_CODES).optional(),
    collection: z
      .strictObject({
        status: z.enum(['ok', 'stale', 'error', 'unconfigured', 'unsupported', 'offline']),
        errorCode: z.enum(COLLECTION_CODES).nullable(),
        lastAttemptAt: stamp,
        nextRunAt: UtcSchema,
      })
      .optional(),
  })
}

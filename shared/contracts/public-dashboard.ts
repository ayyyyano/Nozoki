import { z } from 'zod'
import {
  BackgroundSchema,
  ModuleIdSchema,
  SourceColorSchema,
  TimezoneSchema,
  UtcSchema,
} from './config.ts'
const moduleHeader = {
  id: ModuleIdSchema,
  title: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
}
export const PublicDashboardSchema = z.strictObject({
  contractVersion: z.literal(1),
  viewer: z.literal('guest'),
  generatedAt: UtcSchema,
  configVersion: z.string().regex(/^public-v1-[a-f0-9]{64}$/),
  site: z.strictObject({
    siteName: z.string().min(1).max(100),
    timezone: TimezoneSchema,
    appearance: z.strictObject({ design: z.literal('m3'), sourceColor: SourceColorSchema }),
    background: BackgroundSchema,
  }),
  modules: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({ ...moduleHeader, kind: z.literal('login_required') }),
        z.strictObject({
          ...moduleHeader,
          kind: z.literal('data'),
          snapshot: z.strictObject({
            status: z.enum(['ok', 'stale', 'error', 'unconfigured', 'unsupported', 'offline']),
            data: z.json(),
            observedAt: UtcSchema.nullable(),
            collectedAt: UtcSchema.nullable(),
            lastSuccessAt: UtcSchema.nullable(),
            expiresAt: UtcSchema.nullable(),
            errorCode: z.string().max(64).optional(),
            collection: z
              .strictObject({
                status: z.enum(['ok', 'stale', 'error', 'unconfigured', 'unsupported', 'offline']),
                errorCode: z.string().max(64).nullable(),
                lastAttemptAt: UtcSchema.nullable(),
                nextRunAt: UtcSchema,
              })
              .optional(),
          }),
        }),
      ]),
    )
    .max(8),
  summary: z.strictObject({
    services: z
      .strictObject({ up: z.number().int().min(0), down: z.number().int().min(0) })
      .optional(),
  }),
})
export type PublicDashboard = z.infer<typeof PublicDashboardSchema>
export const AdminDashboardSchema = PublicDashboardSchema.extend({
  viewer: z.literal('admin'),
  configVersion: z.number().int().min(1),
})
export type AdminDashboard = z.infer<typeof AdminDashboardSchema>

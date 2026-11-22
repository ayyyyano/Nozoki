import { z } from 'zod'
import { UtcSchema } from './config.ts'

export const HISTORY_HOURS = 12
export const HOME_HISTORY_SEGMENTS = [12, 16] as const
export const HISTORY_SAMPLE_LIMIT = 720
export const MonitorStateSchema = z.enum(['up', 'down', 'pending', 'maintenance', 'unknown'])
export const MonitorHistoryPointSchema = z.strictObject({
  at: UtcSchema,
  state: MonitorStateSchema.nullable(),
  latencyMs: z.number().finite().nonnegative().nullable(),
})
export type MonitorHistoryPoint = z.infer<typeof MonitorHistoryPointSchema>
export interface MonitorHistory {
  kind: 'heartbeat' | 'observation'
  intervalSeconds: number | null
  showStatus: boolean
  showLatency: boolean
  until?: string
  points: MonitorHistoryPoint[]
}

export type HistoryStatus = NonNullable<MonitorHistoryPoint['state']> | 'missing'
export interface HomeMonitorHistory {
  id: string
  segments: Record<(typeof HOME_HISTORY_SEGMENTS)[number], HistoryStatus[]>
}

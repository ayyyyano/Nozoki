import { z } from 'zod'
import { snapshotSchema } from '../../shared/contracts/snapshots.ts'
import type { ModuleId } from '../../shared/contracts/dashboard.ts'
import type { AdapterContext, AdapterRead, Views } from './types.ts'
import { AdapterError } from './types.ts'
export const cap = (supported: boolean, verified = false) => ({ supported, verified })
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AdapterError('INVALID_RESPONSE')
  return result.data
}
export const sourceResult = (
  context: AdapterContext,
  capabilities: AdapterRead['capabilities'],
): AdapterRead => ({
  sourceId: context.source.id,
  provider: context.source.provider,
  protocolVersion: context.source.protocolVersion,
  status: 'ok',
  capabilities,
  observedAt: null,
  collectedAt: context.now.toISOString(),
  views: {},
  items: 0,
})
export function stampSeconds(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 253402300799)
    throw new AdapterError('INVALID_RESPONSE')
  return new Date(Math.round(value * 1000)).toISOString()
}
export function stampISO(value: string): string {
  parse(z.iso.datetime({ offset: true }), value)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new AdapterError('INVALID_RESPONSE')
  return date.toISOString()
}
export function staleAt(
  observedAt: string | null,
  context: AdapterContext,
  age: number | null = 0,
) {
  if (observedAt && Date.parse(observedAt) > context.now.getTime() + 60000)
    throw new AdapterError('INVALID_RESPONSE')
  return (
    (observedAt !== null &&
      context.now.getTime() - Date.parse(observedAt) >
        Math.max(600, context.source.refreshInterval * 2) * 1000) ||
    (age ?? 0) > Math.max(600, context.source.refreshInterval * 2)
  )
}
export function putView(result: AdapterRead, module: ModuleId, data: unknown) {
  const value = snapshotSchema(module).safeParse({
    status: result.status,
    data,
    sourceId: result.sourceId,
    observedAt: result.observedAt,
    collectedAt: result.collectedAt,
    lastSuccessAt: result.collectedAt,
    expiresAt: null,
  })
  if (!value.success) throw new AdapterError('INVALID_RESPONSE')
  Object.assign(result.views, { [module]: value.data } as Views)
}

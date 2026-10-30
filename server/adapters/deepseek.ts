import { z } from 'zod'
import { DecimalSchema } from '../../shared/contracts/config.ts'
import { cap, parse, putView, sourceResult } from './common.ts'
import type { Adapter, AdapterContext } from './types.ts'
import { ADAPTER_PROTOCOLS } from '../../shared/contracts/adapter.ts'
const ResponseSchema = z
  .object({
    is_available: z.boolean(),
    balance_infos: z
      .array(
        z.object({
          currency: z.enum(['CNY', 'USD']),
          total_balance: DecimalSchema,
          granted_balance: DecimalSchema,
          topped_up_balance: DecimalSchema,
        }),
      )
      .max(20),
  })
  .refine((v) => new Set(v.balance_infos.map((b) => b.currency)).size === v.balance_infos.length)
async function read(context: AdapterContext) {
  const response = await context.transport.get('user/balance'),
    value = parse(ResponseSchema, response.value)
  const result = sourceResult(context, { balance: cap(true, true), spend: cap(false) })
  // This API has no account-observation timestamp; collection time is not invented as observation time.
  result.facts = { isAvailable: value.is_available }
  result.items = value.balance_infos.length
  if ((response.ageSeconds ?? 0) > context.source.refreshInterval * 2) result.status = 'stale'
  putView(result, 'deepseek', {
    balances: value.balance_infos.map((b) => ({
      currency: b.currency,
      total: b.total_balance,
      granted: b.granted_balance,
      toppedUp: b.topped_up_balance,
    })),
    spend: [],
    capabilities: result.capabilities,
  })
  return result
}
export const deepseek: Adapter = {
  provider: 'deepseek',
  versions: ADAPTER_PROTOCOLS.deepseek,
  expectedCapabilities: ['balance', 'spend'],
  probe: read,
  read,
}

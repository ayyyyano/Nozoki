import type { Database } from '../types/database.ts'
import { usageCutoff, type UsageDay } from '../adapters/codex-usage.ts'
export async function readCodexUsageDays(
  db: Database,
  sourceId: string,
  now: Date,
): Promise<UsageDay[]> {
  return (
    await db
      .prepare(
        'SELECT day,input,output,reasoning,cached,total,requests,failed FROM codex_usage_days WHERE source_id=? AND day>=? ORDER BY day LIMIT 500',
      )
      .bind(sourceId, usageCutoff(now))
      .all()
  ).results as unknown as UsageDay[]
}

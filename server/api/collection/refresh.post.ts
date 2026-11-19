import {
  authEndpoint,
  boundedJson,
  environment,
  assertOrigin,
  trustedSource,
} from '../../utils/auth-http.ts'
import { authSettings } from '../../services/auth-settings.ts'
import { getDatabase } from '../../utils/database.ts'
import { isManualRefreshModule, refreshModuleCollection } from '../../collection/manual.ts'

/**
 * Per-client throttle for the manual "refresh now" action. Keyed by a coarse source
 * bucket plus card id so an anonymous visitor cannot hammer upstreams or D1 by tapping
 * one card repeatedly. This is defence in depth: runCollection's lease/budget and the
 * browser-side per-card throttle remain the primary guards.
 */
const COOLDOWN_MS = 15000
const lastRefresh = new Map<string, number>()
const REFRESH_BODY_LIMIT = 512

/** Drop stale keys so the map cannot grow without bound over a long-lived isolate. */
function prune(now: number) {
  for (const [key, at] of lastRefresh) if (now - at >= COOLDOWN_MS) lastRefresh.delete(key)
}

export default authEndpoint(async (event) => {
  const settings = await authSettings(environment(event))
  // Browser calls only: reject cross-site/forged submissions before doing any work.
  assertOrigin(event, settings)
  const body = await boundedJson(event, REFRESH_BODY_LIMIT)
  const requested =
    body && typeof body === 'object' ? (body as { moduleId?: unknown }).moduleId : undefined
  if (!isManualRefreshModule(requested))
    return { ok: false, code: 'INVALID_MODULE', message: '无效的刷新目标' }

  const now = Date.now()
  prune(now)
  const key = `${trustedSource(event, settings)}:${requested}`
  const previous = lastRefresh.get(key)
  if (previous !== undefined && now - previous < COOLDOWN_MS)
    return {
      ok: false,
      code: 'TOO_SOON',
      retryAfterMs: COOLDOWN_MS - (now - previous),
      message: '刷新太频繁，请稍后再试',
    }
  // Claim the slot before the async work so concurrent taps in the same window coalesce.
  lastRefresh.set(key, now)

  const env = environment(event)
  const report = await refreshModuleCollection(getDatabase(event), env, requested)
  const collected = report.selected > 0
  return {
    ok: true,
    moduleId: requested,
    requestedSources: report.sources,
    collected: report.selected,
    success: report.success,
    failure: report.failure,
    skipped: report.skipped,
    message:
      report.sources === 0
        ? '该卡片暂无可采集的来源'
        : !collected
          ? '采集已在执行中，未重复启动'
          : report.failure > 0
            ? `采集完成：成功 ${report.success} 项，失败 ${report.failure} 项`
            : `采集完成：成功 ${report.success} 项`,
  }
})

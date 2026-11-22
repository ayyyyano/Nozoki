import { getDatabase } from '../utils/database.ts'
import { identity } from '../utils/auth-http.ts'
import { readHomeServiceHistory, readServiceHistory } from '../services/dashboard.ts'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Vary', 'Cookie')
  const { monitor, view } = getQuery(event)
  try {
    if (view === 'home' && monitor === undefined)
      return await readHomeServiceHistory(getDatabase(event), !!(await identity(event)))
    if (
      view !== undefined ||
      typeof monitor !== 'string' ||
      !monitor.trim() ||
      monitor.length > 510
    ) {
      setResponseStatus(event, 400)
      return { code: 'INVALID_MONITOR' }
    }
    const history = await readServiceHistory(getDatabase(event), monitor, !!(await identity(event)))
    if (history) return history
    setResponseStatus(event, 404)
    return { code: 'HISTORY_UNAVAILABLE' }
  } catch {
    setResponseStatus(event, 503)
    return { code: 'HISTORY_UNAVAILABLE' }
  }
})

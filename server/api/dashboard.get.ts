import { getDatabase } from '../utils/database.ts'
import { readGuestDashboard, readAdminDashboard } from '../services/dashboard.ts'
import { identity } from '../utils/auth-http.ts'
import { DataLayerError } from '../types/database.ts'
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Vary', 'Cookie')
  try {
    return (await identity(event))
      ? await readAdminDashboard(getDatabase(event))
      : await readGuestDashboard(getDatabase(event))
  } catch (e) {
    // Authentication metadata, session rows and storage are all fail-closed here. Do not
    // let an AuthError/parse failure turn into an unhandled Nitro 500 or diagnostic page.
    setResponseStatus(event, 503)
    return {
      code: e instanceof DataLayerError ? e.code : 'DATABASE_ERROR',
      message: 'Dashboard storage is unavailable',
    }
  }
})

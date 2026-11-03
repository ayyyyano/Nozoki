import { authEndpoint } from '../../utils/auth-http.ts'
import { requireAdmin } from '../../utils/require-admin.ts'
import { getDatabase } from '../../utils/database.ts'
import { readStoredState } from '../../repositories/config.ts'
export default authEndpoint(async (event) => {
  await requireAdmin(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const state = await readStoredState(getDatabase(event))
  setResponseHeader(event, 'X-Nozoki-Storage-Mode', state.storageMode ?? 'ready')
  return state.config
})

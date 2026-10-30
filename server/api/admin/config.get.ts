import { authEndpoint } from '../../utils/auth-http.ts'
import { requireAdmin } from '../../utils/require-admin.ts'
import { getDatabase } from '../../utils/database.ts'
import { readConfig } from '../../services/config.ts'
export default authEndpoint(async (event) => {
  await requireAdmin(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return readConfig(getDatabase(event))
})

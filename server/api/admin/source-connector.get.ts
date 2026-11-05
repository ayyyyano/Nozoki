import { authEndpoint, environment } from '../../utils/auth-http.ts'
import { requireAdmin } from '../../utils/require-admin.ts'
import { getDatabase } from '../../utils/database.ts'
import { managedEgressStatus } from '../../adapters/managed-transport.ts'
import { collectionEnvironmentMatches } from '../../collection/environment.ts'
export default authEndpoint(async (event) => {
  await requireAdmin(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const env = environment(event)
  return {
    ...managedEgressStatus(env),
    environmentMatches: await collectionEnvironmentMatches(getDatabase(event), env),
  }
})

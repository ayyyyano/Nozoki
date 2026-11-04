import { authEndpoint, environment } from '../../utils/auth-http.ts'
import { requireAdmin } from '../../utils/require-admin.ts'
import { getDatabase } from '../../utils/database.ts'
import { managedEgressStatus } from '../../adapters/managed-transport.ts'
import { environmentFingerprint } from '../../collection/environment.ts'
export default authEndpoint(async (event) => {
  await requireAdmin(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const env = environment(event)
  const row = await getDatabase(event)
    .prepare('SELECT epoch,fingerprint FROM collector_environment WHERE id=1')
    .first()
  return {
    ...managedEgressStatus(env),
    environmentMatches: row
      ? row.epoch === Number(env.COLLECTOR_EPOCH) &&
        row.fingerprint === (await environmentFingerprint(env))
      : null,
  }
})

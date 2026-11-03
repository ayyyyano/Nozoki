import { authEndpoint, writeSessionCookie, authenticatedMutation } from '../../utils/auth-http.ts'
import { revokeSession } from '../../repositories/sessions.ts'
import { getDatabase } from '../../utils/database.ts'
export default authEndpoint(async (event) => {
  // Logout remains available while configuration writes are paused for migration.
  const session = await authenticatedMutation(event)
  await revokeSession(getDatabase(event), session.hash, new Date().toISOString()).run()
  writeSessionCookie(event, session.settings, '', 0)
  return { viewer: 'guest' }
})

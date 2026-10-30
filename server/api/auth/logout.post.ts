import { authEndpoint, writeSessionCookie } from '../../utils/auth-http.ts'
import { requireAdminMutation } from '../../utils/require-admin.ts'
import { revokeSession } from '../../repositories/sessions.ts'
import { getDatabase } from '../../utils/database.ts'
export default authEndpoint(async (event) => {
  const session = await requireAdminMutation(event)
  await revokeSession(getDatabase(event), session.hash, new Date().toISOString()).run()
  writeSessionCookie(event, session.settings, '', 0)
  return { viewer: 'guest' }
})

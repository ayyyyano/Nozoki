import { authEndpoint } from '../../utils/auth-http.ts'
import { requireAdmin } from '../../utils/require-admin.ts'
import { csrfToken } from '../../services/sessions.ts'
export default authEndpoint(async (event) => ({
  token: await csrfToken(await requireAdmin(event)),
}))

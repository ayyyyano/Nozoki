import { authEndpoint } from '../../../../utils/auth-http.ts'
import { requireAdmin } from '../../../../utils/require-admin.ts'
import { getDatabase } from '../../../../utils/database.ts'
import { AuthError } from '../../../../services/auth-settings.ts'
import { IdSchema } from '../../../../../shared/contracts/config.ts'
import { sourceRemovalState } from '../../../../services/source-removal.ts'
export default authEndpoint(async (event) => {
  await requireAdmin(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const id = IdSchema.safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw new AuthError(400, 'INVALID_REQUEST')
  const result = await sourceRemovalState(getDatabase(event), id.data)
  if (!result.exists) throw new AuthError(404, 'NOT_FOUND')
  return result
})

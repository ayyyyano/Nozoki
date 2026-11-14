import { ITEM_HOME_LIMITS, type ItemDisplayModule } from '../../../../shared/domain/item-display.ts'
import { readAdminDisplayItems } from '../../../services/dashboard.ts'
import { authEndpoint } from '../../../utils/auth-http.ts'
import { getDatabase } from '../../../utils/database.ts'
import { requireAdmin } from '../../../utils/require-admin.ts'

export default authEndpoint(async (event) => {
  await requireAdmin(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const id = getRouterParam(event, 'module')
  if (!id || !Object.hasOwn(ITEM_HOME_LIMITS, id)) {
    setResponseStatus(event, 404)
    return { code: 'NOT_FOUND' }
  }
  return readAdminDisplayItems(getDatabase(event), id as ItemDisplayModule)
})

import { authEndpoint } from '../../../utils/auth-http.ts'
import { requireAdmin } from '../../../utils/require-admin.ts'
import { getDatabase } from '../../../utils/database.ts'
import { exportConfigBackup } from '../../../services/config-backup.ts'

export default authEndpoint(async (event) => {
  await requireAdmin(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  const backup = await exportConfigBackup(getDatabase(event))
  setResponseHeader(
    event,
    'Content-Disposition',
    `attachment; filename="nozoki-config-${backup.exportedAt.slice(0, 10)}.json"`,
  )
  return backup
})

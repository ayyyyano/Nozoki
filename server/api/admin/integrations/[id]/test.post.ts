import { z } from 'zod'
import { authEndpoint, boundedJson, environment } from '../../../../utils/auth-http.ts'
import { requireAdminMutation } from '../../../../utils/require-admin.ts'
import { getDatabase } from '../../../../utils/database.ts'
import { testIntegration } from '../../../../services/integration-test.ts'
import { AuthError } from '../../../../services/auth-settings.ts'
export default authEndpoint(async (event) => {
  const session = await requireAdminMutation(event)
  const body = await boundedJson(event)
  if (!z.strictObject({}).safeParse(body).success) throw new AuthError(400, 'INVALID_REQUEST')
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return testIntegration(
    getDatabase(event),
    getRouterParam(event, 'id') ?? '',
    session,
    environment(event),
  )
})

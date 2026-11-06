import { z } from 'zod'
import { authEndpoint, boundedJson, environment } from '../../../../utils/auth-http.ts'
import { requireAdminMutation } from '../../../../utils/require-admin.ts'
import { getDatabase } from '../../../../utils/database.ts'
import { testIntegration } from '../../../../services/integration-test.ts'
import { AuthError } from '../../../../services/auth-settings.ts'
import { testIntegrationDraft } from '../../../../services/integration-draft-test.ts'
export default authEndpoint(async (event) => {
  const session = await requireAdminMutation(event)
  const body = await boundedJson(event, 32768)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  if (!z.strictObject({}).safeParse(body).success) {
    if (!body || typeof body !== 'object' || !('draft' in body))
      throw new AuthError(400, 'INVALID_REQUEST')
    return testIntegrationDraft(
      getDatabase(event),
      getRouterParam(event, 'id') ?? '',
      body,
      session,
      environment(event),
    )
  }
  return testIntegration(
    getDatabase(event),
    getRouterParam(event, 'id') ?? '',
    session,
    environment(event),
  )
})

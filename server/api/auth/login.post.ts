import {
  authEndpoint,
  environment,
  assertOrigin,
  boundedJson,
  trustedSource,
  sessionCookie,
  writeSessionCookie,
} from '../../utils/auth-http.ts'
import { authSettings } from '../../services/auth-settings.ts'
import { login } from '../../services/auth.ts'
import { getDatabase } from '../../utils/database.ts'
export default authEndpoint(async (event) => {
  const settings = await authSettings(environment(event))
  assertOrigin(event, settings)
  const result = await login(
    getDatabase(event),
    settings,
    await boundedJson(event),
    trustedSource(event, settings),
    sessionCookie(event, settings),
  )
  writeSessionCookie(event, settings, result.token, result.maxAge)
  return { viewer: 'admin' }
})

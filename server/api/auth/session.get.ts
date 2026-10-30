import { authEndpoint, identity } from '../../utils/auth-http.ts'
export default authEndpoint(async (event) => {
  const session = await identity(event)
  return session ? { viewer: 'admin', email: session.settings.email } : { viewer: 'guest' }
})

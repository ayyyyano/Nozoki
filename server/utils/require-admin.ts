import type { H3Event } from 'h3'
import { identity, authenticatedMutation } from './auth-http.ts'
import { AuthError } from '../services/auth-settings.ts'
export async function requireAdmin(event: H3Event) {
  const session = await identity(event)
  if (!session) throw new AuthError(401, 'AUTH_REQUIRED')
  return session
}
export const requireAdminMutation = authenticatedMutation

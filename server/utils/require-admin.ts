import type { H3Event } from 'h3'
import { identity, authenticatedMutation } from './auth-http.ts'
import { AuthError } from '../services/auth-settings.ts'
import { requireWritableStorage } from '../repositories/storage-status.ts'
import { getDatabase } from './database.ts'
export async function requireAdmin(event: H3Event) {
  const session = await identity(event)
  if (!session) throw new AuthError(401, 'AUTH_REQUIRED')
  return session
}
export async function requireAdminMutation(event: H3Event) {
  const session = await authenticatedMutation(event)
  try {
    await requireWritableStorage(getDatabase(event))
  } catch (error) {
    if (error instanceof Error && error.message === 'MIGRATIONS_REQUIRED')
      throw new AuthError(503, 'MIGRATIONS_REQUIRED')
    throw error
  }
  return session
}

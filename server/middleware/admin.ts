import { defineEventHandler, sendRedirect, setResponseHeader, createError } from 'h3'
import { identity } from '../utils/auth-http.ts'
export default defineEventHandler(async (event) => {
  const path = (event.path ?? '').split('?')[0]
  if (path === '/admin' || path === '/admin/' || path === '/login') {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    if (path === '/login') return
    try {
      if (!(await identity(event))) return sendRedirect(event, '/login', 303)
    } catch {
      throw createError({ statusCode: 503, message: 'Authentication unavailable' })
    }
  }
})

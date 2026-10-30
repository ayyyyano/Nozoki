export default defineEventHandler((event) => {
  // Conservative headers that do not require script/style nonces. Full script CSP remains
  // a release item because Nuxt payload and Varlet inject inline styles at runtime.
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setResponseHeader(event, 'X-Frame-Options', 'DENY')
  setResponseHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  setResponseHeader(
    event,
    'Content-Security-Policy',
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  )
  if (
    !getRequestURL(event).pathname.startsWith('/api/') &&
    !getRequestURL(event).pathname.startsWith('/_nuxt/')
  ) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    setResponseHeader(event, 'Vary', 'Cookie')
  }
})

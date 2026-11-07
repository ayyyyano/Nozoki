/** A base URL is a service directory, not an origin-wide credential scope.
 * Adapters must resolve relative endpoints against this normalized directory.
 * Preserve path case, encoded separators and repeated slashes (potentially distinct services).
 */
export function normalizeServiceTarget(value: string | null): string | null {
  if (value === null) return null
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('INVALID_SERVICE_TARGET')
  // WHATWG URL normalizes host, default port and dot segments. Normalize percent hex
  // and unreserved escapes only; never interpret an encoded slash as a separator.
  const path = url.pathname.replace(/%[0-9a-f]{2}/gi, (escape) => {
    const char = String.fromCharCode(parseInt(escape.slice(1), 16))
    return /[A-Za-z0-9_~-]/.test(char) ? char : escape.toUpperCase()
  })
  url.pathname = path.endsWith('/') ? path : path + '/'
  return url.href
}

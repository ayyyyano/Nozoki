const utf8 = new TextEncoder()
export const bytes = (value: string) => utf8.encode(value)
export const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (b) => b.toString(16).padStart(2, '0')).join('')
export const randomToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
export const tokenValid = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value)
export const hashToken = async (value: string) =>
  hex(await crypto.subtle.digest('SHA-256', bytes(value)))
export const hmacKey = (value: string) =>
  crypto.subtle.importKey('raw', bytes(value), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
export const mac = (key: CryptoKey, parts: string[]) =>
  crypto.subtle.sign('HMAC', key, bytes(JSON.stringify(parts)))
export const verifyMac = (key: CryptoKey, parts: string[], signature: Uint8Array) =>
  crypto.subtle.verify('HMAC', key, signature as BufferSource, bytes(JSON.stringify(parts)))
export function unhex(value: string) {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16))
}

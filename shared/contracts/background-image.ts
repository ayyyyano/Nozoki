/** Uploaded images are public site assets; only static WebP is stored. */
export const BACKGROUND_IMAGE_LIMIT = 512 * 1024
export const BACKGROUND_IMAGE_SIDE = 2560
export const BACKGROUND_IMAGE_PATH = /^\/api\/background\/([a-f0-9]{64})$/
export function isUploadedBackgroundUrl(value: string): boolean {
  return BACKGROUND_IMAGE_PATH.test(value)
}
export async function backgroundImageHash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
/** Validate the bounded RIFF container, canvas-compatible static frame and dimensions. */
export function decodeBackgroundImage(base64: string): Uint8Array | null {
  if (
    base64.length > Math.ceil(BACKGROUND_IMAGE_LIMIT / 3) * 4 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    return null
  let raw: string
  try {
    raw = atob(base64)
  } catch {
    return null
  }
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
  if (bytes.length < 30 || bytes.length > BACKGROUND_IMAGE_LIMIT) return null
  const view = new DataView(bytes.buffer)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length)
    return null
  let frame = false
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return null
    const type = tag(offset),
      length = view.getUint32(offset + 4, true),
      start = offset + 8
    if (start + length > bytes.length) return null
    let width = 0,
      height = 0
    if (type === 'VP8 ') {
      if (
        frame ||
        length < 10 ||
        bytes[start]! & 1 ||
        bytes[start + 3] !== 0x9d ||
        bytes[start + 4] !== 0x01 ||
        bytes[start + 5] !== 0x2a
      )
        return null
      width = view.getUint16(start + 6, true) & 0x3fff
      height = view.getUint16(start + 8, true) & 0x3fff
      frame = true
    } else if (type === 'VP8L') {
      if (frame || length < 5 || bytes[start] !== 0x2f) return null
      const bits = view.getUint32(start + 1, true)
      if (bits >>> 29) return null
      width = (bits & 0x3fff) + 1
      height = ((bits >>> 14) & 0x3fff) + 1
      frame = true
    } else if (type === 'VP8X') {
      if (length !== 10 || bytes[start]! & 0x02) return null
      width = 1 + bytes[start + 4]! + (bytes[start + 5]! << 8) + (bytes[start + 6]! << 16)
      height = 1 + bytes[start + 7]! + (bytes[start + 8]! << 8) + (bytes[start + 9]! << 16)
    } else if (type !== 'ALPH' && type !== 'ICCP') return null
    if (
      type !== 'ALPH' &&
      type !== 'ICCP' &&
      (!width || !height || width > BACKGROUND_IMAGE_SIDE || height > BACKGROUND_IMAGE_SIDE)
    )
      return null
    offset = start + length + (length % 2)
    if (offset > bytes.length) return null
  }
  return frame ? bytes : null
}

import { getDatabase } from '../../utils/database.ts'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const hash = getRouterParam(event, 'hash') ?? ''
  if (!/^[a-f0-9]{64}$/.test(hash)) throw createError({ statusCode: 404 })
  let row
  try {
    row = await getDatabase(event)
      .prepare(
        `SELECT i.data FROM site_background_images i JOIN site_settings s ON s.id=1
       WHERE i.hash=? AND json_extract(s.settings_json,'$.background.source')='uploaded'
       AND json_extract(s.settings_json,'$.background.url')=?`,
      )
      .bind(hash, '/api/background/' + hash)
      .first<{ data: ArrayBuffer | number[] | Uint8Array }>()
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Background unavailable' })
  }
  if (!row) throw createError({ statusCode: 404 })
  const bytes = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data as ArrayBuffer)
  setResponseHeader(event, 'Content-Type', 'image/webp')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; sandbox")
  setResponseHeader(event, 'Cross-Origin-Resource-Policy', 'same-origin')
  return bytes
})

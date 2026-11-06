import {
  BACKGROUND_IMAGE_LIMIT,
  BACKGROUND_IMAGE_SIDE,
  backgroundImageHash,
} from '../../shared/contracts/background-image'

/** Re-encode locally to discard active content, animation and image metadata. */
export async function prepareBackgroundUpload(file: File) {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('请选择不超过 10 MB 的 PNG、JPEG 或 WebP 图片')
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('图片像素过大，请缩小后重试')
    const scale = Math.min(1, BACKGROUND_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理图片')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.86, 0.72, 0.55, 0.38]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', quality),
      )
      if (!blob || blob.type !== 'image/webp') throw new Error('当前浏览器不支持 WebP 图片处理')
      if (blob.size > BACKGROUND_IMAGE_LIMIT) continue
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const hash = await backgroundImageHash(bytes)
      let binary = ''
      for (let at = 0; at < bytes.length; at += 8192)
        binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
      return { url: '/api/background/' + hash, data: btoa(binary) }
    }
    throw new Error('图片压缩后仍超过 512 KB，请选择较小的图片')
  } finally {
    bitmap.close()
  }
}

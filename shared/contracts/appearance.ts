import { isUploadedBackgroundUrl } from './background-image.ts'
import { parseSourceColor } from '../domain/color-input.ts'
export interface Appearance {
  mode: 'system' | 'light' | 'dark'
  sourceColor: string
  reduceMotion: boolean
  background: {
    source: 'off' | 'builtin' | 'custom' | 'uploaded'
    url: string
    layout: 'banner' | 'page'
    fit: 'cover' | 'contain'
    x: number
    y: number
    overlay: number
    cardOpacity: number
    cardBlur: number
  }
}
export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'system',
  sourceColor: '#6750A4',
  reduceMotion: false,
  background: {
    source: 'builtin',
    url: '',
    layout: 'page',
    fit: 'cover',
    x: 50,
    y: 35,
    overlay: 20,
    cardOpacity: 50,
    cardBlur: 8,
  },
}
export function parseAppearance(value: unknown): Appearance {
  const fallback = structuredClone(DEFAULT_APPEARANCE)
  if (!value || typeof value !== 'object') return fallback
  const v = value as Partial<Appearance>
  fallback.sourceColor = parseSourceColor(v.sourceColor) ?? fallback.sourceColor
  // Legacy M2/glass/tide presets are intentionally ignored; all preferences use M3.
  if (v.mode === 'system' || v.mode === 'light' || v.mode === 'dark') fallback.mode = v.mode
  if (typeof v.reduceMotion === 'boolean') fallback.reduceMotion = v.reduceMotion
  const b = v.background
  if (b && typeof b === 'object') {
    if (['off', 'builtin', 'custom', 'uploaded'].includes(b.source))
      fallback.background.source = b.source
    if (
      typeof b.url === 'string' &&
      b.url.length <= 2048 &&
      (isHttpsImageUrl(b.url) || isUploadedBackgroundUrl(b.url))
    )
      fallback.background.url = b.url
    if (b.layout === 'banner' || b.layout === 'page') fallback.background.layout = b.layout
    if (b.fit === 'cover' || b.fit === 'contain') fallback.background.fit = b.fit
    for (const key of ['x', 'y', 'overlay', 'cardOpacity', 'cardBlur'] as const) {
      if (typeof b[key] === 'number' && Number.isFinite(b[key]))
        fallback.background[key] = Math.min(key === 'cardBlur' ? 20 : 100, Math.max(0, b[key]))
    }
  }
  return fallback
}
export function isHttpsImageUrl(value: string): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

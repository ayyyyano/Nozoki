import { Hct, SchemeTonalSpot, argbFromHex, hexFromArgb } from '@material/material-color-utilities'
import { parseSourceColor } from './color-input.ts'

// Role names are MCU DynamicScheme getters, not the deprecated Scheme API.
export const COLOR_ROLES = {
  primary: 'primary',
  'on-primary': 'onPrimary',
  'primary-container': 'primaryContainer',
  'on-primary-container': 'onPrimaryContainer',
  secondary: 'secondary',
  'on-secondary': 'onSecondary',
  'secondary-container': 'secondaryContainer',
  'on-secondary-container': 'onSecondaryContainer',
  tertiary: 'tertiary',
  'on-tertiary': 'onTertiary',
  'tertiary-container': 'tertiaryContainer',
  'on-tertiary-container': 'onTertiaryContainer',
  surface: 'surface',
  'on-surface': 'onSurface',
  'surface-variant': 'surfaceVariant',
  'on-surface-variant': 'onSurfaceVariant',
  'surface-container-lowest': 'surfaceContainerLowest',
  'surface-container-low': 'surfaceContainerLow',
  'surface-container': 'surfaceContainer',
  'surface-container-high': 'surfaceContainerHigh',
  'surface-container-highest': 'surfaceContainerHighest',
  outline: 'outline',
  'outline-variant': 'outlineVariant',
  error: 'error',
  'on-error': 'onError',
  'error-container': 'errorContainer',
  'on-error-container': 'onErrorContainer',
  'inverse-surface': 'inverseSurface',
  'inverse-on-surface': 'inverseOnSurface',
  'inverse-primary': 'inversePrimary',
} as const
function hsl(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min,
    l = (max + min) / 2
  let h = 0
  if (delta)
    h =
      (max === r
        ? (g - b) / delta + (g < b ? 6 : 0)
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4) * 60
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return `${h.toFixed(3)}, ${(s * 100).toFixed(3)}%, ${(l * 100).toFixed(3)}%`
}
const cache = new Map<string, Record<string, string>>()
export function createThemeColors(source: string, dark: boolean): Record<string, string> {
  const normalized = parseSourceColor(source) ?? '#6750A4'
  const key = normalized + dark
  if (cache.has(key)) return cache.get(key)!
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(normalized)), dark, 0)
  const colors: Record<string, string> = {}
  const put = (name: string, value: string) => {
    colors[`--color-${name}`] = value
    colors[`--hsl-${name}`] = hsl(value)
  }
  for (const [name, role] of Object.entries(COLOR_ROLES)) put(name, hexFromArgb(scheme[role]))
  for (const [name, role] of Object.entries({
    body: 'surface',
    text: 'on-surface',
    info: 'secondary',
    'on-info': 'on-secondary',
    'info-container': 'secondary-container',
    'on-info-container': 'on-secondary-container',
    danger: 'error',
    'on-danger': 'on-error',
    'danger-container': 'error-container',
    'on-danger-container': 'on-error-container',
  }))
    put(name, colors[`--color-${role}`]!)
  // Operational semantics stay green/amber in every source palette.
  put('success', dark ? '#8DDA91' : '#146C2E')
  put('on-success', dark ? '#003910' : '#FFFFFF')
  put('success-container', dark ? '#00531B' : '#A8F5AC')
  put('on-success-container', dark ? '#A8F5AC' : '#002108')
  put('warning', dark ? '#F6BF48' : '#795900')
  put('on-warning', dark ? '#402D00' : '#FFFFFF')
  put('warning-container', dark ? '#5C4300' : '#FFDF9E')
  put('on-warning-container', dark ? '#FFDF9E' : '#261A00')
  if (cache.size >= 32) cache.delete(cache.keys().next().value!)
  cache.set(key, colors)
  return colors
}

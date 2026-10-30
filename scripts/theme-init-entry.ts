import { createThemeColors } from '../shared/domain/theme-colors'
import { parseSourceColor } from '../shared/domain/color-input'
import { migrateOverrides } from '../shared/domain/appearance-overrides'
import { armDxCurtain } from '../shared/browser/dx-curtain'
// Only whitelisted data reaches CSS declarations. No inline script or eval.
try {
  let saved: { mode?: string; sourceColor?: unknown; reduceMotion?: boolean } | null = null
  try {
    saved = migrateOverrides(
      JSON.parse(
        localStorage.getItem('nozoki-appearance-v2') ||
          localStorage.getItem('nozoki-appearance-v1') ||
          'null',
      ),
    )
  } catch {
    /* use defaults */
  }
  const mode = saved && ['light', 'dark'].includes(saved.mode!) ? saved.mode! : 'system'
  const root = document.documentElement
  root.dataset.nozokiMode = mode
  root.dataset.nozokiReduced = String(saved?.reduceMotion === true)
  const source =
    parseSourceColor(saved?.sourceColor) ?? parseSourceColor(root.dataset.sharedSource) ?? '#6750A4'
  root.dataset.nozokiSource = source
  const query = matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const effectiveMode = root.dataset.nozokiMode
    for (const [name, value] of Object.entries(
      createThemeColors(
        root.dataset.nozokiSource ?? source,
        effectiveMode === 'dark' || (effectiveMode === 'system' && query.matches),
      ),
    ))
      root.style.setProperty(name, value)
  }
  apply()
  query.addEventListener('change', apply)
} catch {
  /* SSR/CSS defaults remain readable when preferences are unavailable. */
}
armDxCurtain()

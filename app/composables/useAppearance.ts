import { StyleProvider, Themes } from '@varlet/ui'
import { DEFAULT_APPEARANCE, parseAppearance } from '../../shared/contracts/appearance'
import {
  composeAppearance,
  migrateOverrides,
  recordAppearanceChanges,
  type AppearanceOverrides,
} from '../../shared/domain/appearance-overrides'
import { createThemeColors } from '../../shared/domain/theme-colors'

export function useAppearance() {
  const appearance = useState('nozoki-appearance', () => structuredClone(DEFAULT_APPEARANCE))
  const systemDark = useState('nozoki-system-dark', () => false)
  const systemReduced = useState('nozoki-system-reduced', () => false)
  const storageFailed = useState('nozoki-storage-failed', () => false)
  const ready = useState('nozoki-theme-ready', () => false)
  const previewSource = useState<string | null>('nozoki-color-preview', () => null)
  const shared = useSharedDashboard()
  const adminPreview = useState<Pick<
    import('../../shared/contracts/appearance').Appearance,
    'sourceColor' | 'background'
  > | null>('nozoki-admin-preview', () => null)
  const overrides = useState<AppearanceOverrides>('nozoki-appearance-overrides', () => ({}))
  const sharedDefaults = computed(() =>
    parseAppearance({
      sourceColor: shared.value?.site.appearance.sourceColor,
      background: shared.value?.site.background,
    }),
  )
  appearance.value = composeAppearance(sharedDefaults.value, overrides.value)
  const effective = computed(() =>
    adminPreview.value
      ? parseAppearance({ ...appearance.value, ...adminPreview.value })
      : appearance.value,
  )
  const sourceColor = computed(() => previewSource.value ?? effective.value.sourceColor)
  const dark = computed(
    () =>
      appearance.value.mode === 'dark' || (appearance.value.mode === 'system' && systemDark.value),
  )
  const reduced = computed(() => appearance.value.reduceMotion || systemReduced.value)
  const theme = computed(() => ({
    ...(dark.value ? Themes.md3Dark : Themes.md3Light),
    ...createThemeColors(sourceColor.value, dark.value),
  }))
  let resetPersonal = () => {}
  onMounted(() => {
    const colorQuery = matchMedia('(prefers-color-scheme: dark)')
    const motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      systemDark.value = colorQuery.matches
      systemReduced.value = motionQuery.matches
    }
    sync()
    try {
      overrides.value = migrateOverrides(
        JSON.parse(
          localStorage.getItem('nozoki-appearance-v2') ??
            localStorage.getItem('nozoki-appearance-v1') ??
            'null',
        ),
      )
      appearance.value = composeAppearance(sharedDefaults.value, overrides.value)
    } catch {
      storageFailed.value = true
    }
    const apply = () => {
      StyleProvider(theme.value)
      document.documentElement.dataset.nozokiMode = appearance.value.mode
      document.documentElement.dataset.nozokiSource = sourceColor.value
      for (const [key, value] of Object.entries(createThemeColors(sourceColor.value, dark.value)))
        document.documentElement.style.setProperty(key, value)
      document.documentElement.dataset.nozokiReduced = String(reduced.value)
      document.documentElement.style.colorScheme = dark.value ? 'dark' : 'light'
    }
    apply()
    ready.value = true
    const stopTheme = watch([theme, dark, reduced, () => appearance.value.mode], apply)
    let previous = structuredClone(toRaw(appearance.value))
    let merging = false
    const stopShared = watch(
      sharedDefaults,
      () => {
        merging = true
        appearance.value = composeAppearance(sharedDefaults.value, overrides.value)
        previous = structuredClone(toRaw(appearance.value))
        merging = false
      },
      { flush: 'sync' },
    )
    const stopSave = watch(
      appearance,
      (value) => {
        if (merging) return
        overrides.value = recordAppearanceChanges(previous, toRaw(value), toRaw(overrides.value))
        previous = structuredClone(toRaw(value))
        try {
          localStorage.setItem(
            'nozoki-appearance-v2',
            JSON.stringify({ version: 2, overrides: overrides.value }),
          )
          storageFailed.value = false
        } catch {
          storageFailed.value = true
        }
      },
      { deep: true, flush: 'sync' },
    )
    resetPersonal = () => {
      merging = true
      overrides.value = {}
      appearance.value = composeAppearance(sharedDefaults.value, {})
      previous = structuredClone(toRaw(appearance.value))
      merging = false
      try {
        localStorage.setItem('nozoki-appearance-v2', JSON.stringify({ version: 2, overrides: {} }))
        localStorage.removeItem('nozoki-appearance-v1')
      } catch {
        storageFailed.value = true
      }
    }
    colorQuery.addEventListener('change', sync)
    motionQuery.addEventListener('change', sync)
    onBeforeUnmount(() => {
      stopTheme()
      stopSave()
      stopShared()
      colorQuery.removeEventListener('change', sync)
      motionQuery.removeEventListener('change', sync)
    })
  })
  function toggleTheme() {
    appearance.value.mode = dark.value ? 'light' : 'dark'
  }
  return {
    appearance,
    effective,
    previewSource,
    dark,
    reduced,
    theme,
    storageFailed,
    ready,
    toggleTheme,
    resetPersonal: () => resetPersonal(),
  }
}

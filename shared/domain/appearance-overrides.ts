import { DEFAULT_APPEARANCE, parseAppearance, type Appearance } from '../contracts/appearance.ts'
import { canonical } from '../contracts/admin.ts'
export type AppearanceOverrides = Partial<Omit<Appearance, 'background'>> & {
  background?: Partial<Appearance['background']>
}
export function composeAppearance(shared: Appearance, overrides: AppearanceOverrides): Appearance {
  return parseAppearance({
    ...shared,
    ...overrides,
    background: { ...shared.background, ...overrides.background },
  })
}
export function migrateOverrides(value: unknown): AppearanceOverrides {
  if (!value || typeof value !== 'object') return {}
  const raw = value as { version?: number; overrides?: unknown }
  if (raw.version === 2 && raw.overrides && typeof raw.overrides === 'object') {
    const o = raw.overrides as AppearanceOverrides,
      valid = parseAppearance(o),
      out: AppearanceOverrides = {}
    for (const key of ['mode', 'sourceColor', 'reduceMotion'] as const)
      if (Object.hasOwn(o, key)) Object.assign(out, { [key]: valid[key] })
    if (o.background) {
      out.background = {}
      for (const key of Object.keys(
        DEFAULT_APPEARANCE.background,
      ) as (keyof Appearance['background'])[])
        if (Object.hasOwn(o.background, key))
          Object.assign(out.background, { [key]: valid.background[key] })
    }
    return out
  }
  // v1 saved complete defaults, without intent markers. Preserve only distinguishable changes.
  const old = parseAppearance(value),
    out: AppearanceOverrides = {}
  for (const key of ['mode', 'sourceColor', 'reduceMotion'] as const)
    if (old[key] !== DEFAULT_APPEARANCE[key]) Object.assign(out, { [key]: old[key] })
  for (const key of Object.keys(old.background) as (keyof Appearance['background'])[])
    if (old.background[key] !== DEFAULT_APPEARANCE.background[key]) {
      out.background ??= {}
      Object.assign(out.background, { [key]: old.background[key] })
    }
  return out
}
export function recordAppearanceChanges(
  before: Appearance,
  after: Appearance,
  overrides: AppearanceOverrides,
): AppearanceOverrides {
  const next = structuredClone(overrides)
  for (const key of ['mode', 'sourceColor', 'reduceMotion'] as const)
    if (before[key] !== after[key]) Object.assign(next, { [key]: after[key] })
  for (const key of Object.keys(after.background) as (keyof Appearance['background'])[])
    if (canonical(before.background[key]) !== canonical(after.background[key])) {
      next.background ??= {}
      Object.assign(next.background, { [key]: after.background[key] })
    }
  return next
}

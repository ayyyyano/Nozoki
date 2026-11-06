import type { Config, ConfigWrite, ModuleSettings } from '../contracts/config.ts'
import type { ModuleId } from '../contracts/dashboard.ts'
import { integrationPreset } from './index.ts'

export const SOURCE_MODULES: Readonly<Record<string, ModuleId>> = {
  deepseek: 'deepseek',
  sleepy: 'devices',
  tailscale: 'tailscale',
  cliproxy: 'codex',
  kuma: 'services',
  uptimeflare: 'services',
  tencent: 'quotes',
  yahoo: 'quotes',
}

/** Existing references select among legacy duplicates; new types are singletons. */
export function bindSources<
  T extends Pick<Config | ConfigWrite, 'modules' | 'integrations' | 'quotes'>,
>(config: T): T {
  const grouped = new Map<string, T['integrations'][number][]>()
  for (const source of config.integrations) {
    const kind = integrationPreset(source)?.id
    if (kind) grouped.set(kind, [...(grouped.get(kind) ?? []), source])
  }
  const pick = (kind: string, module: ModuleSettings) => {
    const candidates = grouped.get(kind) ?? []
    const old = Object.values(module.sources).map((s) => s.sourceId)
    return (
      candidates.find((s) => s.enabled && old.includes(s.id)) ??
      candidates.find((s) => s.enabled) ??
      candidates.find((s) => old.includes(s.id)) ??
      candidates[0]
    )
  }
  const modules = config.modules.map((module) => {
    const kinds = Object.keys(SOURCE_MODULES).filter((kind) => SOURCE_MODULES[kind] === module.id)
    if (!kinds.length) return { ...module, sources: {} }
    let selected = kinds.flatMap((kind) => {
      const s = pick(kind, module)
      return s ? [s] : []
    })
    if (module.id === 'quotes')
      selected = [selected.find((s) => s.enabled) ?? selected[0]].filter((s) => !!s)
    // Unknown historical protocols remain read-only. Keep only their existing references;
    // they cannot be selected or newly created by the managed source form.
    if (!selected.length) {
      const legacy = Object.fromEntries(
        Object.entries(module.sources).filter(([, ref]) => {
          const source = config.integrations.find((s) => s.id === ref.sourceId)
          return source && !integrationPreset(source)
        }),
      )
      return { ...module, sources: legacy }
    }
    // Preserve the old monitor IDs, source identity and snapshot subject.
    const references = selected.map((source, index) => [
      index === 0 ? 'main' : integrationPreset(source)!.id,
      {
        sourceId: source.id,
        subject:
          Object.values(module.sources).find((s) => s.sourceId === source.id)?.subject ?? 'default',
      },
    ])
    return { ...module, sources: Object.fromEntries(references) }
  })
  const quoteSource = modules.find((m) => m.id === 'quotes')?.sources.main?.sourceId ?? null
  const counts = new Map<string, number>()
  for (const q of config.quotes) {
    const key = q.market + ':' + q.symbol
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return {
    ...config,
    modules,
    quotes: config.quotes.map((q) =>
      counts.get(q.market + ':' + q.symbol)! > 1 ? q : { ...q, provider: quoteSource },
    ),
  }
}

export function duplicateSourceType(
  next: ConfigWrite['integrations'],
  old: Config['integrations'],
): boolean {
  const kinds = new Set(next.map((s) => integrationPreset(s)?.id).filter(Boolean))
  return [...kinds].some((kind) => {
    const ids = next.filter((s) => integrationPreset(s)?.id === kind).map((s) => s.id)
    const before = new Set(old.filter((s) => integrationPreset(s)?.id === kind).map((s) => s.id))
    return ids.length > 1 && ids.some((id) => !before.has(id))
  })
}

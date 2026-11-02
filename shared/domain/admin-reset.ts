import { createDefaultConfig, type ConfigWrite } from '../contracts/config.ts'
import { editableConfig } from '../contracts/admin.ts'

export type AdminSection = 'site' | 'modules' | 'integrations' | 'schedule' | 'quotes' | 'links'

export function sectionResetIssue(config: ConfigWrite, section: AdminSection): string | null {
  if (section !== 'integrations') return null
  const retained = new Set(createDefaultConfig().integrations.map((source) => source.id))
  const references = [
    ...config.modules.flatMap((module) =>
      Object.values(module.sources).map((source) => source.sourceId),
    ),
    ...config.quotes.flatMap((quote) => (quote.provider ? [quote.provider] : [])),
  ]
  const removed = [...new Set(references.filter((id) => !retained.has(id)))]
  return removed.length
    ? `以下来源仍被模块或行情引用：${removed.join('、')}。请先解除这些引用，再重置数据源。`
    : null
}

/** Return only the fields owned by this editor section. The caller applies them to its draft. */
export function defaultSectionPatch(
  config: ConfigWrite,
  section: AdminSection,
): Partial<ConfigWrite> {
  const issue = sectionResetIssue(config, section)
  if (issue) throw new Error(issue)
  const defaults = editableConfig(createDefaultConfig())
  const hasQuoteSource = config.integrations.some(
    (source) => source.id === 'tencent' && source.provider === 'quotes-custom',
  )
  switch (section) {
    case 'site':
      return {
        site: {
          ...config.site,
          siteName: defaults.site.siteName,
          appearance: defaults.site.appearance,
          background: defaults.site.background,
        },
      }
    case 'schedule':
      return {
        site: {
          ...config.site,
          schedule: defaults.site.schedule,
          timezone: defaults.site.timezone,
        },
      }
    case 'modules':
      return {
        modules: defaults.modules.map((module) => ({
          ...module,
          sources: module.id === 'quotes' && hasQuoteSource ? module.sources : {},
        })),
      }
    case 'integrations':
      return {
        integrations: defaults.integrations.map((source) => ({
          ...source,
          credential: { operation: 'clear' },
        })),
      }
    case 'quotes':
      return {
        quotes: defaults.quotes.map((quote) => ({
          ...quote,
          provider: hasQuoteSource ? quote.provider : null,
        })),
      }
    case 'links':
      return { links: defaults.links }
  }
}

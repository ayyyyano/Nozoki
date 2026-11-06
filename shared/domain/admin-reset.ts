import { integrationPreset } from '../integration-presets/index.ts'
import { createDefaultConfig, type ConfigWrite } from '../contracts/config.ts'
import { editableConfig } from '../contracts/admin.ts'

export type AdminSection = 'site' | 'modules' | 'integrations' | 'schedule' | 'quotes' | 'links'

export function sectionResetIssue(config: ConfigWrite, section: AdminSection): string | null {
  return null
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
        integrations: defaults.integrations.flatMap((source) => {
          const existing = config.integrations.find(
            (i) => integrationPreset(i)?.id === integrationPreset(source)?.id,
          )
          // Reset never re-adds an untested source or changes an existing encrypted identity.
          return existing
            ? [
                {
                  ...source,
                  id: existing.id,
                  fieldMappings: existing.fieldMappings,
                  capabilities: existing.capabilities,
                  credential: { operation: 'clear' as const },
                },
              ]
            : []
        }),
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

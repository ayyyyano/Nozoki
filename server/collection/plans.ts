import type { StoredState, StoredIntegration } from '../repositories/config.ts'
import type { IntegrationSettings } from '../../shared/contracts/config.ts'
import type { ModuleId } from '../../shared/contracts/dashboard.ts'
import { credentialState } from '../services/credentials.ts'
import type { QuoteSymbolInput } from '../../shared/quotes/yahoo-symbol.ts'
import { sourceTargetKey } from '../../shared/contracts/source-access.ts'
export interface CollectionPlan {
  source: IntegrationSettings
  revision: string
  envelope: StoredIntegration['envelope']
  identityEnvelope?: StoredIntegration['identityEnvelope']
  configVersion: number
  references: { moduleId: ModuleId; subject: string }[]
  quoteSymbols?: readonly QuoteSymbolInput[]
}
export function collectionPlans(state: StoredState): CollectionPlan[] {
  return state.integrations.flatMap((i) => {
    if (!i.settings.enabled || !i.revision) return []
    const access = i.settings.access
    if (
      access &&
      access.mode !== 'legacy' &&
      (!access.approved || access.approvedTarget !== sourceTargetKey(i.settings, access))
    )
      return []
    const refs = state.config.modules
      .filter((m) => m.enabled && m.sources.main?.sourceId === i.settings.id)
      .map((m) => ({ moduleId: m.id, subject: m.sources.main!.subject }))
    // Local schedule/links alone never create external requests. A future confirmed activity view can piggyback.
    if (!refs.some((r) => !['activity', 'links'].includes(r.moduleId))) return []
    const quoteSymbols =
      i.settings.provider === 'quotes-custom'
        ? state.config.quotes
            .filter((q) => q.enabled && q.provider === i.settings.id)
            .map(({ market, symbol }) => ({ market, symbol }))
        : undefined
    if (quoteSymbols && (!quoteSymbols.length || !refs.some((r) => r.moduleId === 'quotes')))
      return []
    return [
      {
        source: { ...i.settings, credentialState: credentialState(i.envelope) },
        revision: i.revision,
        envelope: i.envelope,
        identityEnvelope: i.identityEnvelope,
        configVersion: state.config.site.configVersion,
        references: refs.filter((r) => r.moduleId !== 'links'),
        ...(quoteSymbols ? { quoteSymbols } : {}),
      },
    ]
  })
}

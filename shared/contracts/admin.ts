import type { Config, ConfigWrite } from './config.ts'
import { canonicalModules } from '../domain/module-layout.ts'
export const CONFIG_BODY_LIMIT = 1024 * 1024
export const AUTH_BODY_LIMIT = 4096
export const validRequestKey = (key: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)
/** Stable object keys; ordered arrays remain ordered unless the domain declares order via sortOrder. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}
export function editableConfig(config: Config): ConfigWrite {
  return {
    ...(JSON.parse(JSON.stringify(config)) as Config),
    modules: canonicalModules(JSON.parse(JSON.stringify(config.modules))),
    integrations: config.integrations.map(
      ({ credentialState: _state, identityConfigured: _identity, ...i }) => ({
        ...JSON.parse(JSON.stringify(i)),
        credential: { operation: 'keep' as const },
      }),
    ),
  }
}
export function orderedConfig<T extends ConfigWrite>(config: T): T {
  return {
    ...config,
    modules: canonicalModules(config.modules),
    integrations: config.integrations.toSorted((a, b) => a.id.localeCompare(b.id)),
    links: config.links.toSorted((a, b) => a.id.localeCompare(b.id)),
    quotes: config.quotes.toSorted((a, b) =>
      canonical([a.market, a.symbol, a.provider]).localeCompare(
        canonical([b.market, b.symbol, b.provider]),
      ),
    ),
  }
}

import type { Config, ConfigWrite } from '../contracts/config.ts'
import { requiresSourceTest } from '../integration-presets/connection.ts'

type Source = ConfigWrite['integrations'][number]
export type CredentialTestPlan = { id: string; needsTest: boolean; reason: string }
export function summarizeImportCredentialTests(results: readonly { proof?: string }[]) {
  const passed = results.filter((result) => !!result.proof).length
  return { passed, failed: results.length - passed }
}

/** Test only credentials actually supplied by the backup; other imports retain their existing flow. */
export function planImportCredentialTests(
  sources: readonly Source[],
  baseline: Config,
): CredentialTestPlan[] {
  return sources.map((source) => ({
    id: source.id,
    needsTest:
      source.credential.operation === 'replace' &&
      requiresSourceTest(
        source,
        baseline.integrations.find((old) => old.id === source.id),
      ),
    reason:
      source.credential.operation === 'replace' ? 'imported_credential' : 'no_imported_credential',
  }))
}

export function applyImportCredentialTest(
  source: Source,
  result: { proof?: string; reason?: string },
): Source {
  if (result.proof) return { ...source, connectionProof: result.proof }
  const access =
    source.access && source.access.mode !== 'legacy'
      ? { ...source.access, approved: false, approvedTarget: null }
      : source.access
  const { connectionProof: _proof, ...rest } = source
  return { ...rest, access, credential: { operation: 'clear' } }
}

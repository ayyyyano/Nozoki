import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultConfig, ConfigWriteSchema } from '../../shared/contracts/config.ts'
import { editableConfig } from '../../shared/contracts/admin.ts'
import {
  defaultSectionPatch,
  sectionResetIssue,
  type AdminSection,
} from '../../shared/domain/admin-reset.ts'

function customDraft() {
  const draft = editableConfig(createDefaultConfig())
  draft.site.siteName = 'Custom site'
  draft.site.configVersion = 42
  draft.site.appearance.sourceColor = '#006A6A'
  draft.site.background.overlay = 70
  draft.site.timezone = draft.site.schedule.timezone = 'Europe/London'
  draft.modules[0]!.title = 'Custom module'
  draft.integrations[0]!.enabled = false
  draft.integrations[0]!.credential = { operation: 'replace', value: 'synthetic-unsaved-secret' }
  draft.quotes[0]!.displayName = 'Custom quote'
  draft.links[0]!.title = 'Custom link'
  return draft
}

test('each reset changes only its owned section and leaves the input and version intact', () => {
  const sections: AdminSection[] = [
    'site',
    'schedule',
    'modules',
    'integrations',
    'quotes',
    'links',
  ]
  const defaults = editableConfig(createDefaultConfig())
  for (const section of sections) {
    const draft = customDraft(),
      before = structuredClone(draft)
    const patch = defaultSectionPatch(draft, section)
    const result = { ...draft, ...patch }
    assert.deepEqual(draft, before, section + ': input mutated')
    assert.equal(result.site.configVersion, 42)
    assert.equal(ConfigWriteSchema.safeParse(result).success, true, section + ': invalid config')
    for (const key of ['site', 'modules', 'integrations', 'quotes', 'links'] as const) {
      if (key === (section === 'schedule' ? 'site' : section)) continue
      assert.equal(result[key], draft[key], section + ': unrelated section replaced')
    }
    if (section === 'site') {
      assert.equal(result.site.siteName, defaults.site.siteName)
      assert.deepEqual(result.site.appearance, defaults.site.appearance)
      assert.deepEqual(result.site.background, defaults.site.background)
      assert.equal(result.site.schedule, draft.site.schedule)
      assert.equal(result.site.timezone, 'Europe/London')
    } else if (section === 'schedule') {
      assert.deepEqual(result.site.schedule, defaults.site.schedule)
      assert.equal(result.site.timezone, defaults.site.timezone)
      assert.equal(result.site.siteName, draft.site.siteName)
      assert.equal(result.site.appearance, draft.site.appearance)
      assert.equal(result.site.background, draft.site.background)
    } else if (section !== 'integrations') {
      assert.deepEqual(result[section], defaults[section])
    }
  }
})

test('source reset explicitly clears credentials and removes unreferenced sources', () => {
  const draft = customDraft()
  draft.integrations.push({ ...draft.integrations[0]!, id: 'extra-source' })
  const patch = defaultSectionPatch(draft, 'integrations')
  assert.deepEqual(
    patch.integrations!.map((source) => source.id),
    ['tencent'],
  )
  assert.deepEqual(patch.integrations![0]!.credential, { operation: 'clear' })
  assert.ok(!JSON.stringify(patch).includes('synthetic-unsaved-secret'))
  assert.equal(draft.integrations.length, 2)
  assert.equal(draft.integrations[0]!.credential.operation, 'replace')
})

test('source reset refuses dangling module and quote references without touching drafts', () => {
  for (const reference of ['module', 'quote'] as const) {
    const draft = customDraft()
    draft.integrations.push({ ...draft.integrations[0]!, id: 'custom-source' })
    if (reference === 'module') {
      draft.modules[0]!.enabled = false
      draft.modules[0]!.sources.main = { sourceId: 'custom-source', subject: 'default' }
    } else draft.quotes[0]!.provider = 'custom-source'
    const before = structuredClone(draft)
    assert.match(sectionResetIssue(draft, 'integrations')!, /custom-source/)
    assert.throws(() => defaultSectionPatch(draft, 'integrations'), /先解除/)
    assert.deepEqual(draft, before)
    assert.equal(sectionResetIssue(draft, 'links'), null)
  }
})

test('module and quote resets never create missing default sources or invalid references', () => {
  for (const compatible of [false, true]) {
    const draft = customDraft()
    if (!compatible) {
      draft.integrations = []
      draft.modules.find((module) => module.id === 'quotes')!.sources = {}
    }
    const modules = defaultSectionPatch(draft, 'modules')
    const quotes = defaultSectionPatch(draft, 'quotes')
    assert.deepEqual(
      modules.modules!.find((module) => module.id === 'quotes')!.sources,
      compatible ? { main: { sourceId: 'tencent', subject: 'default' } } : {},
    )
    assert.ok(quotes.quotes!.every((quote) => quote.provider === (compatible ? 'tencent' : null)))
    assert.equal(ConfigWriteSchema.safeParse({ ...draft, ...modules, ...quotes }).success, true)
    assert.equal(draft.integrations.length, compatible ? 1 : 0)
  }
})

test('reset outputs are fresh defaults rather than a shared mutable template', () => {
  const draft = customDraft()
  defaultSectionPatch(draft, 'links').links![0]!.title = 'Changed reset result'
  assert.equal(defaultSectionPatch(draft, 'links').links![0]!.title, '博客')
  assert.equal(createDefaultConfig().links[0]!.title, '博客')
})

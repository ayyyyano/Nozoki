import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFieldPath, fieldChoices, fieldPointer } from '../../shared/contracts/field-paths.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'
import { normalizeSchedule } from '../../shared/schedule/index.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
test('new schedule DTO paths accept only real fields and valid date keys', () => {
  const choices = fieldChoices('activity')
  assert.ok(choices.some((c) => c.dates.length > 0))
  for (const choice of choices) assert.ok(parseFieldPath('activity', fieldPointer(choice.path)))
  for (const path of [
    '/schedule/templates/@workday/slots/@morning/name',
    '/schedule/weekdays/1/slots/*/endDayOffset',
    '/schedule/exceptions/2026-10-30/rule/templateId',
    '/schedule/exceptions/*/name',
    '/schedule/calendar/2026-10-30/workday',
    '/schedule/override/text',
  ])
    assert.ok(parseFieldPath('activity', path), path)
  for (const path of [
    '/schedule/weekdays/8',
    '/schedule/templates/@workday/slots/@morning/unknown',
    '/schedule/exceptions/2026-02-30/name',
    '/schedule/exceptions/__proto__/name',
    '/schedule/timeZone',
  ])
    assert.equal(parseFieldPath('activity', path), null, path)
})
test('a hidden custom schedule label never changes the guest hash or appears in guest JSON', async () => {
  const c = createDefaultConfig()
  c.site.schedule = normalizeSchedule(c.site.schedule)
  c.site.schedule.templates[0]!.slots[0]!.name = 'PRIVATE_COURSE'
  c.modules.find((m) => m.id === 'activity')!.fields = {
    '/schedule/templates/@workday/slots/@morning/name': { enabled: true, visibility: 'admin' },
  }
  const state = { config: c, integrations: [], snapshots: [] },
    now = new Date('2026-10-26T00:30:00Z'),
    first = await projectGuestDashboard(state, now)
  assert.ok(!JSON.stringify(first).includes('PRIVATE_COURSE'))
  c.site.schedule.templates[0]!.slots[0]!.name = 'PRIVATE_CHANGED'
  assert.equal((await projectGuestDashboard(state, now)).configVersion, first.configVersion)
})

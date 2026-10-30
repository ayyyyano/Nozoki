import test from 'node:test'
import assert from 'node:assert/strict'
import { guardRequestBody } from '../../server/utils/request-body.ts'
import { projectGuestDashboard } from '../../server/services/dashboard.ts'
import { createDefaultConfig } from '../../shared/contracts/config.ts'

test('request guard retains Cloudflare cf metadata after replacing a capped body', async () => {
  const request = new Request('https://dashboard.example/api/admin/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
  })
  Object.defineProperty(request, 'cf', {
    value: { colo: 'SIN' },
    enumerable: true,
    configurable: true,
  })
  const guarded = await guardRequestBody(request)
  assert.ok(guarded instanceof Request)
  assert.deepEqual((guarded as Request & { cf?: unknown }).cf, { colo: 'SIN' })
  assert.equal(guarded.headers.get('content-type'), 'application/json')
  assert.equal(await guarded.text(), '{"ok":true}')
})

test('request guard rejects an oversized auth body before route parsing', async () => {
  const request = new Request('https://dashboard.example/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: ' '.repeat(5000),
  })
  const guarded = await guardRequestBody(request)
  assert.ok(guarded instanceof Response)
  assert.equal(guarded.status, 413)
})

test('public projection hash ignores hidden schedule fields but tracks public changes', async () => {
  const base = createDefaultConfig()
  const activity = base.modules.find((m) => m.id === 'activity')!
  activity.fields = { '/schedule/start': { enabled: true, visibility: 'admin' } }
  const state = { config: base, integrations: [], snapshots: [] }
  const first = await projectGuestDashboard(state, new Date('2026-10-29T00:00:00.000Z'))
  const privateChange = structuredClone(state)
  privateChange.config.site.schedule.start = '09:45'
  const second = await projectGuestDashboard(privateChange, new Date('2026-10-29T00:00:00.000Z'))
  assert.equal(second.configVersion, first.configVersion)
  const publicChange = structuredClone(state)
  publicChange.config.modules.find((m) => m.id === 'activity')!.fields = {}
  publicChange.config.site.schedule.start = '09:45'
  const third = await projectGuestDashboard(publicChange, new Date('2026-10-29T00:00:00.000Z'))
  assert.notEqual(third.configVersion, first.configVersion)
})

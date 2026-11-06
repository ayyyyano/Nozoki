import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSleepyStatus, normalizeSleepyPayload } from '../../shared/device-state/sleepy.ts'
import { normalizeDeviceState, validBattery } from '../../shared/device-state/types.ts'
import { presentDevice } from '../../shared/device-state/presentation.ts'

test('portable Sleepy parser recognizes source-confirmed prefix/suffix decorations and explicit zero', () => {
  for (const [text, percent, body] of [
    ['[🔋66%⚡] Visual Studio Code', 66, 'Visual Studio Code'],
    ['[🔋66%] Visual Studio Code', 66, 'Visual Studio Code'],
    ['Infinity-X Launcher[66%]🔋', 66, 'Infinity-X Launcher'],
    ['Launcher[66%]⚡', 66, 'Launcher'],
    ['[🔋0%] App', 0, 'App'],
    ['App[100%]🔋', 100, 'App'],
    ['[🔋66.5%] Window', 66.5, 'Window'],
    ['[🔋66%] <script>alert("x")</script>', 66, '<script>alert("x")</script>'],
    ['[68%]淘宝', 68, '淘宝'],
    ['Infinity-X Launcher[88%]⚡', 88, 'Infinity-X Launcher'],
    ['电量 35％', 35, '电量'],
    ['Task 66% complete', 66, 'Task  complete'],
    ['App [66%]', 66, 'App'],
    ['[66%] App🔋', 66, 'App🔋'],
    ['App [🔋66%] Text', 66, 'App Text'],
    [' [🔋66%] App', 66, 'App'],
    ['[🔋66%]App', 66, 'App'],
    ['App[66%]🔋 extra', 66, 'App extra'],
  ] as const) {
    const p = parseSleepyStatus(text)
    assert.equal(p.batteryPercent, percent, text)
    assert.equal(p.stateText, body, text)
    assert.equal(p.charging, null, 'glyph means power, not proven actual charging')
  }
})
test('invalid or ambiguous percentages are lossless; inference can be disabled', () => {
  for (const raw of [
    '[🔋101%] App',
    'App[-1%]🔋',
    '[🔋NaN%] App',
    '电量 50% 进度 70%',
    'App[1000%]',
    'App[-0.1%]',
    '',
    'x'.repeat(3000),
  ]) {
    assert.deepEqual(
      parseSleepyStatus(raw),
      { stateText: raw, batteryPercent: null, charging: null },
      raw,
    )
  }
  assert.equal(parseSleepyStatus(null).stateText, null)
  assert.equal(parseSleepyStatus('[🔋66%] App', false).stateText, '[🔋66%] App')
})
test('portable local JSON needs no server; independent capabilities and update times stay independent', () => {
  const time = 1793080800
  const [device] = normalizeSleepyPayload({
    success: true,
    time,
    device: {
      'a.b/~': {
        show_name: 'Offline fixture',
        using: null,
        status: 'Only a title',
        last_updated: time - 86400,
        fields: {
          online: 'false',
          batteryPercent: 99,
          charging: true,
          foregroundApp: 'DO-NOT-TRUST-ARBITRARY-FIELDS',
        },
      },
    },
  })
  assert.equal(device!.online, false)
  assert.equal(device!.using, null)
  assert.equal(device!.batteryPercent, null)
  assert.equal(device!.foregroundApp, null)
  assert.equal(device!.charging, null)
  assert.notEqual(device!.observedAt, device!.statusUpdatedAt)
  assert.ok(!JSON.stringify(device).includes('DO-NOT-TRUST'))
  assert.equal(presentDevice(device!).statusText, 'Only a title')
  for (const using of [false, true, null]) {
    const d = normalizeDeviceState({ ...device!, using, online: null, stateText: null })
    assert.equal(d.online, null)
    assert.equal(presentDevice(d).statusText, using === false ? '未在使用' : '状态未知')
  }
  assert.throws(() =>
    normalizeSleepyPayload({
      success: true,
      time,
      device: { a: { show_name: 'a', last_updated: 'now' } },
    }),
  )
  assert.throws(() => normalizeSleepyPayload({ success: false, time, device: {} }))
})
test('portable display options can independently remove status and battery with no provider assumptions', () => {
  const d = normalizeDeviceState({
    id: 'a',
    name: 'generic',
    using: false,
    online: null,
    stateText: 'Fallback',
    foregroundApp: 'Explicit application',
    batteryPercent: 0,
    charging: true,
    observedAt: null,
  })
  assert.equal(presentDevice(d).statusText, 'Explicit application')
  assert.equal(presentDevice(d).batteryLabel, '0%')
  assert.equal(presentDevice(d).batteryLevel, 'low')
  assert.equal(presentDevice(d, { battery: false }).statusText, 'Explicit application')
  assert.equal(presentDevice(d, { battery: false }).charging, false)
  assert.equal(presentDevice(d, { status: false }).statusText, '未在使用')
  assert.equal(presentDevice(d, { status: false }).batteryLabel, '0%')
  for (const value of [null, undefined, '66', -1, 101, NaN, Infinity])
    assert.equal(validBattery(value), false)
  const unknown = presentDevice({ ...d, batteryPercent: null })
  assert.equal(unknown.batteryLevel, 'unknown')
  assert.equal(unknown.batteryLabel, null)
  assert.equal(unknown.charging, false)
})

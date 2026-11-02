import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { formatTimestamp } from '../../shared/domain/format.ts'
import { stampISO, stampSeconds } from '../../server/adapters/common.ts'

test('UTC timestamps display in the site timezone without changing the instant', () => {
  const utc = '2026-11-02T05:02:48.141Z'
  assert.equal(formatTimestamp(utc, 'Asia/Shanghai'), '2026-11-02 13:02')
  assert.equal(formatTimestamp(utc, 'UTC'), '2026-11-02 05:02')
  assert.equal(formatTimestamp(utc, 'America/New_York'), '2026-11-02 00:02')
  assert.equal(
    formatTimestamp('2026-11-02T13:02:48.141+08:00', 'Asia/Shanghai'),
    '2026-11-02 13:02',
  )
  assert.equal(formatTimestamp('2026-11-02T20:30:00.000Z', 'Asia/Shanghai'), '2026-11-03 04:30')
  assert.equal(
    formatTimestamp('2026-11-02T00:30:00.000Z', 'America/Los_Angeles'),
    '2026-11-01 16:30',
  )
  assert.equal(formatTimestamp(null, 'Asia/Shanghai'), '尚无记录')
  assert.equal(formatTimestamp('invalid', 'Asia/Shanghai'), '尚无记录')
})

test('display uses IANA DST rules rather than a fixed hour offset', () => {
  assert.equal(formatTimestamp('2026-03-08T06:59:00.000Z', 'America/New_York'), '2026-03-08 01:59')
  assert.equal(formatTimestamp('2026-03-08T07:00:00.000Z', 'America/New_York'), '2026-03-08 03:00')
  assert.equal(formatTimestamp('2026-11-01T05:30:00.000Z', 'America/New_York'), '2026-11-01 01:30')
  assert.equal(formatTimestamp('2026-11-01T06:30:00.000Z', 'America/New_York'), '2026-11-01 01:30')
})

test('adapter timestamps normalize Unix seconds and explicit offsets to UTC only once', () => {
  const utc = '2026-11-02T05:02:48.141Z'
  assert.equal(stampISO('2026-11-02T13:02:48.141+08:00'), utc)
  assert.equal(stampISO(utc), utc)
  assert.equal(stampSeconds(Date.parse(utc) / 1000), utc)
  assert.throws(() => stampISO('2026-11-02T05:02:48.141'), { code: 'INVALID_RESPONSE' })
})

test('server host timezone does not affect rendering or offset parsing', () => {
  const formatter = new URL('../../shared/domain/format.ts', import.meta.url).href
  for (const tz of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `
      import { formatTimestamp } from ${JSON.stringify(formatter)};
      process.stdout.write(formatTimestamp('2026-11-02T05:02:48.141Z', 'Asia/Shanghai'));
    `,
      ],
      { env: { ...process.env, TZ: tz }, encoding: 'utf8' },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '2026-11-02 13:02', tz)
  }
})

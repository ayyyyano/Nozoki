import test from 'node:test'
import assert from 'node:assert/strict'
import { backgroundFixture } from '../fixtures/background.ts'
import {
  decodeBackgroundImage,
  backgroundImageHash,
  BACKGROUND_IMAGE_LIMIT,
} from '../../shared/contracts/background-image.ts'
import { BackgroundSchema } from '../../shared/contracts/config.ts'
import { parseAppearance } from '../../shared/contracts/appearance.ts'

test('uploaded background is a bounded static WebP with an exact same-origin content address', async () => {
  const bytes = decodeBackgroundImage(backgroundFixture)!
  assert.ok(bytes)
  const url = '/api/background/' + (await backgroundImageHash(bytes))
  const background = { ...parseAppearance(null).background, source: 'uploaded', url }
  assert.ok(BackgroundSchema.safeParse(background).success)
  assert.equal(parseAppearance({ background }).background.url, url)
  for (const url of [
    'https://example.com/a.webp',
    '/api/background/../config',
    'data:image/svg+xml,evil',
  ])
    assert.equal(BackgroundSchema.safeParse({ ...background, url }).success, false)
  assert.equal(BackgroundSchema.safeParse({ ...background, source: 'custom' }).success, false)
})

test('rejects active, oversized, truncated, animated and excessive-dimension image payloads', () => {
  for (const value of [
    btoa('<svg onload="evil()"/>'),
    '!!!!',
    'a',
    'A'.repeat(BACKGROUND_IMAGE_LIMIT * 2),
    backgroundFixture.slice(0, -4),
  ])
    assert.equal(decodeBackgroundImage(value), null)
  const bytes = Buffer.from(backgroundFixture, 'base64')
  const animated = Buffer.from(bytes)
  animated[20] = animated[20]! | 2
  assert.equal(decodeBackgroundImage(animated.toString('base64')), null)
  const huge = Buffer.from(bytes)
  huge[24] = 255
  huge[25] = 255
  huge[26] = 255
  assert.equal(decodeBackgroundImage(huge.toString('base64')), null)
  const wrongSize = Buffer.from(bytes)
  wrongSize.writeUInt32LE(1, 4)
  assert.equal(decodeBackgroundImage(wrongSize.toString('base64')), null)
})

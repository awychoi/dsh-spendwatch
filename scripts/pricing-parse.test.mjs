import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWindows } from './pricing-parse.mjs'

test('parses the published peak sentence', () => {
  const text = 'On weekdays (Monday to Friday, Beijing time) peak runs 01:00–04:00 and 06:00–10:00 UTC, everything else is off-peak, and weekends are off-peak all day.'
  assert.deepEqual(parseWindows(text), [
    { start: '01:00', end: '04:00' },
    { start: '06:00', end: '10:00' },
  ])
})

test('handles plain hyphens and repeated text', () => {
  const text = 'Peak hours: 01:00 - 04:00 UTC and 06:00 - 10:00 UTC. Peak hours: 01:00 - 04:00 UTC.'
  assert.deepEqual(parseWindows(text), [
    { start: '01:00', end: '04:00' },
    { start: '06:00', end: '10:00' },
  ])
})

test('ignores ranges without peak context', () => {
  assert.deepEqual(parseWindows('Support hours are 09:00–17:00 UTC every day.'), [])
})

test('drops cross-midnight ranges', () => {
  assert.deepEqual(parseWindows('Peak window 22:00–02:00 UTC is not used.'), [])
})

/**
 * Story 286: a date reads the same on any server. A date picker's wall clock is
 * kept with no zone meaning UTC, and `new Date` reads text with no zone in the
 * server's, so a host on UTC hides every mistake of this kind. These run in a
 * process of their own under each zone, and CI runs the suite in one of them.
 */
import { describe, expect, test } from 'bun:test'
import { dateFromText, toEditorValue, toPublishedValue } from '@crombolo/core'
import { ROOT } from '../scripts/packages.ts'

const DATE = 'Umbraco.DateTime'
const ZONES = ['Australia/Brisbane', 'UTC', 'America/Los_Angeles']

/** What this code gives in a process running in a zone, as one JSON value. */
function inZone(zone: string, code: string): unknown {
  const script = `import { dateFromText, toEditorValue, toPublishedValue } from '@crombolo/core'
const DATE = ${JSON.stringify(DATE)}
console.log(JSON.stringify(${code}))`
  const proc = Bun.spawnSync(['bun', '-e', script], {
    cwd: ROOT,
    env: { ...process.env, TZ: zone },
  })
  expect(proc.exitCode, proc.stderr.toString()).toBe(0)
  return JSON.parse(proc.stdout.toString())
}

describe.each(ZONES)('on a server in %s', (zone) => {
  test('the zone is the one asked for', () => {
    const offset = inZone(zone, 'new Date("2026-06-25T00:00:00Z").getTimezoneOffset()')
    expect(offset).toBe({ UTC: 0, 'Australia/Brisbane': -600 }[zone] ?? 420)
  })

  test('a wall clock reads as it was entered, however many times it is read', () => {
    expect(
      inZone(
        zone,
        `[
        toEditorValue(DATE, '2026-06-25 09:18:20'),
        toPublishedValue(DATE, toEditorValue(DATE, '2026-06-25T09:18:20.000Z')),
        toPublishedValue(DATE, toEditorValue(DATE, '2026-06-25 00:30:00')),
      ]`,
      ),
    ).toEqual(['2026-06-25 09:18:20', '2026-06-25 09:18:20', '2026-06-25 00:30:00'])
  })

  test('its forms come out alike, and an instant reads as its UTC wall clock', () => {
    expect(
      inZone(
        zone,
        `[
        toEditorValue(DATE, '2026-06-25T09:18:20'),
        toEditorValue(DATE, '2026-06-25'),
        toEditorValue(DATE, '2026-06-25 09:18'),
        toEditorValue(DATE, '2026-06-25 09:18:20.123'),
        toEditorValue(DATE, '2026-06-25T09:18:20Z'),
        toEditorValue(DATE, '2026-06-25T09:18:20+10:00'),
      ]`,
      ),
    ).toEqual([
      '2026-06-25 09:18:20',
      '2026-06-25 00:00:00',
      '2026-06-25 09:18:00',
      '2026-06-25 09:18:20',
      '2026-06-25 09:18:20',
      '2026-06-24 23:18:20',
    ])
  })

  test('text with no zone is one instant, wherever it is read', () => {
    expect(inZone(zone, `dateFromText('2026-06-25 09:18:20')`)).toBe('2026-06-25T09:18:20.000Z')
  })
})

describe('text that is no date', () => {
  test('is left as it is, and is no instant', () => {
    expect(toEditorValue(DATE, 'soon')).toBe('soon')
    expect(dateFromText('soon')).toBeUndefined()
    expect(dateFromText('')).toBeUndefined()
  })

  test('nothing stored stays nothing', () => {
    expect(toPublishedValue(DATE, null)).toBeNull()
  })
})

/** Story 433: what the Service accounts screen says, outside a browser. */
import { describe, expect, test } from 'bun:test'
import {
  lastUsedLine,
  OLD_STOPS,
  stopQuestion,
  usedForLine,
} from '../packages/backoffice-host/plugin/service-accounts-words.js'

describe('the Service accounts screen’s words', () => {
  const now = Date.parse('2026-11-26T12:00:00Z')
  test('say when an account was last used, to the hour it is written', () => {
    expect(lastUsedLine(null, now)).toBe('Never used')
    expect(lastUsedLine('2026-11-26T11:40:00Z', now)).toBe('Last used within the hour')
    expect(lastUsedLine('2026-11-26T09:00:00Z', now)).toBe('Last used 3 hours ago')
    expect(lastUsedLine('2026-11-23T12:00:00Z', now)).toBe('Last used 3 days ago')
  })

  test('say what it is used for, and what stops before it is taken away', () => {
    expect(usedForLine([])).toBe('Not named in the site’s settings')
    expect(usedForLine(['A', 'B'])).toBe('A · B')
    expect(stopQuestion('Delete', 'Importer', []).content).toBe(
      'Nothing in the site’s settings uses it.',
    )
    const asked = stopQuestion('Disable', 'Importer', ["Changes pages for the site's own code"])
    expect(asked.headline).toBe('Disable Importer?')
    expect(asked.content).toContain(
      "These will stop working: Changes pages for the site's own code.",
    )
    expect(OLD_STOPS.map((o) => o.value)).toEqual(['now', 'day', 'week'])
  })
})

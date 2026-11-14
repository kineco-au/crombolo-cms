/** Story 314: what the back office says while an administrator views it as user groups. */
import { describe, expect, test } from 'bun:test'
import {
  groupNames,
  msUntil,
  startButton,
  viewingLabel,
} from '../packages/backoffice-host/plugin/view-as-words.js'

describe('viewing as a group, in words', () => {
  test('names the groups and when it ends', () => {
    expect(groupNames([{ name: 'Editors' }])).toBe('Editors')
    expect(groupNames([{ name: 'Editors' }, { name: 'Writers' }])).toBe('Editors, Writers')
    const until = new Date(2026, 10, 14, 14, 32).toISOString()
    expect(
      viewingLabel({ groups: [{ name: 'Editors' }, { name: 'Writers' }], until }, 'en-GB'),
    ).toBe('Viewing as Editors, Writers until 14:32')
  })

  test('Start waits for a group', () => {
    expect(startButton([])).toEqual({ enabled: false, label: 'Choose a group' })
    expect(startButton(['a'])).toEqual({ enabled: true, label: 'View as this group' })
    expect(startButton(['a', 'b'])).toEqual({ enabled: true, label: 'View as these groups' })
  })

  test('counts down to the end, and not past it', () => {
    const now = Date.parse('2026-11-14T10:00:00Z')
    expect(msUntil('2026-11-14T10:30:00Z', now)).toBe(30 * 60_000)
    expect(msUntil('2026-11-14T09:00:00Z', now)).toBe(0)
  })
})

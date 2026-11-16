/** Story 028: what the Approvals section says. */
import { describe, expect, test } from 'bun:test'
import { waitingLine } from '../packages/backoffice-host/plugin/approvals-words.js'

describe('approvals, in words', () => {
  test('counts the changes waiting', () => {
    expect(waitingLine(0)).toBe('You have no changes waiting for approval.')
    expect(waitingLine(1)).toBe('You have 1 change waiting for approval.')
    expect(waitingLine(3)).toBe('You have 3 changes waiting for approval.')
  })
})

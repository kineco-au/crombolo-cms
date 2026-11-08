/**
 * The tree beside Approvals: one Pending folder of every request still open,
 * those waiting on the reader first and marked, each group in the order sent.
 */
import { expect, test } from 'bun:test'
import { pendingForTree } from '../packages/backoffice-host/plugin/approvals-tree-model.js'

test('pending requests, those waiting on me first and marked, nothing decided', () => {
  const pending = [
    { key: 'a', state: 'waiting' },
    { key: 'b', state: 'scheduled' },
    { key: 'c', state: 'waiting' },
    { key: 'd', state: 'approved' },
  ]
  expect(pendingForTree(pending, [{ key: 'c' }]).map((r) => [r.key, r.mine])).toEqual([
    ['c', true],
    ['a', false],
    ['b', false],
  ])
  expect(pendingForTree(undefined, undefined)).toEqual([])
})

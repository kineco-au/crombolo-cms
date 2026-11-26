/** Story 229: the designer marks a stage naming a group that is not here. */
import { expect, test } from 'bun:test'
import { missingGroups } from '../packages/backoffice-host/plugin/workflow-graph.js'

test('a stage’s groups that are not here, by alias', () => {
  const groups = [{ alias: 'legal' }, { alias: 'editor' }]
  expect(missingGroups({ approvers: ['legal', 'compliance'] }, groups)).toEqual(['compliance'])
  expect(missingGroups({ approvers: ['legal'] }, groups)).toEqual([])
})

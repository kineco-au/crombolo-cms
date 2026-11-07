/**
 * Story 289: forms and workflows as a tree, and the words for when they cannot be
 * changed, which name no part of how the site is built.
 */
import { describe, expect, test } from 'bun:test'
import {
  definitionTree,
  readOnlyWords,
} from '../packages/backoffice-host/plugin/definition-tree-model.js'

describe('the tree', () => {
  test('folders from their paths, with their items, sorted, empty ones kept', () => {
    const tree = definitionTree(
      [
        { alias: 'z', name: 'Zebra', folder: '' },
        { alias: 'a', name: 'Apple', folder: '' },
        { alias: 'deep', name: 'Deep', folder: 'Contact/Sales' },
      ],
      ['Contact', 'Contact/Sales', 'Empty'],
    )
    expect(tree.items.map((item) => item.alias)).toEqual(['a', 'z'])
    expect(tree.folders.map((folder) => folder.name)).toEqual(['Contact', 'Empty'])
    expect(tree.folders[0]?.folders[0]).toMatchObject({ name: 'Sales', path: 'Contact/Sales' })
    expect(tree.folders[0]?.folders[0]?.items[0]?.alias).toBe('deep')
    expect(tree.folders[1]).toMatchObject({ folders: [], items: [] })
  })

  test('a folder only an item names still shows', () => {
    const tree = definitionTree([{ alias: 'a', name: 'A', folder: 'Late' }], [])
    expect(tree.folders.map((folder) => folder.path)).toEqual(['Late'])
  })
})

describe('why something cannot be changed', () => {
  test('says so plainly, by reason, and nothing when it can', () => {
    expect(readOnlyWords('Forms', 'site')).toContain("can't be changed here")
    expect(readOnlyWords('Workflows', 'permission')).toBe(
      'Only administrators can change workflows.',
    )
    expect(readOnlyWords('Forms', null)).toBeUndefined()
  })

  test('names no part of how the site is built', () => {
    for (const because of ['site', 'permission'])
      expect(readOnlyWords('Forms', because)).not.toMatch(/schema|node|store|directory/i)
  })
})

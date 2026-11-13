/**
 * Story 345: the one list of block editors and the one reader of block values.
 */
import { describe, expect, test } from 'bun:test'
import {
  BLOCK_EDITORS,
  blockLists,
  blockValueOf,
  everyBlock,
  JSON_VALUE_EDITORS,
  readBlocks,
  SINGLE_BLOCK_EDITOR_ALIAS,
} from '@crombolo/core'

const data = (
  key: string,
  values: Array<{ alias: string; value: unknown; editorAlias?: string }> = [],
) => ({
  key,
  contentTypeKey: 'type',
  values,
})

describe('the block editors', () => {
  test('are Block List, Block Grid, Single Block and rich text, and store JSON', () => {
    expect([...BLOCK_EDITORS].sort()).toEqual([
      'Umbraco.BlockGrid',
      'Umbraco.BlockList',
      'Umbraco.RichText',
      'Umbraco.SingleBlock',
    ])
    for (const editor of BLOCK_EDITORS) expect(JSON_VALUE_EDITORS.has(editor)).toBe(true)
  })
})

describe('reading a block value', () => {
  const single = {
    layout: { [SINGLE_BLOCK_EDITOR_ALIAS]: [{ contentKey: 'c1', settingsKey: 's1' }] },
    contentData: [data('c1', [{ alias: 'title', value: 'Hero' }])],
    settingsData: [data('s1')],
  }

  test('gives each entry its content and settings, from an object or JSON text', () => {
    for (const value of [single, JSON.stringify(single)]) {
      const [block] = readBlocks(value, SINGLE_BLOCK_EDITOR_ALIAS)
      expect(block?.content?.key).toBe('c1')
      expect(block?.settings?.key).toBe('s1')
    }
    expect(readBlocks(single, 'Umbraco.BlockList')).toEqual([])
    expect(readBlocks('not json')).toEqual([])
  })

  test('takes rich text’s blocks from its `blocks`', () => {
    const rich = {
      markup: '<p/>',
      blocks: { layout: { 'Umbraco.RichText': [{ contentKey: 'c1' }] }, contentData: [data('c1')] },
    }
    expect(readBlocks(blockValueOf('Umbraco.RichText', rich), 'Umbraco.RichText')).toHaveLength(1)
    expect(blockValueOf('Umbraco.TextBox', 'text')).toBeUndefined()
  })

  test('walks grid areas as lists of their own, and blocks within a block’s values', () => {
    const inner = {
      layout: { 'Umbraco.BlockList': [{ contentKey: 'n1' }] },
      contentData: [data('n1')],
    }
    const grid = {
      layout: {
        'Umbraco.BlockGrid': [
          { contentKey: 'g1', areas: [{ key: 'a', items: [{ contentKey: 'g2' }] }] },
        ],
      },
      contentData: [
        data('g1', [
          { alias: 'list', value: JSON.stringify(inner), editorAlias: 'Umbraco.BlockList' },
        ]),
        data('g2'),
      ],
    }
    expect(blockLists(grid).map((list) => list.map((b) => b.content?.key))).toEqual([
      ['g1'],
      ['g2'],
    ])
    expect(everyBlock(grid).map((b) => b.content?.key)).toEqual(['g1', 'g2', 'n1'])
  })
})

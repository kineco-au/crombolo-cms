/**
 * Story 456: the server's block rules, as Umbraco's, and the paths and words it
 * reports them with.
 */
import { describe, expect, test } from 'bun:test'
import {
  blockMessages,
  blockTypeKeys,
  blockValueProblems,
  isEmptyValue,
  type ValidatedElementType,
  type ValidatedProperty,
  validationPath,
} from '@crombolo/core'

const prop = (alias: string, over: Partial<ValidatedProperty> = {}): ValidatedProperty => ({
  alias,
  editorAlias: 'Umbraco.TextBox',
  config: {},
  variesByCulture: false,
  mandatory: false,
  mandatoryMessage: null,
  regEx: null,
  regExMessage: null,
  ...over,
})

const HERO = 'aaaaaaaa-0000-4000-8000-000000000001'
const SETTINGS = 'aaaaaaaa-0000-4000-8000-000000000002'
const QUOTE = 'aaaaaaaa-0000-4000-8000-000000000003'
const COLUMNS = 'aaaaaaaa-0000-4000-8000-000000000004'
const LEFT = 'bbbbbbbb-0000-4000-8000-000000000001'

const nested = prop('items', {
  editorAlias: 'Umbraco.BlockList',
  config: { blocks: [{ contentElementTypeKey: QUOTE }] },
})

const types: Record<string, ValidatedElementType> = {
  [HERO]: {
    key: HERO,
    name: 'Hero',
    properties: [
      prop('title', { mandatory: true }),
      prop('code', { regEx: '^[A-Z]+$', regExMessage: 'Capitals only' }),
      prop('caption', { variesByCulture: true, mandatory: true }),
      nested,
    ],
  },
  [SETTINGS]: {
    key: SETTINGS,
    name: 'Hero settings',
    properties: [prop('theme', { mandatory: true })],
  },
  [QUOTE]: { key: QUOTE, name: 'Quote', properties: [prop('text', { mandatory: true })] },
  [COLUMNS]: { key: COLUMNS, name: 'Columns', properties: [] },
}
const lookup = (key: string) => types[key]

const list = (config: Record<string, unknown> = {}) =>
  prop('blocks', {
    editorAlias: 'Umbraco.BlockList',
    config: {
      blocks: [{ contentElementTypeKey: HERO, settingsElementTypeKey: SETTINGS }],
      ...config,
    },
  })

const block = (
  key: string,
  typeKey: string,
  values: Record<string, unknown> = {},
): {
  key: string
  contentTypeKey: string
  values: Array<{ alias: string; value: unknown; culture: string | null; segment: string | null }>
} => ({
  key,
  contentTypeKey: typeKey,
  values: Object.entries(values).map(([alias, value]) => ({
    alias,
    value,
    culture: null,
    segment: null,
  })),
})

const listValue = (
  contents: ReturnType<typeof block>[],
  settings: ReturnType<typeof block>[] = [],
) => ({
  layout: {
    'Umbraco.BlockList': contents.map((c, i) => ({
      contentKey: c.key,
      ...(settings[i] ? { settingsKey: settings[i]?.key } : {}),
    })),
  },
  contentData: contents,
  settingsData: settings,
})

const filled = (key: string) => block(key, HERO, { title: 'A title' })

describe('block counts', () => {
  test('too few and too many are refused in Umbraco’s words', () => {
    const p = list({ validationLimit: { min: 2, max: 3 } })
    expect(blockValueProblems(p, listValue([filled('c1')]), lookup, [])).toEqual([
      { path: '', messages: ['Minimum 2 entries, requires 1 more.'] },
    ])
    const four = ['c1', 'c2', 'c3', 'c4'].map(filled)
    expect(blockValueProblems(p, listValue(four), lookup, [])).toEqual([
      { path: '', messages: ['Maximum 3 entries, 1 too many.'] },
    ])
    expect(blockValueProblems(p, listValue(four.slice(0, 2)), lookup, [])).toEqual([])
  })

  test('no value at all is fewer than a minimum', () => {
    const p = list({ validationLimit: { min: 1 } })
    expect(blockValueProblems(p, null, lookup, [])).toEqual([
      { path: '', messages: [blockMessages.tooFew(1, 0)] },
    ])
  })

  test('a value stored as JSON text is read the same', () => {
    const p = list({ validationLimit: { max: 1 } })
    const text = JSON.stringify(listValue([filled('c1'), filled('c2')]))
    expect(blockValueProblems(p, text, lookup, [])[0]?.messages).toEqual([
      'Maximum 1 entries, 1 too many.',
    ])
  })
})

describe('properties inside a block', () => {
  test('a mandatory field and a pattern, in content and settings, at Umbraco’s paths', () => {
    const value = listValue(
      [filled('c1'), block('c2', HERO, { code: 'lower' })],
      [block('s1', SETTINGS, { theme: 'dark' }), block('s2', SETTINGS)],
    )
    expect(blockValueProblems(list(), value, lookup, [])).toEqual([
      {
        path: ".contentData[1].values[?(@.alias == 'title' && @.culture == null && @.segment == null)].value",
        messages: ['Value cannot be empty'],
      },
      {
        path: ".contentData[1].values[?(@.alias == 'code' && @.culture == null && @.segment == null)].value",
        messages: ['Capitals only'],
      },
      {
        path: ".settingsData[1].values[?(@.alias == 'theme' && @.culture == null && @.segment == null)].value",
        messages: ['Value cannot be empty'],
      },
    ])
  })

  test('blocks within blocks are checked at any depth', () => {
    const inner = listValue([block('q1', QUOTE)])
    inner.layout = { 'Umbraco.BlockList': [{ contentKey: 'q1' }] }
    const value = listValue([block('c1', HERO, { title: 'T', items: inner })])
    expect(blockValueProblems(list(), value, lookup, [])).toEqual([
      {
        path: ".contentData[0].values[?(@.alias == 'items' && @.culture == null && @.segment == null)].value.contentData[0].values[?(@.alias == 'text' && @.culture == null && @.segment == null)].value",
        messages: ['Value cannot be empty'],
      },
    ])
  })

  test('a culture-variant block is checked in each culture its expose names, of those validated', () => {
    const hero = {
      key: 'c1',
      contentTypeKey: HERO,
      values: [
        { alias: 'title', value: 'T', culture: null, segment: null },
        { alias: 'caption', value: 'Hello', culture: 'en-US', segment: null },
      ],
    }
    const value = {
      ...listValue([hero]),
      expose: [
        { contentKey: 'c1', culture: 'en-US', segment: null },
        { contentKey: 'c1', culture: 'da-DK', segment: null },
      ],
    }
    expect(blockValueProblems(list(), value, lookup, ['en-US', 'da-DK', 'de-DE'])).toEqual([
      {
        path: ".contentData[0].values[?(@.alias == 'caption' && @.culture == 'da-DK' && @.segment == null)].value",
        messages: ['Value cannot be empty'],
      },
    ])
    // German is not exposed, so it is not asked for; publishing English alone passes.
    expect(blockValueProblems(list(), value, lookup, ['en-US'])).toEqual([])
  })
})

describe('block types offered', () => {
  test('a type the property does not offer, and a settings type it does not, are refused', () => {
    const value = listValue(
      [block('c1', QUOTE, { text: 'x' }), filled('c2')],
      [block('s1', SETTINGS, { theme: 'x' }), block('s2', QUOTE, { text: 'x' })],
    )
    expect(blockValueProblems(list(), value, lookup, [])).toEqual([
      { path: '.contentData[0]', messages: ['Quote is not allowed at this spot.'] },
      { path: '.settingsData[1]', messages: ['Quote is not allowed at this spot.'] },
    ])
  })

  test('rich text’s blocks are its value’s `blocks`', () => {
    const rte = prop('body', {
      editorAlias: 'Umbraco.RichText',
      config: { blocks: [{ contentElementTypeKey: HERO }] },
    })
    const value = {
      markup: '<umb-rte-block data-content-key="c1"></umb-rte-block>',
      blocks: {
        layout: { 'Umbraco.RichText': [{ contentKey: 'c1' }] },
        contentData: [block('c1', QUOTE, { text: 'x' })],
        settingsData: [],
      },
    }
    expect(blockValueProblems(rte, value, lookup, [])).toEqual([
      { path: '.blocks.contentData[0]', messages: ['Quote is not allowed at this spot.'] },
    ])
  })
})

describe('grid areas', () => {
  const grid = prop('grid', {
    editorAlias: 'Umbraco.BlockGrid',
    config: {
      blocks: [
        {
          contentElementTypeKey: COLUMNS,
          areas: [
            {
              key: LEFT,
              alias: 'left',
              maxAllowed: 1,
              specifiedAllowance: [{ elementTypeKey: QUOTE }],
            },
          ],
        },
        { contentElementTypeKey: QUOTE, allowAtRoot: false },
        { contentElementTypeKey: HERO, allowInAreas: false },
      ],
    },
  })
  const gridValue = (
    inArea: ReturnType<typeof block>[],
    atRoot: ReturnType<typeof block>[] = [],
  ) => ({
    layout: {
      'Umbraco.BlockGrid': [
        {
          contentKey: 'g1',
          areas: [{ key: LEFT, items: inArea.map((b) => ({ contentKey: b.key })) }],
        },
        ...atRoot.map((b) => ({ contentKey: b.key })),
      ],
    },
    contentData: [block('g1', COLUMNS), ...inArea, ...atRoot],
    settingsData: [],
  })

  test('an area’s allowance and its limit, and a block kept from the root', () => {
    expect(
      blockValueProblems(grid, gridValue([block('q1', QUOTE, { text: 'x' })]), lookup, []),
    ).toEqual([])
    expect(blockValueProblems(grid, gridValue([filled('h1')]), lookup, [])).toEqual([
      { path: '.contentData[1]', messages: ['Hero is not allowed at this spot.'] },
    ])
    expect(
      blockValueProblems(
        grid,
        gridValue([block('q1', QUOTE, { text: 'x' }), block('q2', QUOTE, { text: 'y' })]),
        lookup,
        [],
      ),
    ).toEqual([{ path: '.contentData[0]', messages: [blockMessages.areas] }])
    expect(
      blockValueProblems(grid, gridValue([], [block('q3', QUOTE, { text: 'x' })]), lookup, []),
    ).toEqual([{ path: '.contentData[1]', messages: ['Quote is not allowed at this spot.'] }])
  })
})

describe('what the rules read', () => {
  test('an empty list is empty for a mandatory rule; rich text is not a list', () => {
    expect(isEmptyValue('Umbraco.BlockList', listValue([]))).toBe(true)
    expect(isEmptyValue('Umbraco.BlockList', listValue([filled('c1')]))).toBe(false)
    expect(isEmptyValue('Umbraco.TextBox', '  ')).toBe(true)
  })

  test('every type key a value names, nested ones included', () => {
    const inner = listValue([block('q1', QUOTE)])
    const value = listValue([block('c1', HERO, { items: inner })], [block('s1', SETTINGS)])
    expect(blockTypeKeys('Umbraco.BlockList', value, lookup).sort()).toEqual(
      [HERO, QUOTE, SETTINGS].sort(),
    )
  })

  test('a full path names the page’s value, then the block', () => {
    expect(
      validationPath({ alias: 'blocks', culture: 'en-US', segment: null, path: '.contentData[0]' }),
    ).toBe(
      "$.values[?(@.alias == 'blocks' && @.culture == 'en-US' && @.segment == null)].value.contentData[0]",
    )
  })
})

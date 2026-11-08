/**
 * A page's history panel: what changed from one version to the one before it,
 * told a property and a language at a time.
 */
import { describe, expect, test } from 'bun:test'
import {
  changeCultures,
  changesIn,
  describeValue,
  versionChanges,
} from '../packages/backoffice-host/plugin/page-history-model.js'

const version = (name: string, values: Record<string, unknown>, culture: string | null = null) => ({
  variants: [{ culture, name }],
  values: Object.entries(values).map(([alias, value]) => ({
    alias,
    culture,
    segment: null,
    value,
  })),
})

describe('what changed', () => {
  test('lists a renamed page and each property whose value differs, by its name', () => {
    const before = version('Home', { title: 'Welcome', body: '<p>Hi</p>', tags: ['a'] })
    const after = version('Home page', {
      title: 'Welcome',
      body: '<p>Hello <b>there</b></p>',
      tags: ['a'],
    })
    expect(versionChanges(before, after, new Map([['body', 'Body text']]))).toEqual([
      { label: 'Name', culture: null, before: 'Home', after: 'Home page' },
      { label: 'Body text', culture: null, before: 'Hi', after: 'Hello there' },
    ])
  })

  test('says when a value was emptied, and keeps languages apart', () => {
    const before = {
      variants: [
        { culture: 'en-US', name: 'Home' },
        { culture: 'da-DK', name: 'Hjem' },
      ],
      values: [
        { alias: 'title', culture: 'en-US', segment: null, value: 'Hi' },
        { alias: 'title', culture: 'da-DK', segment: null, value: 'Hej' },
      ],
    }
    const after = {
      variants: [
        { culture: 'en-US', name: 'Home' },
        { culture: 'da-DK', name: 'Hjem' },
      ],
      values: [{ alias: 'title', culture: 'en-US', segment: null, value: 'Hi' }],
    }
    expect(versionChanges(before, after)).toEqual([
      { label: 'title', culture: 'da-DK', before: 'Hej', after: '(empty)' },
    ])
  })

  test('with nothing before, lists everything the first version held', () => {
    expect(versionChanges(undefined, version('New', { title: 'Hello' }))).toEqual([
      { label: 'Name', culture: null, before: '(none)', after: 'New' },
      { label: 'title', culture: null, before: '(empty)', after: 'Hello' },
    ])
  })
})

describe('a value in a line', () => {
  test('is its words, a count, or empty', () => {
    expect(describeValue('')).toBe('(empty)')
    expect(describeValue(null)).toBe('(empty)')
    expect(describeValue(true)).toBe('true')
    expect(describeValue({ markup: '<p>A&nbsp;b</p>' })).toBe('A b')
    expect(describeValue({ contentData: [{}, {}], layout: {} })).toBe('2 blocks')
    expect(describeValue([{ key: 1 }])).toBe('1 item')
    expect(describeValue('x'.repeat(200))).toHaveLength(140)
  })
})

describe('the language chips', () => {
  const changes = [
    { label: 'Title', culture: 'da-DK', before: 'a', after: 'b' },
    { label: 'Title', culture: 'en-US', before: 'a', after: 'b' },
    { label: 'Logo', culture: null, before: 'a', after: 'b' },
  ]

  test('are the languages changed, the default first', () => {
    expect(changeCultures(changes, 'en-US')).toEqual(['en-US', 'da-DK'])
    expect(changeCultures(changes, 'fr-FR')).toEqual(['da-DK', 'en-US'])
    expect(changeCultures([changes[2] as (typeof changes)[number]], 'en-US')).toEqual([])
  })

  test('include every language the page is in, changed or not', () => {
    expect(changeCultures([], 'en-GB', ['fr-FR', 'en-GB'])).toEqual(['en-GB', 'fr-FR'])
  })

  test('show a language’s own changes and those every language shares', () => {
    expect(changesIn(changes, 'da-DK').map((c: { culture: string | null }) => c.culture)).toEqual([
      'da-DK',
      null,
    ])
    expect(changesIn(changes, undefined)).toHaveLength(3)
  })
})

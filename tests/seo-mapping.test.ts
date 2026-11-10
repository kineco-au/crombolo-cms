/**
 * Story 317: a search and sharing value as a type or a page sets it — fixed
 * text, `{alias}`, `{#key}`, or a mix — read, checked in a schema file, and
 * offered as it is typed in the back office.
 */
import { describe, expect, test } from 'bun:test'
import { expandSeoValue, seoTokens } from '@crombolo/core'
import {
  insertProperty,
  propertySuggestions,
  typedProperty,
} from '../packages/backoffice-host/plugin/seo/value-model.js'

const read = (values: Record<string, string>, words: Record<string, string> = {}) => ({
  property: (alias: string) => values[alias] ?? '',
  word: (key: string) => words[key],
})

describe('a value', () => {
  test('names properties and dictionary items, and writes a brace doubled', () => {
    expect(seoTokens('{heading} | {#site.name} {{literal}}')).toEqual([
      { kind: 'property', alias: 'heading' },
      { kind: 'word', key: 'site.name' },
    ])
    expect(
      expandSeoValue('{heading} | {#site.name}', read({ heading: 'Hi' }, { 'site.name': 'Acme' })),
    ).toBe('Hi | Acme')
    expect(expandSeoValue('{{fixed}}', read({}))).toBe('{fixed}')
    expect(expandSeoValue('Just text', read({}))).toBe('Just text')
  })

  test('is unset when empty, or when everything it names reads empty', () => {
    expect(expandSeoValue('', read({}))).toBeUndefined()
    expect(expandSeoValue('  ', read({}))).toBeUndefined()
    expect(expandSeoValue('{summary} {#missing}', read({ summary: ' ' }))).toBeUndefined()
    expect(expandSeoValue('{summary} | {#site}', read({}, { site: 'Acme' }))).toBe('| Acme')
  })
})

describe('the back office box', () => {
  const properties = [
    { alias: 'heading', name: 'Heading' },
    { alias: 'summary', name: 'Summary' },
    { alias: 'subheading', name: 'Sub heading' },
  ]

  test('offers the properties after a `{`, but not after `{{` or `{#`', () => {
    expect(typedProperty('Hello {he')).toEqual({ typed: 'he', start: 6 })
    expect(typedProperty('Hello {{he')).toBeUndefined()
    expect(typedProperty('Hello {#he')).toBeUndefined()
    expect(typedProperty('{heading} done')).toBeUndefined()
    expect(propertySuggestions(properties, '{he').map((p) => p.alias)).toEqual([
      'heading',
      'subheading',
    ])
    expect(propertySuggestions(properties, 'no brace')).toEqual([])
  })

  test('puts the chosen one in as `{alias}`', () => {
    expect(insertProperty('Hello {he', 'heading')).toBe('Hello {heading}')
    expect(insertProperty('Hello ', 'heading')).toBe('Hello {heading}')
  })
})

/**
 * Story 297: `{#key}` names a dictionary item in a form or a page's text, and
 * reads as its words; a key naming nothing shows as written.
 */
import { describe, expect, test } from 'bun:test'
import {
  bareDictionaryWord,
  dictionaryWordNames,
  onlyDictionaryWord,
  resolveDictionaryWords,
  resolveDictionaryWordsInMarkup,
} from '@crombolo/core'
import { convertValue, type ValueContext } from '@crombolo/render'
import { wordsByLanguage } from '../packages/server/src/dictionary-words-api.ts'
import { braceFormWords } from '../packages/server/src/form-word-upgrade.ts'

const WORDS: Record<string, string> = { 'site.name': 'Harbourstone', greeting: 'Kia ora' }
const word = (name: string) => WORDS[name.toLowerCase()]

describe('{#key} in a text', () => {
  test('reads as the item’s words, wherever it is in the text', () => {
    expect(resolveDictionaryWords('{#greeting}, welcome to {#site.name}', word)).toBe(
      'Kia ora, welcome to Harbourstone',
    )
  })

  test('stays as written when no item has the name, and plain text is untouched', () => {
    expect(resolveDictionaryWords('{#nothing.here} and #site.name', word)).toBe(
      '{#nothing.here} and #site.name',
    )
    expect(resolveDictionaryWords('{# spaced }', word)).toBe('{# spaced }')
  })

  test('escapes the words it puts into markup', () => {
    expect(resolveDictionaryWordsInMarkup('<p>{#x}</p>', () => 'Fish & <chips>')).toBe(
      '<p>Fish &amp; &lt;chips&gt;</p>',
    )
  })

  test('is a chip only as the whole value', () => {
    expect(onlyDictionaryWord('{#site.name}')).toBe('site.name')
    expect(onlyDictionaryWord('Hi {#site.name}')).toBeUndefined()
    expect(dictionaryWordNames('{#a} {#b} {#a}')).toEqual(['a', 'b'])
  })

  test('the old #key is a whole text with no spaces', () => {
    expect(bareDictionaryWord('#contact.name')).toBe('contact.name')
    expect(bareDictionaryWord('#1 choice')).toBeUndefined()
  })
})

describe('a page’s values', () => {
  const context = { content: () => undefined, urlOf: () => '', word } as ValueContext

  test('text boxes and text areas read {#key} as words', () => {
    expect(convertValue('Umbraco.TextBox', 'About {#site.name}', context)).toBe(
      'About Harbourstone',
    )
    expect(convertValue('Umbraco.TextArea', '{#greeting}', context)).toBe('Kia ora')
  })

  test('rich text does too, with its words escaped', () => {
    const value = convertValue('Umbraco.RichText', '<p>{#greeting} &amp; {#site.name}</p>', context)
    expect(String(value)).toContain('<p>Kia ora &amp; Harbourstone</p>')
  })

  test('other editors keep their values, and without a dictionary text is as written', () => {
    expect(convertValue('Umbraco.Tags', ['{#greeting}'], context)).toEqual(['{#greeting}'])
    expect(convertValue('Umbraco.TextBox', '{#greeting}', { ...context, word: undefined })).toBe(
      '{#greeting}',
    )
  })
})

describe('upgrading forms written #key', () => {
  test('rewrites a word that is wholly "#key" naming an item, and nothing else', () => {
    const toml = [
      'submit-label = "#send"',
      "  caption = '#contact.name'  # the field's label",
      'help-text = "#1 choice"',
      'placeholder = "#unknown"',
      '# submit-label = "#send"',
      'values = ["#kept"]',
      'default = "#kept"',
    ].join('\n')
    const items = new Set(['send', 'contact.name', 'kept'])
    expect(braceFormWords(toml, (name) => items.has(name)).split('\n')).toEqual([
      'submit-label = "{#send}"',
      "  caption = '{#contact.name}'  # the field's label",
      'help-text = "#1 choice"',
      'placeholder = "#unknown"',
      '# submit-label = "#send"',
      'values = ["#kept"]',
      'default = "#kept"',
    ])
  })
})

describe('an item’s words, language by language', () => {
  test('lists every language, the default first, with its words or none', () => {
    expect(
      wordsByLanguage(
        [
          { isoCode: 'mi', cultureName: 'Māori', isDefault: false },
          { isoCode: 'en-NZ', cultureName: 'English (New Zealand)', isDefault: true },
        ],
        [{ isoCode: 'EN-nz', translation: 'Hello' }],
      ),
    ).toEqual([
      { isoCode: 'en-NZ', name: 'English (New Zealand)', isDefault: true, text: 'Hello' },
      { isoCode: 'mi', name: 'Māori', isDefault: false, text: '' },
    ])
  })
})

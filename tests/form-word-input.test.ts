/**
 * Stories 294 and 297: what a text box that can name a dictionary item suggests,
 * when it shows a chip, and what it says under itself.
 */
import { describe, expect, test } from 'bun:test'
import {
  chipWord,
  insertWord,
  suggestions,
  typedWord,
  wordLine,
  wordValue,
} from '../packages/backoffice-host/plugin/form-word-input-model.js'

const WORDS = [
  { name: 'contact.email', text: 'Email' },
  { name: 'contact.name', text: 'Name' },
  { name: 'nav.contact', text: 'Get in touch' },
  { name: 'footer.source', text: 'Source code' },
]
const names = (value: string) => suggestions(WORDS, value).rows.map((word) => word.name)

describe('the suggestions', () => {
  test('wait for {# anywhere, or a # at the start', () => {
    expect(names('contact')).toEqual([])
    expect(names('')).toEqual([])
    expect(names('Hello #con')).toEqual([])
  })

  test('follow the cursor, in the middle of other words', () => {
    expect(names('Hello {#con')).toEqual(['contact.email', 'contact.name', 'nav.contact'])
    const value = 'Dear {#touch, welcome'
    expect(suggestions(WORDS, value, 'Dear {#touch'.length).rows.map((w) => w.name)).toEqual([
      'nav.contact',
    ])
    expect(suggestions(WORDS, value, value.length).rows).toEqual([])
  })

  test('list everything after {# or # alone', () => {
    expect(names('{#')).toHaveLength(4)
    expect(names('#')).toHaveLength(4)
  })

  test('put names starting with the words first, then names, then their text', () => {
    expect(names('{#con')).toEqual(['contact.email', 'contact.name', 'nav.contact'])
    expect(names('#contact.n')).toEqual(['contact.name'])
    expect(names('{#touch')).toEqual(['nav.contact'])
  })

  test('stop when a # starts a few words, or the braces close', () => {
    expect(names('#1 choice')).toEqual([])
    expect(names('{#contact.name}')).toEqual([])
  })

  test('show eight, and say there are more', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `item.${i}`, text: '' }))
    const found = suggestions(many, '{#item')
    expect(found.rows).toHaveLength(8)
    expect(found.more).toBe(true)
  })

  test('write the chosen item as {#key}', () => {
    expect(wordValue('contact.name')).toBe('{#contact.name}')
  })
})

describe('the chip', () => {
  test('is a value that is wholly one {#key} naming an item, whatever its case', () => {
    expect(chipWord(WORDS, '{#Contact.Name}')?.name).toBe('contact.name')
    expect(chipWord(WORDS, ' {#contact.name} ')?.name).toBe('contact.name')
  })

  test('is a #key as forms wrote it before, when it names an item', () => {
    expect(chipWord(WORDS, '#contact.email')?.name).toBe('contact.email')
  })

  test('is nothing for text around a key, a name nothing has, or before the list loads', () => {
    expect(chipWord(WORDS, 'Dear {#contact.name}')).toBeUndefined()
    expect(chipWord(WORDS, '{#contact.nmae}')).toBeUndefined()
    expect(chipWord(WORDS, 'Name')).toBeUndefined()
    expect(chipWord(undefined, '{#contact.name}')).toBeUndefined()
  })
})

describe('the line under a box', () => {
  test('says when a {#key} names nothing', () => {
    expect(wordLine(WORDS, '{#contact.nmae}')).toContain('No dictionary item')
  })

  test('is nothing for a chip, ordinary text, or before the list loads', () => {
    expect(wordLine(WORDS, '{#contact.name}')).toBeUndefined()
    expect(wordLine(WORDS, 'Name')).toBeUndefined()
    expect(wordLine(WORDS, '#1 choice')).toBeUndefined()
    expect(wordLine(undefined, '{#contact.nmae}')).toBeUndefined()
  })
})

describe('choosing one', () => {
  test('puts {#key} where the cursor is, and keeps the rest of the text', () => {
    expect(insertWord('Dear {#con', 10, 'contact.name')).toEqual({
      value: 'Dear {#contact.name}',
      caret: 20,
    })
    expect(insertWord('Dear {#co, welcome', 9, 'contact.name').value).toBe(
      'Dear {#contact.name}, welcome',
    )
    expect(insertWord('#con', 4, 'contact.name').value).toBe('{#contact.name}')
  })

  test('replaces a name already closed, rather than leaving its brace behind', () => {
    expect(insertWord('{#con}', 5, 'contact.name').value).toBe('{#contact.name}')
  })

  test('knows what is being typed, and that nothing is outside a mark', () => {
    expect(typedWord('Hi {#na', 7)).toEqual({ typed: 'na', start: 3, end: 7 })
    expect(typedWord('Hi there', 8)).toBeUndefined()
  })
})

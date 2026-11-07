/**
 * Story 294: what the form editor suggests after a `#`, and what it says under a box.
 */
import { describe, expect, test } from 'bun:test'
import { suggestions, wordLine } from '../packages/backoffice-host/plugin/form-word-input-model.js'

const WORDS = [
  { name: 'contact.email', text: 'Email' },
  { name: 'contact.name', text: 'Name' },
  { name: 'nav.contact', text: 'Get in touch' },
  { name: 'footer.source', text: 'Source code' },
]
const names = (value: string) => suggestions(WORDS, value).rows.map((word) => word.name)

describe('the suggestions', () => {
  test('wait for a #', () => {
    expect(names('contact')).toEqual([])
    expect(names('')).toEqual([])
  })

  test('list everything after a # alone', () => {
    expect(names('#')).toHaveLength(4)
  })

  test('put names starting with the words first, then names, then their text', () => {
    expect(names('#con')).toEqual(['contact.email', 'contact.name', 'nav.contact'])
    expect(names('#contact.n')).toEqual(['contact.name'])
    expect(names('#touch')).toEqual(['nav.contact'])
  })

  test('stop when a # starts a few words', () => {
    expect(names('#1 choice')).toEqual([])
  })

  test('show eight, and say there are more', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `item.${i}`, text: '' }))
    const found = suggestions(many, '#item')
    expect(found.rows).toHaveLength(8)
    expect(found.more).toBe(true)
  })
})

describe('the line under a box', () => {
  test('says what a name reads as, whatever its case', () => {
    expect(wordLine(WORDS, '#Contact.Name')).toBe('From the dictionary: Name')
  })

  test('says when nothing has that name', () => {
    expect(wordLine(WORDS, '#contact.nmae')).toContain('No dictionary item')
  })

  test('falls back to the name of an item with no words', () => {
    expect(wordLine([{ name: 'empty', text: '' }], '#empty')).toBe('From the dictionary: empty')
  })

  test('is nothing for ordinary text, for words after a #, or before the list loads', () => {
    expect(wordLine(WORDS, 'Name')).toBeUndefined()
    expect(wordLine(WORDS, '#1 choice')).toBeUndefined()
    expect(wordLine(undefined, '#contact.name')).toBeUndefined()
  })
})

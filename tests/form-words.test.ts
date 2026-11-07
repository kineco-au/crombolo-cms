/**
 * Story 293: one form in every language. A word starting with `#` names a
 * dictionary item, and everything else stays exactly as written.
 */
import { describe, expect, test } from 'bun:test'
import { formWordNames, type SchemaForm, withFormWords } from '@crombolo/core'

const form = (
  overrides: Partial<SchemaForm['pages'][number]['groups'][number]['fields'][number]>,
) =>
  ({
    alias: 'contact',
    name: 'Contact',
    submitLabel: '#send',
    messageOnSubmit: 'Thanks',
    workflows: [],
    pages: [
      {
        caption: '#page',
        groups: [
          {
            caption: '#group',
            columns: 1,
            fields: [
              {
                alias: 'name',
                type: 'shortAnswer',
                caption: '#name',
                helpText: '#help',
                placeholder: '#hint',
                mandatoryMessage: '#needed',
                patternMessage: '#pattern',
                mandatory: true,
                sensitive: false,
                values: ['#kept'],
                accept: [],
                ...overrides,
              },
            ],
          },
        ],
      },
    ],
  }) as unknown as SchemaForm

const upper = (text: string) => (text.startsWith('#') ? text.slice(1).toUpperCase() : text)

describe('a form’s words', () => {
  test('are every piece of text a visitor reads', () => {
    const out = withFormWords(form({}), upper)
    const page = out.pages[0]
    const group = page?.groups[0]
    const field = group?.fields[0]
    expect([out.submitLabel, page?.caption, group?.caption]).toEqual(['SEND', 'PAGE', 'GROUP'])
    expect([
      field?.caption,
      field?.helpText,
      field?.placeholder,
      field?.mandatoryMessage,
      field?.patternMessage,
    ]).toEqual(['NAME', 'HELP', 'HINT', 'NEEDED', 'PATTERN'])
  })

  test('leave alone what is stored: a choice is compared, not read', () => {
    expect(withFormWords(form({}), upper).pages[0]?.groups[0]?.fields[0]?.values).toEqual(['#kept'])
  })

  test('add nothing a form did not have', () => {
    const without = form({})
    delete without.pages[0]?.groups[0]?.fields[0]?.helpText
    const out = withFormWords(without, upper)
    expect('helpText' in (out.pages[0]?.groups[0]?.fields[0] ?? {})).toBe(false)
  })

  test('give back the same form when nothing changes', () => {
    const plain = form({})
    expect(withFormWords(plain, (text) => text)).toBe(plain)
  })

  test('name dictionary items, though words after a # are only text', () => {
    expect(formWordNames(form({ helpText: '#1 choice' }))).toEqual([
      'send',
      'page',
      'group',
      'name',
      'hint',
      'needed',
      'pattern',
    ])
  })
})

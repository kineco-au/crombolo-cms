/**
 * Story 342: the words of Settings → Schema and of a waiting import.
 */
import { describe, expect, test } from 'bun:test'
import {
  describeFile,
  describeImport,
} from '../packages/backoffice-host/plugin/schema-transfer-words.js'

describe('what a schema import brings, in words', () => {
  test('counts new and changed files', () => {
    expect(describeImport({ added: ['a'], changed: [] })).toBe('1 new file')
    expect(describeImport({ added: ['a', 'b'], changed: ['c'] })).toBe(
      '2 new files and 1 changed file',
    )
    expect(describeImport({})).toBe('no files')
  })

  test('names each file as what it is, not where it is kept', () => {
    expect(describeFile('content-types/article.toml')).toEqual({
      kind: 'Document type',
      name: 'article',
    })
    expect(describeFile('forms/contact/enquiry.toml')).toEqual({
      kind: 'Form',
      name: 'contact/enquiry',
    })
    expect(describeFile('languages.toml')).toEqual({ kind: 'Languages', name: 'languages.toml' })
    expect(describeFile('user-groups/editors.toml').kind).toBe('User group')
  })
})

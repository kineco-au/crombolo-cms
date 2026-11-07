/**
 * Story 289: the menu under Content offers what a user may open, and knows which
 * of its items a page belongs to, wherever that page really lives.
 */
import { describe, expect, test } from 'bun:test'
import { activeItem, stripItems } from '../packages/backoffice-host/plugin/content-strip-items.js'

const CONTENT = 'Umb.Section.Content'
const SETTINGS = 'Umb.Section.Settings'
const FORMS = 'Crombolo.Section.Forms'
const labels = (user: Parameters<typeof stripItems>[0]) => stripItems(user).map((i) => i.label)

describe('what the menu offers', () => {
  test('everything, to an administrator', () => {
    expect(labels({ allowedSections: [CONTENT, SETTINGS, FORMS], isAdmin: true })).toEqual([
      'Pages',
      'Structure',
      'Components',
      'Forms',
      'Workflows',
    ])
  })

  test('only what someone may open', () => {
    expect(labels({ allowedSections: [CONTENT, FORMS], isAdmin: false })).toEqual([
      'Pages',
      'Forms',
    ])
    expect(labels({ allowedSections: [CONTENT, SETTINGS], isAdmin: false })).toEqual([
      'Pages',
      'Structure',
      'Components',
    ])
  })

  test('nothing, to someone with one thing to open', () => {
    expect(labels({ allowedSections: [CONTENT], isAdmin: false })).toEqual([])
    expect(labels({ allowedSections: [], isAdmin: false })).toEqual([])
    expect(labels(undefined)).toEqual([])
  })
})

describe('where a page belongs', () => {
  test.each([
    ['section/content', 'Pages'],
    ['section/content/workspace/document/edit/1', 'Pages'],
    ['section/settings/structure', 'Structure'],
    ['section/settings/workspace/document-type/edit/1', 'Structure'],
    ['section/settings/code', 'Components'],
    ['section/settings/workspace/stylesheet/edit/1', 'Components'],
    ['section/forms', 'Forms'],
    ['section/forms/view/forms', 'Forms'],
    ['section/forms/view/workflows', 'Workflows'],
  ])('%s is %s', (path, item) => {
    expect(activeItem(path)).toBe(item)
  })

  test.each(['home', 'section/settings', 'section/settings/dashboard/logs', 'section/media'])(
    '%s is none of them',
    (path) => {
      expect(activeItem(path)).toBeUndefined()
    },
  )
})

/**
 * Story 289: the menu under Content offers what a user may open, and knows which
 * of its items a page belongs to, wherever that page really lives.
 */
import { describe, expect, test } from 'bun:test'
import { activeItem, stripItems } from '../packages/backoffice-host/plugin/content-strip-items.js'

const CONTENT = 'Umb.Section.Content'
const STRUCTURE = 'Crombolo.Section.Structure'
const COMPONENTS = 'Crombolo.Section.Components'
const WORKFLOW_SETUP = 'Crombolo.Section.WorkflowSetup'
const SETTINGS = [STRUCTURE, COMPONENTS]
const FORMS = 'Crombolo.Section.Forms'
const labels = (user: Parameters<typeof stripItems>[0]) => stripItems(user).map((i) => i.label)

describe('what the menu offers', () => {
  test('everything, to an administrator', () => {
    expect(
      labels({ allowedSections: [CONTENT, ...SETTINGS, FORMS, WORKFLOW_SETUP], isAdmin: true }),
    ).toEqual(['Pages', 'Structure', 'Components', 'Workflows'])
  })

  test('only what someone may open', () => {
    expect(
      labels({
        allowedSections: [CONTENT, FORMS],
        fallbackPermissions: ['Crombolo.Form.Read'],
        isAdmin: false,
      }),
    ).toEqual(['Pages', 'Structure'])
    // With Forms alone, Structure is the forms, where they always were.
    expect(
      stripItems({
        allowedSections: [CONTENT, FORMS],
        fallbackPermissions: ['Crombolo.Form.Read'],
        isAdmin: false,
      }).find((item) => item.label === 'Structure')?.path,
    ).toBe('section/forms')
    expect(labels({ allowedSections: [CONTENT, ...SETTINGS], isAdmin: false })).toEqual([
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
    ['section/forms', 'Structure'],
    ['section/forms/view/forms', 'Structure'],
    ['section/settings/forms', 'Structure'],
    ['section/settings/forms/entries', 'Structure'],
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

describe('what a group is given', () => {
  test('Structure alone, without Components', () => {
    expect(labels({ allowedSections: [CONTENT, STRUCTURE], isAdmin: false })).toEqual([
      'Pages',
      'Structure',
    ])
  })

  test('Workflows alone, with no Forms to find under Structure', () => {
    expect(labels({ allowedSections: [CONTENT, FORMS, WORKFLOW_SETUP], isAdmin: false })).toEqual([
      'Pages',
      'Workflows',
    ])
  })

  test('nothing for Pages alone, so no row', () => {
    expect(labels({ allowedSections: [CONTENT], isAdmin: false })).toEqual([])
  })
})

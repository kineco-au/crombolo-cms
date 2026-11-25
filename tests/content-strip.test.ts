/**
 * Stories 289, 385 and 419: the menu under Content offers each place a user holds,
 * each a grant of its own at an address under Content, what a workspace holds, and
 * knows which place a page belongs to. In a workspace it takes the workspace's colour.
 */
import { describe, expect, test } from 'bun:test'
import { activeItem, stripItems } from '../packages/backoffice-host/plugin/content-strip-items.js'

const CONTENT = 'Umb.Section.Content'
const PAGES = 'Crombolo.Section.Pages'
const MEDIA = 'Umb.Section.Media'
const SETTINGS = 'Umb.Section.Settings'
const APPROVALS = 'Crombolo.Section.Workflow'
const STRUCTURE = 'Crombolo.Section.Structure'
const CODE = 'Crombolo.Section.Components'
const FORMS = 'Crombolo.Section.Forms'
const LIBRARY = 'Umb.Section.Library'
const TRANSLATION = 'Umb.Section.Translation'
const EVERY = [CONTENT, PAGES, MEDIA, LIBRARY, TRANSLATION, APPROVALS, STRUCTURE, CODE, FORMS]
const labels = (user: Parameters<typeof stripItems>[0]) => stripItems(user).map((i) => i.label)

describe('what the menu offers', () => {
  test('every place a workspace holds, to an administrator, editing first; no Approvals', () => {
    const items = stripItems({ allowedSections: [...EVERY, SETTINGS], isAdmin: true })
    expect(items.map((i) => [i.label, i.path])).toEqual([
      ['Pages', 'section/content'],
      ['Media', 'section/content/media'],
      ['Library', 'section/content/library'],
      ['Translation', 'section/content/translation'],
      ['Structure', 'section/content/structure'],
      ['Code', 'section/content/code'],
    ])
  })

  test('only the places someone holds; Settings opens none of them', () => {
    expect(labels({ allowedSections: [CONTENT, PAGES, MEDIA], isAdmin: false })).toEqual([
      'Pages',
      'Media',
    ])
    expect(labels({ allowedSections: [CONTENT, MEDIA, CODE], isAdmin: false })).toEqual([
      'Media',
      'Code',
    ])
    expect(labels({ allowedSections: [CONTENT, PAGES, SETTINGS], isAdmin: false })).toEqual([])
  })

  test('Structure opens on Forms alone for someone with Forms and not Structure', () => {
    const user = {
      allowedSections: [CONTENT, PAGES, FORMS],
      fallbackPermissions: ['Crombolo.Form.Read'],
      isAdmin: false,
    }
    expect(labels(user)).toEqual(['Pages', 'Structure'])
    expect(stripItems(user).find((item) => item.label === 'Structure')?.path).toBe(
      'section/content/forms',
    )
  })

  test('nothing, to someone with one place to open', () => {
    expect(labels({ allowedSections: [CONTENT, PAGES], isAdmin: false })).toEqual([])
    expect(labels({ allowedSections: [], isAdmin: false })).toEqual([])
    expect(labels(undefined)).toEqual([])
  })

  test('with workspaces on, that one place is offered, as the way back from Workspaces', () => {
    const one = { allowedSections: [CONTENT, PAGES], isAdmin: false }
    expect(stripItems(one, true).map((item) => item.label)).toEqual(['Pages'])
    expect(stripItems({ allowedSections: [], isAdmin: false }, true)).toEqual([])
  })
})

describe('where a page belongs', () => {
  test.each([
    ['section/content', 'Pages'],
    ['section/content/workspace/document/edit/1', 'Pages'],
    ['section/content/media', 'Media'],
    ['section/content/media/workspace/media/edit/1', 'Media'],
    ['section/content/library', 'Library'],
    ['section/content/library/workspace/element/edit/1', 'Library'],
    ['section/content/translation', 'Translation'],
    ['section/content/translation/workspace/language/edit/en', 'Translation'],
    ['section/content/structure', 'Structure'],
    ['section/content/structure/workspace/document-type/edit/1', 'Structure'],
    ['section/content/structure/forms/entries', 'Structure'],
    ['section/content/structure/workflows', 'Structure'],
    ['section/content/forms/view/forms', 'Structure'],
    ['section/content/code', 'Code'],
    ['section/content/code/workspace/stylesheet/edit/1', 'Code'],
    ['section/content/workspaces', 'Workspaces'],
    ['section/content/dashboard/home', 'Pages'],
  ])('%s is %s', (path, item) => {
    expect(activeItem(path)).toBe(item)
  })

  test.each(['home', 'section/settings', 'section/settings/dashboard/logs', 'section/approvals'])(
    '%s is none of them',
    (path) => {
      expect(activeItem(path)).toBeUndefined()
    },
  )
})

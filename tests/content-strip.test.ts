/**
 * Stories 289 and 385: the menu under Content offers each place a user holds,
 * each a grant of its own at an address under Content, and knows which place a
 * page belongs to.
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
const EVERY = [CONTENT, PAGES, MEDIA, APPROVALS, STRUCTURE, CODE, FORMS]
const labels = (user: Parameters<typeof stripItems>[0]) => stripItems(user).map((i) => i.label)

describe('what the menu offers', () => {
  test('every place, to an administrator, at its address under Content', () => {
    const items = stripItems({ allowedSections: [...EVERY, SETTINGS], isAdmin: true })
    expect(items.map((i) => [i.label, i.path])).toEqual([
      ['Pages', 'section/content'],
      ['Media', 'section/content/media'],
      ['Approvals', 'section/content/approvals'],
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

  test('no Approvals while the site has no workflow and no request open', () => {
    const admin = { allowedSections: EVERY, isAdmin: true }
    expect(stripItems(admin, { approvals: false }).map((i) => i.label)).not.toContain('Approvals')
    expect(stripItems(admin, { approvals: true }).map((i) => i.label)).toContain('Approvals')
  })

  test('nothing, to someone with one place to open', () => {
    expect(labels({ allowedSections: [CONTENT, PAGES], isAdmin: false })).toEqual([])
    expect(labels({ allowedSections: [], isAdmin: false })).toEqual([])
    expect(labels(undefined)).toEqual([])
  })
})

describe('where a page belongs', () => {
  test.each([
    ['section/content', 'Pages'],
    ['section/content/workspace/document/edit/1', 'Pages'],
    ['section/content/media', 'Media'],
    ['section/content/media/workspace/media/edit/1', 'Media'],
    ['section/content/approvals', 'Approvals'],
    ['section/content/approvals/view/in-flight', 'Approvals'],
    ['section/content/structure', 'Structure'],
    ['section/content/structure/workspace/document-type/edit/1', 'Structure'],
    ['section/content/structure/forms/entries', 'Structure'],
    ['section/content/structure/workflows', 'Structure'],
    ['section/content/forms/view/forms', 'Structure'],
    ['section/content/code', 'Code'],
    ['section/content/code/workspace/stylesheet/edit/1', 'Code'],
  ])('%s is %s', (path, item) => {
    expect(activeItem(path)).toBe(item)
  })

  test.each(['home', 'section/settings', 'section/settings/dashboard/logs', 'section/library'])(
    '%s is none of them',
    (path) => {
      expect(activeItem(path)).toBeUndefined()
    },
  )
})

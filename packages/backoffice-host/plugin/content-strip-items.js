/**
 * What the menu under Content offers (story 289), and which item a page belongs
 * to. Pure, so each is tested on its own. Structure and Components stay in
 * Settings and forms in their section: the client links to them there, and the
 * menu is what puts them together.
 */
import { treeFor } from './settings-cards.js'

const SETTINGS = 'Umb.Section.Settings'
const FORMS = 'Crombolo.Section.Forms'
const CONTENT = 'Umb.Section.Content'

const ITEMS = [
  { label: 'Pages', path: 'section/content', section: CONTENT },
  { label: 'Structure', path: 'section/settings/structure', section: SETTINGS },
  { label: 'Components', path: 'section/settings/code', section: SETTINGS },
  { label: 'Forms', path: 'section/forms', section: FORMS },
  { label: 'Workflows', path: 'section/forms/view/workflows', section: FORMS, admin: true },
]

/**
 * The items this user may open. One alone is no menu, so it offers none.
 *
 * @param {{ allowedSections?: string[], isAdmin?: boolean } | undefined} user
 */
export function stripItems(user) {
  const allowed = user?.allowedSections ?? []
  const items = ITEMS.filter(
    (item) => allowed.includes(item.section) && (!item.admin || user?.isAdmin === true),
  )
  return items.length > 1 ? items : []
}

/**
 * The item a path below the back office belongs to, or undefined.
 *
 * @param {string} path e.g. `section/settings/workspace/document-type/edit/1`
 */
export function activeItem(path) {
  const section = /^section\/([^/]+)(?:\/(.*))?$/.exec(path)
  if (!section) return undefined
  const [, name, rest = ''] = section
  if (name === 'content') return 'Pages'
  if (name === 'forms') return rest.startsWith('view/workflows') ? 'Workflows' : 'Forms'
  if (name !== 'settings') return undefined
  if (rest.startsWith('structure')) return 'Structure'
  if (rest.startsWith('code')) return 'Components'
  const tree = treeFor(/^workspace\/([^/]+)/.exec(rest)?.[1])
  return tree === 'structure' ? 'Structure' : tree === 'code' ? 'Components' : undefined
}

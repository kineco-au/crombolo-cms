/**
 * What the menu under Content offers (story 289), and which item a page belongs
 * to. Pure, so each is tested on its own. Structure and Code stay in
 * Settings: the client links to them there, and the menu is what puts them
 * together. Forms and Workflows are nodes in Structure; Approvals is its own section,
 * with no tab in the header.
 */
import { treeFor } from './settings-cards.js'

const SETTINGS = 'Umb.Section.Settings'
const APPROVALS = 'Crombolo.Section.Workflow'
/** Reading forms, which is what a group's Forms comes to. */
const FORM_READ = 'Crombolo.Form.Read'
const FORMS = 'Crombolo.Section.Forms'
const CONTENT = 'Umb.Section.Content'

/** Forms is a node in Structure; someone with Forms and not Settings gets it in the Forms section. */
const STRUCTURE_ELSE = [{ path: 'section/forms', section: FORMS, verb: FORM_READ }]

const ITEMS = [
  { label: 'Pages', path: 'section/content', section: CONTENT },
  { label: 'Approvals', path: 'section/workflow', section: APPROVALS },
  {
    label: 'Structure',
    path: 'section/settings/structure',
    section: SETTINGS,
    or: STRUCTURE_ELSE,
  },
  { label: 'Code', path: 'section/settings/code', section: SETTINGS },
]

/**
 * The items this user may open. One alone is no menu, so it offers none.
 *
 * @param {{ allowedSections?: string[], fallbackPermissions?: string[], isAdmin?: boolean } | undefined} user
 */
export function stripItems(user) {
  const allowed = user?.allowedSections ?? []
  const may = (verb) => user?.isAdmin === true || (user?.fallbackPermissions ?? []).includes(verb)
  const items = ITEMS.flatMap((item) => {
    if (allowed.includes(item.section)) return [item]
    const other = (item.or ?? []).find(
      (or) => allowed.includes(or.section) && (!or.verb || may(or.verb)),
    )
    return other ? [{ ...item, ...other }] : []
  })
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
  if (name === 'forms') return 'Structure'
  if (name === 'workflow') return 'Approvals'
  if (name !== 'settings') return undefined
  if (['structure', 'forms', 'workflows'].some((tree) => rest.startsWith(tree))) return 'Structure'
  if (rest.startsWith('code')) return 'Code'
  const tree = treeFor(/^workspace\/([^/]+)/.exec(rest)?.[1])
  return tree === 'structure' ? 'Structure' : tree === 'code' ? 'Code' : undefined
}

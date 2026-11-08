/**
 * What the menu under Content offers (story 289), and which item a page belongs
 * to. Pure, so each is tested on its own. Structure and Code stay in
 * Settings: the client links to them there, and the menu is what puts them
 * together. Forms is a node in Structure, and Workflows stays in the Forms section.
 */
import { treeFor } from './settings-cards.js'

const STRUCTURE = 'Crombolo.Section.Structure'
const COMPONENTS = 'Crombolo.Section.Components'
const WORKFLOW_SETUP = 'Crombolo.Section.WorkflowSetup'
/** Reading forms, which is what a group's Forms comes to. */
const FORM_READ = 'Crombolo.Form.Read'
const FORMS = 'Crombolo.Section.Forms'
const CONTENT = 'Umb.Section.Content'

/** Forms is a node in Structure; someone with Forms alone gets it where it always was. */
const STRUCTURE_FORMS = { path: 'section/forms', section: FORMS, verb: FORM_READ }

const ITEMS = [
  { label: 'Pages', path: 'section/content', section: CONTENT },
  {
    label: 'Structure',
    path: 'section/settings/structure',
    section: STRUCTURE,
    or: STRUCTURE_FORMS,
  },
  { label: 'Code', path: 'section/settings/code', section: COMPONENTS },
  { label: 'Workflows', path: 'section/forms/view/workflows', section: WORKFLOW_SETUP },
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
    return item.or && allowed.includes(item.or.section) && may(item.or.verb)
      ? [{ ...item, ...item.or }]
      : []
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
  if (name === 'forms') return rest.startsWith('view/workflows') ? 'Workflows' : 'Structure'
  if (name !== 'settings') return undefined
  if (rest.startsWith('structure') || rest.startsWith('forms')) return 'Structure'
  if (rest.startsWith('code')) return 'Code'
  const tree = treeFor(/^workspace\/([^/]+)/.exec(rest)?.[1])
  return tree === 'structure' ? 'Structure' : tree === 'code' ? 'Code' : undefined
}

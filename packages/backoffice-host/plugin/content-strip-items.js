/**
 * What the menu under Content offers (story 289), and which item a page belongs
 * to. Pure, so each is tested on its own. Each place is a grant of its own and
 * lives at an address under Content (story 385): Pages, Media, Approvals,
 * Structure and Code. Forms and Workflows are nodes in Structure; someone with
 * Forms and not Structure has Structure open on Forms alone.
 */

const PAGES = 'Crombolo.Section.Pages'
const MEDIA = 'Umb.Section.Media'
const APPROVALS = 'Crombolo.Section.Workflow'
const STRUCTURE = 'Crombolo.Section.Structure'
const CODE = 'Crombolo.Section.Components'
/** Reading forms, which is what a group's Forms comes to. */
const FORM_READ = 'Crombolo.Form.Read'
const FORMS = 'Crombolo.Section.Forms'

/** Forms is a node in Structure; someone with Forms and not Structure gets it on its own. */
const STRUCTURE_ELSE = [{ path: 'section/content/forms', section: FORMS, verb: FORM_READ }]

const ITEMS = [
  { label: 'Pages', path: 'section/content', section: PAGES },
  { label: 'Media', path: 'section/content/media', section: MEDIA },
  { label: 'Approvals', path: 'section/content/approvals', section: APPROVALS },
  { label: 'Structure', path: 'section/content/structure', section: STRUCTURE, or: STRUCTURE_ELSE },
  { label: 'Code', path: 'section/content/code', section: CODE },
]

/** Each place's address under Content, by the item it is. */
const PLACES = {
  media: 'Media',
  approvals: 'Approvals',
  structure: 'Structure',
  forms: 'Structure',
  code: 'Code',
}

/**
 * The items this user may open. One alone is no menu, so it offers none.
 * Approvals is offered only while the site has a workflow or a request is open,
 * as its section is (story 234).
 *
 * @param {{ allowedSections?: string[], fallbackPermissions?: string[], isAdmin?: boolean } | undefined} user
 * @param {{ approvals?: boolean }} [site]
 */
export function stripItems(user, site = {}) {
  const allowed = user?.allowedSections ?? []
  const may = (verb) => user?.isAdmin === true || (user?.fallbackPermissions ?? []).includes(verb)
  const items = ITEMS.flatMap((item) => {
    if (item.section === APPROVALS && site.approvals === false) return []
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
 * @param {string} path e.g. `section/content/structure/workspace/document-type/edit/1`
 */
export function activeItem(path) {
  const section = /^section\/content(?:\/([^/]+))?/.exec(path)
  if (!section) return undefined
  return PLACES[section[1] ?? ''] ?? 'Pages'
}

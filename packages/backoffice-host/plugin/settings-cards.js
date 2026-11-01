/**
 * The Settings landing page's cards and which tree an editor sits beside
 * (story 234). Pure, so the unit tests read it outside a browser.
 */

export const STRUCTURE_MENU = 'Umb.Menu.StructureSettings'
export const CODE_MENU = 'Umb.Menu.Templating'
export const ADVANCED_MENU = 'Umb.Menu.AdvancedSettings'

/** The sidebar app that draws each tree. */
export const SIDEBAR_APPS = {
  structure: 'Umb.SectionSidebarMenu.Settings',
  code: 'Umb.SectionSidebarMenu.Templating',
}

export const GROUPS = ['Build', 'Site', 'Health', 'History', 'Other']

/** Our words for each tool, by the alias of its dashboard or menu item. */
export const CARDS = {
  structure: {
    group: 'Build',
    title: 'Structure',
    description: 'Content, media and member types, data types and languages.',
  },
  code: {
    group: 'Build',
    title: 'Code',
    description: 'Components, stylesheets and scripts.',
  },
  'Umb.Dashboard.ModelsBuilder': {
    group: 'Build',
    title: 'Types for code',
    description: 'The TypeScript types written from the schema, and whether they are out of date.',
  },
  'Crombolo.Dashboard.Workflows': {
    group: 'Build',
    title: 'Workflows',
    description:
      'The approval steps a page goes through before it is published, and who decides each.',
  },
  'Crombolo.Dashboard.Seo': {
    group: 'Site',
    title: 'Search & sharing',
    description:
      'What every page falls back to in search results and when shared, the robots file and the missing-page page.',
  },
  'Crombolo.Dashboard.Addresses': {
    group: 'Site',
    title: 'Page addresses',
    description: "Whether the top-level page's name is part of every address below it.",
  },
  'Umb.Dashboard.RedirectManagement': {
    group: 'Site',
    title: 'Redirects',
    description: "Old addresses that send visitors on to a page's new one.",
  },
  'Umb.MenuItem.Webhook': {
    group: 'Site',
    title: 'Webhooks',
    description: 'Tell other systems when content changes.',
  },
  'Umb.MenuItem.LogViewer': {
    group: 'Site',
    title: 'Logs',
    description: 'Search and read what the server has logged.',
  },
  'Umb.Dashboard.ExamineManagement': {
    group: 'Site',
    title: 'Search indexes',
    description: "The back office's search indexes: their health, and rebuilding them.",
  },
  'Crombolo.Dashboard.BackgroundJobs': {
    group: 'Site',
    title: 'Background jobs',
    description: 'Scheduled and queued work, how far each got, and running a failed one again.',
  },
  'Umb.MenuItem.Extensions': {
    group: 'Site',
    title: 'Extensions',
    description: 'What the back office has loaded, and from which package.',
  },
  'Umb.Dashboard.HealthCheck': {
    group: 'Health',
    title: 'Health check',
    description: "Checks on the site's setup and data, with a fix where there is one.",
  },
  'Umb.Dashboard.PublishedStatus': {
    group: 'Health',
    title: 'Published status',
    description: 'The published cache visitors are served from, and rebuilding it.',
  },
  'Umb.MenuItem.Relations': {
    group: 'Health',
    title: 'Relations',
    description: 'How items point at each other, such as a copy and its original.',
  },
  'Crombolo.Dashboard.Changes': {
    group: 'History',
    title: 'Changes',
    description: 'What an upgrade or an arriving bundle needs from you, and what is resolved.',
  },
  'Crombolo.Dashboard.AuditLog': {
    group: 'History',
    title: 'Audit log',
    description: 'Who did what, when and from where.',
  },
}

/**
 * The landing page's groups, in order, each with its cards in the order above.
 * `dashboards` are `{ alias, label, path }`; `advanced` are `{ alias, label,
 * entityType }`; `structure` and `code` say whether the user may open an item
 * of that tree. Paths are relative to the section.
 *
 * @param {{
 *   dashboards?: { alias: string, label?: string, path: string }[],
 *   advanced?: { alias: string, label?: string, entityType: string }[],
 *   structure?: boolean,
 *   code?: boolean,
 * }} from
 */
export function settingsCards({ dashboards = [], advanced = [], structure = false, code = false }) {
  const found = []
  if (structure) found.push({ alias: 'structure', path: 'structure' })
  if (code) found.push({ alias: 'code', path: 'code' })
  for (const d of dashboards) found.push({ alias: d.alias, label: d.label, path: d.path })
  for (const item of advanced)
    found.push({ alias: item.alias, label: item.label, path: `workspace/${item.entityType}` })

  const order = Object.keys(CARDS)
  const cards = found
    .map((card) => {
      const words = CARDS[card.alias]
      return words
        ? { alias: card.alias, path: card.path, ...words }
        : { alias: card.alias, path: card.path, group: 'Other', title: card.label ?? card.alias }
    })
    .sort((a, b) => rank(order, a.alias) - rank(order, b.alias))

  return GROUPS.map((group) => ({ group, cards: cards.filter((c) => c.group === group) })).filter(
    (g) => g.cards.length > 0,
  )
}

const rank = (order, alias) => {
  const at = order.indexOf(alias)
  return at === -1 ? order.length : at
}

const STRUCTURE_TYPES = ['document-type', 'media-type', 'member-type', 'data-type', 'language']
const CODE_TYPES = ['partial-view', 'template', 'stylesheet', 'script']

/** The tree an editor for `entityType` sits beside, or undefined for none. */
export function treeFor(entityType) {
  if (typeof entityType !== 'string') return undefined
  if (STRUCTURE_TYPES.some((type) => entityType.startsWith(type))) return 'structure'
  if (CODE_TYPES.some((type) => entityType.startsWith(type))) return 'code'
  return undefined
}

/**
 * The trail above a Settings page: Settings, then the tree or tool it is in.
 * Paths are relative to the section; the last crumb is the page itself.
 *
 * @param {{ tree?: 'structure' | 'code', title?: string }} at
 */
export function crumbsFor({ tree, title } = {}) {
  const settings = { label: 'Settings', path: '' }
  if (tree) return [settings, { label: CARDS[tree]?.title ?? tree }]
  if (title) return [settings, { label: title }]
  return []
}

/**
 * The card title of the Advanced tool an editor belongs to, by the entity type
 * the editor opened, e.g. `webhook` for a webhook under `webhook-root`.
 *
 * @param {{ alias: string, label?: string, entityType?: string }[]} advanced
 * @param {string | undefined} entityType
 */
export function advancedToolTitle(advanced, entityType) {
  if (typeof entityType !== 'string') return undefined
  const item = advanced.find(
    (m) =>
      typeof m.entityType === 'string' &&
      (entityType === m.entityType || entityType.startsWith(m.entityType.replace(/-root$/, ''))),
  )
  return item ? (CARDS[item.alias]?.title ?? item.label) : undefined
}

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

export const GROUPS = ['Site', 'Health', 'History', 'Developers', 'Extensions', 'Other']

/** Our words for each tool, by the alias of its dashboard or menu item. */
export const CARDS = {
  'Crombolo.Dashboard.Seo': {
    group: 'Site',
    title: 'Search',
    description:
      'What pages say in search results and when shared, the robots file, and the search indexes.',
  },
  'Crombolo.Dashboard.Addresses': {
    group: 'Site',
    title: 'Page addresses',
    description: "Whether the top-level page's name is part of every address below it.",
  },
  'Umb.Dashboard.RedirectManagement': {
    group: 'Site',
    title: 'Redirects',
    description: "Configure the site's redirect rules.",
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
  'Crombolo.Dashboard.BackgroundJobs': {
    group: 'Site',
    title: 'Background jobs',
    description: 'Scheduled and queued work, how far each got, and running a failed one again.',
  },
  'Umb.MenuItem.Relations': {
    group: 'Site',
    title: 'Relations',
    description: 'How items point at each other, such as a copy and its original.',
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
  // Story 238: a developer's view of what is loaded, apart from installing bundles.
  'Umb.MenuItem.Extensions': {
    group: 'Developers',
    title: 'Extension insights',
    description: 'What the back office has loaded, and from which extension.',
  },
  'Crombolo.Dashboard.CiAccess': {
    group: 'Developers',
    title: 'CI access',
    description: 'The CI jobs that may pull and push here without a person, and what each may do.',
  },
  'Crombolo.Dashboard.TrustedSigners': {
    group: 'Developers',
    title: 'Trusted signers',
    description:
      'The keys and builds whose site bundles this site applies: yours, other sites, and CI.',
  },
  'Umb.Dashboard.ModelsBuilder': {
    group: 'Developers',
    title: 'Types for code',
    description: 'The TypeScript types written from the schema, and whether they are out of date.',
  },
  'Crombolo.Dashboard.Bundles': {
    group: 'Extensions',
    title: 'Extensions',
    description: 'Find, install and build extensions: what they add, and turning them off.',
  },
}

/**
 * The landing page's groups, in order, each with its cards in the order above.
 * `dashboards` are `{ alias, label, description?, bundle?, path }`; `advanced`
 * are `{ alias, label, description?, bundle?, entityType }`. A card this file
 * has no words for takes its manifest's description, and a bundle's card goes
 * under the bundle's name, its group linking to the bundle. `structure` and `code` say whether the user may
 * open an item of that tree. Paths are relative to the section.
 *
 * @param {{
 *   dashboards?: { alias: string, label?: string, description?: string, bundle?: { name: string, packageName: string }, path: string }[],
 *   advanced?: { alias: string, label?: string, description?: string, bundle?: { name: string, packageName: string }, entityType: string }[],
 * }} from
 * @returns {{ group: string, bundle?: { name: string, packageName: string, path: string }, cards: any[] }[]}
 */
export function settingsCards({ dashboards = [], advanced = [] }) {
  const found = []
  for (const d of dashboards)
    found.push({
      alias: d.alias,
      label: d.label,
      description: d.description,
      bundle: d.bundle,
      path: d.path,
    })
  for (const item of advanced)
    found.push({
      alias: item.alias,
      label: item.label,
      description: item.description,
      bundle: item.bundle,
      path: `workspace/${item.entityType}`,
    })

  const order = Object.keys(CARDS)
  const cards = found
    .map((card) => {
      const words = CARDS[card.alias]
      return words
        ? { alias: card.alias, path: card.path, ...words }
        : {
            alias: card.alias,
            path: card.path,
            group: card.bundle?.name ?? 'Other',
            bundle: card.bundle,
            title: card.label ?? card.alias,
            description: card.description,
          }
    })
    .sort((a, b) => rank(order, a.alias) - rank(order, b.alias))

  const builtIn = GROUPS.map((group) => ({
    group,
    cards: cards.filter((c) => !c.bundle && c.group === group),
  }))
  // A bundle's cards are a group of their own, after ours, by the bundle's name.
  const bundles = [
    ...new Map(cards.flatMap((c) => (c.bundle ? [[c.bundle.packageName, c.bundle]] : []))).values(),
  ]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((bundle) => ({
      group: bundle.name,
      bundle: { ...bundle, path: bundlePath(bundle.packageName) },
      cards: cards.filter((c) => c.bundle?.packageName === bundle.packageName),
    }))
  return [...builtIn, ...bundles].filter((g) => g.cards.length > 0)
}

/** Where the Bundles section shows an installed bundle, relative to the back office. */
export const bundlePath = (packageName) =>
  `section/settings/dashboard/extensions/installed?extension=${encodeURIComponent(packageName)}`

const rank = (order, alias) => {
  const at = order.indexOf(alias)
  return at === -1 ? order.length : at
}

const STRUCTURE_TYPES = [
  'document-type',
  'document-blueprint',
  'media-type',
  'member-type',
  'data-type',
  'language',
]
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
 * Paths are relative to the section; the last crumb is the page itself, and `home`
 * marks the crumb for the root of the back office, which is outside the section.
 *
 * @param {{ tree?: 'structure' | 'code', title?: string }} at
 */
export function crumbsFor({ tree, title } = {}) {
  const home = { label: 'Home', home: true }
  const settings = { label: 'Settings', path: '' }
  // A tree is reached from the menu under Content, which says where it is (story 289).
  if (tree) return []
  if (title) return [home, settings, { label: title }]
  return [home, { label: 'Settings' }]
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

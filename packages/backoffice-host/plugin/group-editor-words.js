/**
 * What the user group editor says and how its choices become verbs (story 338).
 * Pure, so the unit tests read it outside a browser and hold its levels to the
 * server's (`@crombolo/core`, `permission-levels.ts`).
 */

export const TABS = [
  { id: 'access', label: 'Access' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'transfer', label: 'Data Transfer', adminOnly: true },
  { id: 'people', label: 'People' },
]

/** The areas of the back office, as Access lists them, by section alias. */
export const AREAS = [
  { section: 'Umb.Section.Content', label: 'Content', line: "The site's pages." },
  {
    section: 'Umb.Section.Library',
    label: 'Library',
    line: 'Shared pieces pages are built from: blocks, menus and promos.',
  },
  { section: 'Umb.Section.Media', label: 'Media', line: 'Images, documents and other files.' },
  {
    section: 'Crombolo.Section.Forms',
    label: 'Forms',
    line: 'Forms visitors fill in, and their answers.',
  },
  {
    section: 'Umb.Section.Members',
    label: 'Members',
    line: 'People who sign in to the site itself.',
  },
  {
    section: 'Umb.Section.Settings',
    label: 'Settings',
    line: "Content types, templates, redirects and the site's tools.",
  },
  {
    section: 'Umb.Section.Users',
    label: 'Users',
    line: 'The people who use the back office, and their groups.',
  },
  {
    section: 'Umb.Section.Translation',
    label: 'Translation',
    line: 'The dictionary of words templates show in each language.',
  },
  {
    section: 'Crombolo.Section.Workflow',
    label: 'Workflow',
    line: 'The approval steps a page goes through before it is published.',
  },
]

const D = (verb) => `Umb.Document.${verb}`
const E = (verb) => `Umb.Element.${verb}`

const cumulative = (steps) => steps.map((_, i) => steps.slice(0, i + 1).flat())

/** Each kind's levels: an id, a label, a line, and its verbs, each level adding to the one before. */
export const LEVELS = {
  pages: zip(
    [
      ['none', 'None', "Can't open pages"],
      ['see', 'See', 'Read, no changes'],
      ['edit', 'Edit', 'Write and organise drafts'],
      ['publish', 'Edit and publish', 'Also publish, unpublish, roll back'],
      ['full', 'Full control', 'Also delete, protect, set hostnames'],
    ],
    cumulative([
      [],
      [D('Read')],
      [D('Create'), D('Update'), D('Move'), D('Duplicate'), D('Sort'), D('PropertyValue.Write')],
      [D('Publish'), D('Unpublish'), D('Rollback')],
      [
        D('Delete'),
        'Umb.DocumentRecycleBin.Restore',
        D('PublicAccess'),
        D('CultureAndHostnames'),
        D('Permissions'),
      ],
    ]),
  ),
  library: zip(
    [
      ['none', 'None', "Can't open the Library"],
      ['see', 'See', 'Read, no changes'],
      ['edit', 'Edit', 'Write and organise drafts'],
      ['publish', 'Edit and publish', 'Also publish, unpublish, roll back'],
      ['full', 'Full control', 'Also delete'],
    ],
    cumulative([
      [],
      [E('Read')],
      [E('Create'), E('Update'), E('Move'), E('Duplicate')],
      [E('Publish'), E('Unpublish'), E('Rollback')],
      [E('Delete')],
    ]),
  ),
  media: zip(
    [
      ['none', 'None', "Can't open media"],
      ['see', 'See', 'Look, no changes'],
      ['edit', 'Upload and edit', 'Add, change and remove files'],
    ],
    cumulative([[], ['Crombolo.Media.Read'], ['Crombolo.Media.Update']]),
  ),
  forms: zip(
    [
      ['none', 'None', "Can't open forms"],
      ['see', 'See forms and answers', 'Read, no changes'],
      ['manage', 'Manage forms', 'Design forms, change and delete answers'],
    ],
    cumulative([
      [],
      ['Crombolo.Form.Read', 'Crombolo.FormEntry.Read'],
      ['Crombolo.Form.Manage', 'Crombolo.FormEntry.Manage'],
    ]),
  ),
}

function zip(words, verbs) {
  return words.map(([id, label, line], i) => ({ id, label, line, verbs: verbs[i] }))
}

/** Forms' sensitive answers: a toggle beside the level. */
export const SENSITIVE_ANSWERS = 'Crombolo.FormEntry.Sensitive'

/** Which area each kind belongs to, for "Access is off". */
export const KIND_AREA = {
  pages: 'Umb.Section.Content',
  library: 'Umb.Section.Library',
  media: 'Umb.Section.Media',
  forms: 'Crombolo.Section.Forms',
}

export const KIND_LABEL = { pages: 'Pages', library: 'Library', media: 'Media', forms: 'Forms' }

/** Every verb a kind's levels speak for. */
export const kindVerbs = (kind) => LEVELS[kind].at(-1).verbs

/** The level a group's verbs are for one kind, or 'custom'. */
export function levelOf(kind, verbs) {
  const own = new Set(kindVerbs(kind))
  const held = new Set(verbs.filter((verb) => own.has(verb)))
  const found = LEVELS[kind].find(
    (level) => level.verbs.length === held.size && level.verbs.every((verb) => held.has(verb)),
  )
  return found ? found.id : 'custom'
}

/** A group's verbs with one kind set to a level; nothing else touched. */
export function withLevel(verbs, kind, levelId) {
  const own = new Set(kindVerbs(kind))
  const level = LEVELS[kind].find((l) => l.id === levelId)
  if (!level) throw new Error(`${kind} has no level "${levelId}"`)
  return [...new Set([...verbs.filter((verb) => !own.has(verb)), ...level.verbs])]
}

/** A group's verbs with one verb turned on or off, for Customise. */
export const withVerb = (verbs, verb, on) =>
  on ? [...new Set([...verbs, verb])] : verbs.filter((v) => v !== verb)

/** Whether the Library follows Pages: the same level, translated. */
export function libraryFollowsPages(verbs) {
  const pages = levelOf('pages', verbs)
  return pages !== 'custom' && levelOf('library', verbs) === pages
}

/** What Customise shows for each verb, in plain words. */
export const VERB_WORDS = {
  [D('Read')]: 'See pages',
  [D('Create')]: 'Create pages and blueprints',
  [D('Update')]: 'Change pages',
  [D('Move')]: 'Move pages',
  [D('Duplicate')]: 'Copy pages',
  [D('Sort')]: 'Reorder pages',
  [D('PropertyValue.Write')]: 'Change any field',
  [D('Publish')]: 'Publish pages',
  [D('Unpublish')]: 'Unpublish pages',
  [D('Rollback')]: 'Roll back to an earlier version',
  [D('Delete')]: 'Delete pages',
  'Umb.DocumentRecycleBin.Restore': 'Restore pages from the recycle bin',
  [D('PublicAccess')]: 'Make a page members-only',
  [D('CultureAndHostnames')]: 'Set languages and hostnames',
  [D('Permissions')]: 'Change who can edit a page',
  [E('Read')]: 'See Library items',
  [E('Create')]: 'Create Library items and folders',
  [E('Update')]: 'Change Library items and folders',
  [E('Move')]: 'Move Library items and folders',
  [E('Duplicate')]: 'Copy Library items',
  [E('Publish')]: 'Publish Library items',
  [E('Unpublish')]: 'Unpublish Library items',
  [E('Rollback')]: "Roll back a Library item's earlier version",
  [E('Delete')]: 'Delete Library items and folders',
  'Crombolo.Media.Read': 'See media',
  'Crombolo.Media.Update': 'Upload, change and remove media',
  'Crombolo.Form.Read': 'See forms',
  'Crombolo.FormEntry.Read': 'Read answers',
  'Crombolo.Form.Manage': 'Design forms',
  'Crombolo.FormEntry.Manage': 'Change and delete answers',
}

/** Data Transfer's permissions, as sentences, in order; `under` indents one beneath another. */
export const TRANSFER = [
  {
    group: 'Content',
    verb: 'Crombolo.Remote.Pull',
    label: "Copy this site's content to their own machine",
    line: 'A pull: pages, media and settings, to work on locally.',
  },
  {
    group: 'Content',
    verb: 'Crombolo.Remote.PullFull',
    under: 'Crombolo.Remote.Pull',
    label: '…including members and users',
    line: "People's personal data, sealed with a passphrase.",
  },
  {
    group: 'Content',
    verb: 'Crombolo.Remote.Push',
    label: 'Send content to this site',
    line: 'A push or a content bundle: replaces pages here with theirs.',
  },
  {
    group: 'Content',
    verb: 'Crombolo.Remote.PushProtected',
    under: 'Crombolo.Remote.Push',
    label: '…even when this site is protected, with nobody approving',
    line: 'Production is usually protected.',
  },
  {
    group: 'Structure and code',
    verb: 'Crombolo.Remote.ApplyStructure',
    label: "Change this site's structure",
    line: 'Content types, stylesheets and scripts arriving in a bundle.',
  },
  {
    group: 'Structure and code',
    verb: 'Crombolo.Remote.InstallCode',
    warning: true,
    label: 'Install code on this site',
    line: 'Templates, server code and whole-site pushes: all of these run on the server. Nobody has this unless a group gives it, administrators included. Keep it on a group of its own, such as "Deployers".',
  },
]

/** Verbs the editor speaks for; anything else a group holds is an extension's, kept as it is. */
export const OWNED_VERBS = new Set([
  ...Object.keys(LEVELS).flatMap((kind) => kindVerbs(kind)),
  SENSITIVE_ANSWERS,
  ...TRANSFER.map((entry) => entry.verb),
])

const levelLabel = (kind, id) => LEVELS[kind].find((level) => level.id === id)?.label ?? 'Custom'

/** An exception as the list says it: where, and what is different there. */
export function exceptionSentence(exception, defaults) {
  if (exception.kind === 'field')
    return {
      where: `${exception.typeName} › ${exception.fieldName}`,
      whereNote: 'a field, on every page of that type',
      what: exception.verbs.includes(D('PropertyValue.Write'))
        ? 'Can change it'
        : "Can see it but can't change it",
    }
  const kind = exception.kind === 'library' ? 'library' : 'pages'
  const here = levelOf(kind, exception.verbs)
  const usual = levelOf(kind, defaults)
  return {
    where: exception.name,
    whereNote: 'and everything below it',
    what: `${KIND_LABEL[kind]}: ${levelLabel(kind, here)}${here === usual ? '' : `, instead of ${levelLabel(kind, usual)}`}`,
  }
}

/** The read-back before an exception is added. */
export function exceptionSummary(groupName, kind, placeName, levelId) {
  if (kind === 'field')
    return levelId === 'edit'
      ? `${groupName} will be able to change ${placeName}.`
      : `${groupName} will see ${placeName} but not change it.`
  const what = {
    none: 'not open',
    see: 'see, but not change,',
    edit: 'see and change, but not publish,',
    publish: 'see, change and publish',
    full: 'do anything with',
  }[levelId]
  return `${groupName} will ${what} ${kind === 'library' ? 'Library items' : 'pages'} under ${placeName}.`
}

export const ACCESS_OFF = (label) =>
  `This group can't open ${label}. Turn it on under Access to choose what they can do with it.`

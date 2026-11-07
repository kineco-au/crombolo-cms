/**
 * Permissions, sections and webhook events by plain names (story 254): what a
 * person types at the command line, beside the verbs and aliases that are
 * stored. A permission's plain name is always `area:action`, since read,
 * publish and the rest exist for pages, Library items, media and forms alike.
 */
import {
  DocumentPermissions,
  ElementContainerPermissions,
  ElementPermissions,
  FormPermissions,
  MediaPermissions,
  RemotePermissions,
} from './permissions.ts'
import type { SECTION_ALIASES } from './sections.ts'

export interface PermissionName {
  /** `content:publish` */
  name: string
  area: string
  /** `Umb.Document.Publish`, as a group stores it. */
  verb: string
  /** What it allows, in a line. */
  says: string
}

const kebab = (text: string) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()

const area = (
  name: string,
  verbs: Record<string, string>,
  says: Record<string, string>,
  strip = '',
): PermissionName[] =>
  Object.entries(verbs).map(([key, verb]) => ({
    name: `${name}:${kebab(key.slice(strip.length))}`,
    area: name,
    verb,
    says: says[key] ?? key,
  }))

const { EntriesView, EntriesManage, EntriesSensitive, ...formDesign } = FormPermissions

export const PERMISSION_NAMES: readonly PermissionName[] = [
  ...area('content', DocumentPermissions, {
    Read: 'See pages',
    Create: 'Create pages',
    Update: 'Change pages',
    Delete: 'Delete pages',
    Publish: 'Publish pages',
    Unpublish: 'Unpublish pages',
    Move: 'Move pages',
    Duplicate: 'Copy pages',
    Sort: 'Change the order of pages',
    Rollback: "Put back a page's earlier version",
    Notifications: 'Choose the notifications they get about pages',
    Permissions: 'Set who may do what on a page',
    CultureAndHostnames: "Set a page's languages and hostnames",
    PublicAccess: 'Restrict a page to members',
    CreateBlueprint: 'Make a blueprint from a page',
    PropertyValueRead: "See a page's protected values",
    PropertyValueWrite: "Change a page's protected values",
    RecycleBinRestore: 'Restore pages from the recycle bin',
  }),
  ...area('library', ElementPermissions, {
    Read: 'See Library items',
    Create: 'Create Library items',
    Update: 'Change Library items',
    Delete: 'Delete Library items',
    Move: 'Move Library items',
    Duplicate: 'Copy Library items',
    Publish: 'Publish Library items',
    Unpublish: 'Unpublish Library items',
    Rollback: "Put back a Library item's earlier version",
  }),
  ...area('library-folders', ElementContainerPermissions, {
    Read: 'See Library folders',
    Create: 'Create Library folders',
    Update: 'Rename Library folders',
    Delete: 'Delete Library folders',
    Move: 'Move Library folders',
  }),
  ...area('media', MediaPermissions, { Read: 'See media', Update: 'Change media' }),
  ...area('forms', formDesign, { View: 'See forms', Manage: 'Design forms' }),
  ...area(
    'form-entries',
    { EntriesView, EntriesManage, EntriesSensitive },
    {
      EntriesView: 'Read form entries',
      EntriesManage: 'Change and delete form entries',
      EntriesSensitive: 'See the answers a form marks sensitive',
    },
    'Entries',
  ),
  ...area('remote', RemotePermissions, {
    Pull: "Pull a site's content",
    PullFull: 'Pull a whole site, with its members and users',
    Push: 'Push a site',
    PushProtected: 'Push to a protected environment',
    ApplyStructure: "Change a site's definitions, views, styles or code from a bundle or push",
    InstallCode: 'Install the code a bundle carries',
  }),
]

export type PermissionLookup =
  | { ok: true; verb: string }
  | { ok: false; reason: string; candidates: readonly string[] }

/** The stored verb a plain name or a verb names; a bare action is refused with the names it could mean. */
export function permissionVerb(given: string): PermissionLookup {
  const wanted = given.trim().toLowerCase()
  const found = PERMISSION_NAMES.find((p) => p.name === wanted || p.verb.toLowerCase() === wanted)
  if (found) return { ok: true, verb: found.verb }
  const sameAction = PERMISSION_NAMES.filter((p) => p.name.endsWith(`:${wanted}`))
  if (sameAction.length > 0)
    return {
      ok: false,
      reason: `"${given}" needs its area: ${sameAction.map((p) => p.name).join(', ')}`,
      candidates: sameAction.map((p) => p.name),
    }
  return {
    ok: false,
    reason: `"${given}" is not a permission. \`crombolo users groups permissions\` lists them`,
    candidates: PERMISSION_NAMES.map((p) => p.name),
  }
}

/** A stored verb's plain name, or the verb itself when it has none. */
export const permissionName = (verb: string): string =>
  PERMISSION_NAMES.find((p) => p.verb === verb)?.name ?? verb

export const SECTION_NAMES: ReadonlyArray<{ name: keyof typeof SECTION_ALIASES; says: string }> = [
  { name: 'content', says: 'The pages of the site' },
  { name: 'media', says: 'Images, documents and other files' },
  { name: 'library', says: 'Items kept once and used on many pages' },
  { name: 'forms', says: 'Forms and their entries' },
  { name: 'members', says: 'The people who sign in to the site' },
  { name: 'users', says: 'The people who work in the back office, and their groups' },
  { name: 'translation', says: 'Dictionary items: words the site shows in each language' },
  { name: 'workflow', says: 'Approvals: pages waiting for someone to approve them' },
  {
    name: 'structure',
    says: 'Content types, data types and languages, which shape the whole site',
  },
  { name: 'components', says: 'Templates, components, stylesheets and scripts' },
  { name: 'workflowSetup', says: 'Setting up approval workflows, not deciding on them' },
  { name: 'settings', says: 'Types, templates, languages, bundles and the rest of the setup' },
]

/** An event's plain name from its display name: "Content Published" is `content-published`. */
export const eventName = (displayName: string): string =>
  displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

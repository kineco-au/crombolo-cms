/**
 * What an extension may ask to do with the site (stories 222, 308): each
 * permission, and the sentence an administrator reads before granting it.
 *
 * From schema 4 each is asked for with a reason, which the install shows beside
 * the sentence; `http.outbound` also names its origins. Schema 5 (story 320)
 * adds `backoffice.code`, the one that runs unconfined: `BACKOFFICE_CODE_WARNING`.
 * docs/bundles.md, "Permissions".
 */

/** Schema 4's catalogue: every area asks to read and to write apart. */
export const BUNDLE_PERMISSIONS = {
  'content.read': "Read the site's pages, their values and where they are",
  'content.write': 'Create, change, publish, unpublish, move and delete pages',
  'media.read': 'See media in the folders it names',
  'media.write': 'Add and change media in the folders it names',
  'members.read': 'See members and their groups, never their passwords',
  'members.write': 'Add, change and remove members, and put them in groups',
  'users.read':
    'See back-office users and their groups, never their passwords, tokens or second factors',
  'forms.read': "See the site's forms",
  'forms.write': 'Create and change forms',
  'formEntries.read': 'Read what people sent through the forms',
  'formEntries.write': 'Change and delete what people sent through the forms',
  'dictionary.read': "Read the site's dictionary words",
  'dictionary.write': 'Add, change and remove dictionary words',
  'contentTypes.read': 'See the content, media and member types and data types',
  'contentTypes.write': 'Create and change content, media and member types and data types',
  'webhooks.read': "See the site's webhooks",
  'webhooks.write': 'Add, change and remove webhooks, sending only where it may reach',
  'workflows.read': 'See the approval workflows and what waits for approval',
  'workflows.write': 'Change the approval workflows, and send and decide approvals',
  'redirects.read': "See the site's redirects",
  'redirects.write': 'Add, change and remove redirects',
  'identityProviders.read':
    'See the sign-in providers the site uses and their settings, never their secrets',
  'identityProviders.write': "Change administrators' settings for those sign-in providers",
  'member.delegate':
    'Act for a signed-in member who uses it: what it adds is theirs, and it sees only what they may see',
  actAs: 'Act for a back-office user, as chosen when it is granted, within what that user may do',
  'events.content': 'Be told when pages are saved, published, moved or deleted',
  'http.outbound':
    'Send requests from the server, and from its screens in your browser, to the addresses it names',
  'routes.public': 'Answer addresses on the site that anyone may call',
  templates: "Render its own components into the site's pages",
  // Story 320: the one permission that is not confined. Its words are the install's warning.
  'backoffice.code': 'Runs in your back office as each person using it',
} as const

export type BundlePermission = keyof typeof BUNDLE_PERMISSIONS

/** Schema 3's names, read only for an extension installed before schema 4. */
export const SCHEMA_3_PERMISSIONS = {
  'redirects.read': BUNDLE_PERMISSIONS['redirects.read'],
  'redirects.write': BUNDLE_PERMISSIONS['redirects.write'],
  'documents.read': "Look up the addresses of the site's pages",
  'identityProviders.read': BUNDLE_PERMISSIONS['identityProviders.read'],
  'identityProviders.write': BUNDLE_PERMISSIONS['identityProviders.write'],
  'media.read': BUNDLE_PERMISSIONS['media.read'],
  'media.write': BUNDLE_PERMISSIONS['media.write'],
  'member.delegate': BUNDLE_PERMISSIONS['member.delegate'],
} as const

/** The permission an extension's back-office code needs (story 320). */
export const BACKOFFICE_CODE = 'backoffice.code'

/**
 * What the install says beside `backoffice.code`, before the publisher's name and
 * what its signature shows.
 */
export const BACKOFFICE_CODE_WARNING =
  "Its screens act as whoever is signed in, with everything that person can do on this site. Unlike the rest of an extension, this part can't be kept apart from the site. Don't install this from a publisher you don't trust."

/** Never offered, whatever an extension asks: writing users could make anyone an administrator. */
export const NEVER_OFFERED: ReadonlySet<string> = new Set(['users.write'])

export const isBundlePermission = (value: unknown): value is BundlePermission =>
  typeof value === 'string' && Object.hasOwn(BUNDLE_PERMISSIONS, value)

const SENTENCES: Readonly<Record<string, string>> = {
  ...SCHEMA_3_PERMISSIONS,
  ...BUNDLE_PERMISSIONS,
}

/** A permission as an extension declares it: its name, its reason, and for `http.outbound` its origins. */
export interface DeclaredPermission {
  permission: string
  reason: string | null
  origins?: string[]
}

/** The longest reason the install shows. */
export const REASON_MAX = 200

/** `https://host[:port]`, or on a development site `http://localhost[:port]`. */
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/i

export const isOrigin = (value: unknown): value is string =>
  typeof value === 'string' && (ORIGIN.test(value) || LOCAL_ORIGIN.test(value))

/** What a schema 4 `permissions` object declares, or why it is not one. */
export function readPermissions(
  value: unknown,
): { declared: DeclaredPermission[] } | { problem: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {
      problem:
        '"crombolo.permissions" is an object: each permission it asks for, with the reason it needs it',
    }
  const declared: DeclaredPermission[] = []
  const problems: string[] = []
  for (const [permission, given] of Object.entries(value as Record<string, unknown>)) {
    if (NEVER_OFFERED.has(permission)) {
      problems.push(`"${permission}" is never offered: only an administrator changes users`)
      continue
    }
    if (!isBundlePermission(permission)) {
      problems.push(`"${permission}" is not a permission this release offers`)
      continue
    }
    const entry =
      given && typeof given === 'object' && !Array.isArray(given)
        ? (given as { reason?: unknown; origins?: unknown })
        : { reason: given }
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : ''
    if (reason.length === 0) problems.push(`"${permission}" gives no reason`)
    else if (reason.length > REASON_MAX)
      problems.push(`"${permission}"'s reason is longer than ${REASON_MAX} characters`)
    if (permission === 'http.outbound') {
      const origins = Array.isArray(entry.origins) ? entry.origins : []
      if (origins.length === 0)
        problems.push('"http.outbound" names no "origins": the addresses it sends to')
      for (const origin of origins.filter((candidate) => !isOrigin(candidate)))
        problems.push(
          `"http.outbound" names ${JSON.stringify(origin)}, which is not an origin like https://api.example.com`,
        )
      declared.push({ permission, reason, origins: origins.filter(isOrigin) })
    } else declared.push({ permission, reason })
  }
  return problems.length > 0 ? { problem: problems.join('; ') } : { declared }
}

/** Each permission with what it lets the extension do, and its reason, in the order declared. */
export function describePermissions(permissions: readonly (string | DeclaredPermission)[]): {
  permission: string
  allows: string
  reason: string | null
  origins?: string[]
  /** What the install says before it is granted: only `backoffice.code` has one (story 320). */
  warning?: string
}[] {
  return permissions.map((entry) => {
    const declared = typeof entry === 'string' ? { permission: entry, reason: null } : entry
    return {
      permission: declared.permission,
      allows: SENTENCES[declared.permission] ?? declared.permission,
      reason: declared.reason,
      ...(declared.origins ? { origins: declared.origins } : {}),
      ...(declared.permission === BACKOFFICE_CODE ? { warning: BACKOFFICE_CODE_WARNING } : {}),
    }
  })
}

/** Why a declared list or object is not one, or undefined when it is; schema 3 is a list of names. */
export function permissionsProblem(value: unknown, schemaVersion = 4): string | undefined {
  if (schemaVersion >= 4) {
    const read = readPermissions(value)
    return 'problem' in read ? read.problem : undefined
  }
  if (!Array.isArray(value)) return '"crombolo.permissions" must be a list of permissions'
  const unknown = value.filter(
    (permission) =>
      typeof permission !== 'string' || !Object.hasOwn(SCHEMA_3_PERMISSIONS, permission),
  )
  if (unknown.length > 0)
    return `"crombolo.permissions" names ${unknown.map((p) => JSON.stringify(p)).join(', ')}, which schema 3 does not offer: ${Object.keys(SCHEMA_3_PERMISSIONS).join(', ')}`
  if (new Set(value).size !== value.length) return '"crombolo.permissions" names a permission twice'
  return undefined
}

/**
 * What a `crombolo` field asks for, in schema 4's terms. Schema 3's list is read
 * name by name, `documents.read` as `content.read`; it gives no reasons.
 */
export function askedPermissions(
  field: { permissions?: unknown } | undefined,
): DeclaredPermission[] {
  const given = field?.permissions
  if (Array.isArray(given))
    return given
      .filter((permission): permission is string => typeof permission === 'string')
      .map((permission) => ({
        permission: permission === 'documents.read' ? 'content.read' : permission,
        reason: null,
      }))
  if (!given) return []
  const read = readPermissions(given)
  return 'declared' in read ? read.declared : []
}

/**
 * Whether a field is written for schema 3: a server half or permissions that
 * give no reasons. Installed, it still runs; a new install of it is refused.
 */
export function isSchema3Field(
  field: { server?: unknown; permissions?: unknown; schemaVersion?: unknown } | undefined,
): boolean {
  if (!field) return false
  const schema = typeof field.schemaVersion === 'number' ? field.schemaVersion : 1
  return schema < 4 && (field.server !== undefined || Array.isArray(field.permissions))
}

/** One setting an extension declares (story 310): what the back office shows and the config may lock. */
export interface ExtensionSetting {
  label: string
  /** `layout`: one of the site's components, the layout its page templates sit in (story 312). */
  type: 'text' | 'number' | 'boolean' | 'choice' | 'layout'
  /** With `choice`: the values it may take. */
  values?: string[]
  default?: string | number | boolean
  /** Kept sealed, and never shown again once saved. */
  secret?: boolean
}

const SETTING_KEY = /^[a-z][A-Za-z0-9]{0,39}$/

/** Its settings, or why `crombolo.settings` is not a set of them. */
export function readSettings(
  value: unknown,
): { settings: Record<string, ExtensionSetting> } | { problem: string } {
  if (value === undefined) return { settings: {} }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { problem: '"crombolo.settings" maps each setting\'s key to its label and type' }
  const settings: Record<string, ExtensionSetting> = {}
  const problems: string[] = []
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const setting = raw as Partial<ExtensionSetting>
    if (!SETTING_KEY.test(key)) problems.push(`the setting "${key}" is not a camelCase key`)
    if (!setting || typeof setting.label !== 'string' || !setting.label.trim())
      problems.push(`the setting "${key}" has no label`)
    if (!['text', 'number', 'boolean', 'choice', 'layout'].includes(setting?.type as string))
      problems.push(`the setting "${key}" is text, number, boolean, choice or layout`)
    if (
      setting?.type === 'choice' &&
      (!Array.isArray(setting.values) || setting.values.length === 0)
    )
      problems.push(`the choice "${key}" names no values`)
    if (problems.length === 0) settings[key] = setting as ExtensionSetting
  }
  return problems.length > 0 ? { problem: problems.join('; ') } : { settings }
}

/** A value as a setting holds it, or why it cannot. Pure. */
export function settingValueProblem(setting: ExtensionSetting, value: unknown): string | undefined {
  switch (setting.type) {
    case 'text':
      return typeof value === 'string' ? undefined : `${setting.label} is text`
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : `${setting.label} is a number`
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `${setting.label} is yes or no`
    case 'layout':
      return typeof value === 'string' && /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(value)
        ? undefined
        : `${setting.label} is one of the site's layouts`
    case 'choice':
      return typeof value === 'string' && (setting.values ?? []).includes(value)
        ? undefined
        : `${setting.label} is one of ${(setting.values ?? []).join(', ')}`
  }
}

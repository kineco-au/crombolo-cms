/**
 * An extension's way to the site's areas (story 308): the Management API, and
 * the CMS's own back-office API, called in this process as the extension.
 *
 * Each permission it was granted allows a set of paths and methods, checked
 * before the call. The API's own validation, permissions, approval workflows and
 * audit then apply. Acting as itself, an extension holds nothing but what its
 * grant gives (least privilege): never an administrator, so its publishes always
 * meet the approval workflows. docs/bundles.md, "Permissions".
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Principal } from '@crombolo/api-management'
import { USER_DELEGATE } from '@crombolo/backoffice-host/registry'
import {
  DocumentPermissions,
  FormPermissions,
  MediaPermissions,
  ROOT_ACCESS,
  SECTION_ALIASES,
} from '@crombolo/core'

/** A permission's reach: the paths, under the back office, its methods may call. */
interface Reach {
  /** `read` is GET and HEAD; `write` is POST, PUT, PATCH and DELETE. */
  methods: 'read' | 'write'
  /** Prefixes of the path after the back office, without a leading slash. */
  paths: readonly string[]
  /** Prefixes inside those that it does not reach. */
  except?: readonly string[]
}

const MANAGEMENT = 'management/api/v1/'
const PLUGIN = 'crombolo/api/'

const management = (...areas: string[]) =>
  areas.flatMap((area) => [
    `${MANAGEMENT}${area}`,
    `${MANAGEMENT}tree/${area}`,
    `${MANAGEMENT}item/${area}`,
    `${MANAGEMENT}collection/${area}`,
    `${MANAGEMENT}filter/${area}`,
  ])

const read = (paths: string[], except?: string[]): Reach => ({ methods: 'read', paths, except })
const write = (paths: string[], except?: string[]): Reach => ({ methods: 'write', paths, except })

const CONTENT = [
  ...management('document', 'document-version'),
  `${MANAGEMENT}recycle-bin/document`,
  `${MANAGEMENT}language`,
]
const MEDIA = [
  ...management('media'),
  `${MANAGEMENT}recycle-bin/media`,
  `${MANAGEMENT}imaging`,
  `${MANAGEMENT}temporary-file`,
]
const MEMBERS = management('member', 'member-group')
const USERS = management('user', 'user-group')
const FORM_ENTRIES = [`${PLUGIN}forms/entries`]
const FORMS = [`${PLUGIN}forms`]
const DICTIONARY = [...management('dictionary'), `${PLUGIN}dictionary`]
const CONTENT_TYPES = [
  ...management('document-type', 'media-type', 'member-type', 'data-type'),
  `${MANAGEMENT}property-type`,
]
const WEBHOOKS = [...management('webhook'), `${PLUGIN}webhooks`]
const WORKFLOWS = [`${PLUGIN}approvals`]
const REDIRECTS = [`${MANAGEMENT}redirect-management`]

/** What each permission reaches through `api`; a permission absent here reaches nothing through it. */
export const API_PERMISSIONS: Readonly<Record<string, readonly Reach[]>> = {
  'content.read': [read(CONTENT)],
  'content.write': [write(CONTENT, [`${MANAGEMENT}document/${'public-access'}`])],
  'media.read': [read(MEDIA)],
  'media.write': [write(MEDIA)],
  'members.read': [read(MEMBERS)],
  'members.write': [write(MEMBERS)],
  'users.read': [read(USERS, [`${MANAGEMENT}user/current`])],
  'forms.read': [read(FORMS, FORM_ENTRIES)],
  'forms.write': [write(FORMS, FORM_ENTRIES)],
  'formEntries.read': [read(FORM_ENTRIES)],
  'formEntries.write': [write(FORM_ENTRIES)],
  'dictionary.read': [read(DICTIONARY)],
  'dictionary.write': [write(DICTIONARY)],
  'contentTypes.read': [read(CONTENT_TYPES)],
  'contentTypes.write': [write(CONTENT_TYPES)],
  'webhooks.read': [read(WEBHOOKS)],
  'webhooks.write': [write(WEBHOOKS)],
  'workflows.read': [read(WORKFLOWS)],
  'workflows.write': [write(WORKFLOWS)],
  'redirects.read': [read(REDIRECTS)],
  'redirects.write': [write(REDIRECTS)],
}

const READING = new Set(['GET', 'HEAD'])

/** Whether a path is a prefix's own, or below it: `document` is not `document-type`. */
const under = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)

/** The permissions that would let `method` reach `path` (after the back office). Pure. */
export function permissionsFor(method: string, path: string): string[] {
  const kind = READING.has(method.toUpperCase()) ? 'read' : 'write'
  const clean = path.replace(/^\/+/, '')
  return Object.entries(API_PERMISSIONS)
    .filter(([, reaches]) =>
      reaches.some(
        (reach) =>
          reach.methods === kind &&
          reach.paths.some((prefix) => under(clean, prefix)) &&
          !(reach.except ?? []).some((prefix) => under(clean, prefix)),
      ),
    )
    .map(([permission]) => permission)
}

/** The sections a set of permissions needs, for the API's own section checks. */
const SECTIONS: Readonly<Record<string, string>> = {
  content: SECTION_ALIASES.content,
  media: SECTION_ALIASES.media,
  members: SECTION_ALIASES.members,
  users: SECTION_ALIASES.users,
  forms: SECTION_ALIASES.forms,
  formEntries: SECTION_ALIASES.forms,
  dictionary: SECTION_ALIASES.translation,
  contentTypes: SECTION_ALIASES.settings,
  webhooks: SECTION_ALIASES.settings,
  workflows: SECTION_ALIASES.workflow,
  redirects: SECTION_ALIASES.content,
}

/** The section an area's permission needs, for acting as the person using it (story 325). */
export const sectionOfPermission = (permission: string): string | undefined => {
  const area = permission.split('.')[0] as string
  return area === 'identityProviders' ? SECTION_ALIASES.settings : SECTIONS[area]
}

/** The verbs a set of permissions needs, for the API's own permission checks. */
function verbsOf(granted: ReadonlySet<string>): string[] {
  const verbs = new Set<string>()
  if (granted.has('content.read'))
    for (const verb of [DocumentPermissions.Read, DocumentPermissions.PropertyValueRead])
      verbs.add(verb)
  if (granted.has('content.write'))
    for (const verb of Object.values(DocumentPermissions)) {
      if (verb === DocumentPermissions.Permissions || verb === DocumentPermissions.PublicAccess)
        continue
      verbs.add(verb)
    }
  if (granted.has('media.read')) verbs.add(MediaPermissions.Read)
  if (granted.has('media.write'))
    for (const verb of Object.values(MediaPermissions)) verbs.add(verb)
  if (granted.has('forms.read')) verbs.add(FormPermissions.View)
  if (granted.has('forms.write')) verbs.add(FormPermissions.Manage)
  if (granted.has('formEntries.read')) verbs.add(FormPermissions.EntriesView)
  if (granted.has('formEntries.write')) verbs.add(FormPermissions.EntriesManage)
  return [...verbs]
}

/**
 * The extension acting as itself: what its grant gives and nothing else, never
 * an administrator, on the whole tree and every language. Its id is its own, so
 * the audit names it.
 */
export function extensionPrincipal(
  bundle: { id: string; name: string },
  granted: readonly string[],
): Principal {
  const set = new Set(granted)
  const sections = new Set<string>()
  for (const permission of set) {
    const section = SECTIONS[permission.split('.')[0] as string]
    if (section) sections.add(section)
  }
  const verbs = verbsOf(set)
  return {
    id: `extension:${bundle.id}`,
    userName: `extension:${bundle.id}`,
    name: `Extension ${bundle.name}`,
    email: '',
    isAdmin: false,
    languageIsoCode: undefined,
    avatarUrls: [],
    allowedSections: [...sections],
    permissions: verbs,
    groupKeys: [],
    hasAccessToAllLanguages: true,
    languages: [],
    startNodes: { document: ROOT_ACCESS, media: ROOT_ACCESS, element: ROOT_ACCESS },
    groups: [
      {
        key: `extension:${bundle.id}`,
        alias: `extension-${bundle.id}`,
        defaults: verbs,
        granular: new Map(),
      },
    ],
  }
}

/** A call refused before it was made, naming what would have allowed it. */
export class ApiRefusedError extends Error {
  override readonly name = 'ApiRefusedError'
}

export interface BundleApi {
  /** Any method, on a path after the back office: `management/api/v1/document/<id>`. */
  request(method: string, path: string, body?: unknown): Promise<Response>
  get(path: string): Promise<Response>
  post(path: string, body?: unknown): Promise<Response>
  put(path: string, body?: unknown): Promise<Response>
  delete(path: string): Promise<Response>
}

/**
 * Who a request made through `api` is, for the length of the call. The request
 * carries a header naming the call with a secret only this process holds, so it
 * survives the request being copied on its way, and no request from outside
 * can claim one.
 */
const ACTING_HEADER = 'x-crombolo-acting'
const SECRET = crypto.randomUUID()
const acting = new Map<string, Principal>()

/** The principal an in-process request from an extension carries; undefined for any other request. */
export function actingPrincipalOf(request: Request): Principal | undefined {
  const value = request.headers.get(ACTING_HEADER)
  if (!value) return undefined
  const [secret, call] = value.split('.')
  return secret === SECRET && call ? acting.get(call) : undefined
}

const calling = new AsyncLocalStorage<{ id: string; name: string }>()

/** The extension whose call to `api` is being answered, while it is. */
export const callingExtension = (): string | undefined => calling.getStore()?.id

/** Its name, for the audit log's "Redirects, for Adam" (story 325). */
export const callingExtensionName = (): string | undefined => calling.getStore()?.name

/**
 * What no extension may do through `api` for anyone, however wide the person's
 * own access (story 325): install or grant extensions, change users or groups,
 * or reach a site as a remote. Pure.
 */
export function refusedForEveryone(method: string, path: string): string | undefined {
  const clean = path.replace(/^\/+/, '')
  if (
    under(clean, `${PLUGIN}extensions`) ||
    under(clean, `${PLUGIN}bundles`) ||
    under(clean, 'remote')
  )
    return 'an extension may not install or grant extensions, or reach this site as a remote, for anyone'
  if (
    !READING.has(method.toUpperCase()) &&
    (under(clean, `${MANAGEMENT}user`) || under(clean, `${MANAGEMENT}user-group`))
  )
    return 'an extension may not change users or groups, for anyone'
  return undefined
}

/**
 * `api` for one extension and caller: refuses what the grant does not cover,
 * then sends the call to the server as `principal`. `dispatch` is the server's
 * own handler, set once the server is built.
 */
export function createBundleApi(options: {
  bundleId: string
  /** Its name, for the audit log; its id when not given. */
  bundleName?: string
  origin: string
  backOfficePath: string
  granted: () => readonly string[]
  principal: () => Promise<Principal | undefined>
  dispatch: () => ((request: Request) => Promise<Response>) | undefined
}): BundleApi {
  const base = options.backOfficePath.replace(/\/+$/, '')
  const request = async (method: string, path: string, body?: unknown) => {
    const verb = method.toUpperCase()
    const clean = path.replace(/^\/+/, '')
    const needs = permissionsFor(verb, clean)
    const granted = new Set(options.granted())
    const never = refusedForEveryone(verb, clean)
    if (never) throw new ApiRefusedError(`${options.bundleId} may not ${verb} ${clean}: ${never}.`)
    // Acting for the person reaches every area; the API then holds it to their own rights (story 325).
    const delegated = granted.has(USER_DELEGATE) && needs.length > 0
    if (!delegated && !needs.some((permission) => granted.has(permission)))
      throw new ApiRefusedError(
        needs.length > 0
          ? `${options.bundleId} may not ${verb} ${clean}: it needs ${needs.join(' or ')}, which it was not granted.`
          : `${options.bundleId} may not ${verb} ${clean}: no permission reaches it.`,
      )
    const dispatch = options.dispatch()
    if (!dispatch) throw new ApiRefusedError('The site is not answering yet.')
    const principal = await options.principal()
    if (!principal) throw new ApiRefusedError(`${options.bundleId} has no one to act as.`)
    const call = crypto.randomUUID()
    const sent = new Request(`${options.origin}${base}/${clean}`, {
      method: verb,
      headers: {
        [ACTING_HEADER]: `${SECRET}.${call}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    acting.set(call, principal)
    try {
      return await calling.run(
        { id: options.bundleId, name: options.bundleName ?? options.bundleId },
        () => dispatch(sent),
      )
    } finally {
      acting.delete(call)
    }
  }
  return {
    request,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    delete: (path) => request('DELETE', path),
  }
}

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A user's key, as `--delegate-to` names one: lower case, or null when it is not one. */
export function userKeyOf(value: unknown): string | null {
  return typeof value === 'string' && KEY.test(value.trim()) ? value.trim().toLowerCase() : null
}

/**
 * Authorization for every Management API call, as Umbraco's policies apply it:
 * first the sections an operation's controller demands (any one of a set, and
 * every set), then, for documents and media, the caller's start nodes and the
 * permission verbs the operation needs on the nodes it names, and for elements
 * the verbs it needs. Users and user groups carry rules about the people
 * involved, which their port enforces. See docs/backoffice-hosting.md for the
 * tables' provenance.
 */
import type { OperationInfo } from '@crombolo/contracts'
import {
  type AppAlias,
  DocumentPermissions as D,
  ElementPermissions as E,
  ElementContainerPermissions as EC,
  fallbackPermissions,
  hasPathAccess,
  MediaPermissions as M,
  permissionsForPath,
  propertyValuePermissions,
  type StartNodes,
  sectionKey,
} from '@crombolo/core'
import type { Principal } from './router.ts'

/**
 * Operations behind Umbraco's `DenyLocalLoginIfConfigured` policy: the contract
 * marks them secured, but while local login is allowed the policy lets anyone
 * through, since the login page calls them before anyone has signed in.
 */
export const LOCAL_LOGIN_OPERATIONS: ReadonlySet<string> = new Set([
  'GetSecurityConfiguration',
  'PostSecurityForgotPassword',
  'PostSecurityForgotPasswordReset',
])

/**
 * The sections a caller holds, normalised the one way.
 *
 * Aliases arrive either bare or as manifest aliases depending on where they were
 * read, so every check goes through this rather than comparing what it was given.
 */
export const sectionsOf = (principal: Principal): Set<string> =>
  new Set(principal.allowedSections.map(sectionKey))

/**
 * Whether a caller holds a section, named in either vocabulary. For the routes
 * outside the contract — the plugin endpoints — which have no operation for
 * `authorize` to look up but must answer to the same rule as the operations they
 * stand next to.
 */
export const hasSection = (principal: Principal, section: string): boolean =>
  sectionsOf(principal).has(sectionKey(section))

/** A node's ancestor keys then its own, root first, and whether it is in the recycle bin. */
export interface NodeChain {
  chain: string[]
  trashed: boolean
}

/** Where nodes sit, for start-node and per-node permission checks. */
export interface NodeLookup {
  documents(keys: readonly string[]): Promise<Map<string, NodeChain>>
  media(keys: readonly string[]): Promise<Map<string, NodeChain>>
  /** Every document below `key`. */
  documentDescendants(key: string): Promise<NodeChain[]>
  /** The document a version belongs to. */
  versionDocument(versionId: string): Promise<string | undefined>
}

type Sections = readonly AppAlias[]

const CONTENT: Sections = ['content']
const MEDIA: Sections = ['media']
const SETTINGS: Sections = ['settings']
const USERS: Sections = ['users']
const MEMBERS: Sections = ['members']
const TRANSLATION: Sections = ['translation']
const LIBRARY: Sections = ['library']
const PACKAGES: Sections = ['packages']
/** SectionAccessFor{Content,Media,Element}Tree: pickers open these trees from anywhere. */
const ANY_TREE: Sections = [
  'content',
  'media',
  'users',
  'settings',
  'packages',
  'members',
  'library',
]

const TREES: Record<string, Sections> = {
  document: ANY_TREE,
  media: ANY_TREE,
  element: ANY_TREE,
  'document-type': SETTINGS,
  'document-blueprint': SETTINGS,
  'data-type': SETTINGS,
  'media-type': SETTINGS,
  'member-type': ['settings', 'members'],
  template: ['settings', 'content'],
  dictionary: ['translation', 'settings'],
  'partial-view': SETTINGS,
  script: SETTINGS,
  stylesheet: SETTINGS,
  'relation-type': SETTINGS,
  'static-file': ['settings', 'content', 'media', 'members'],
  'member-group': MEMBERS,
}

const SETTINGS_AREAS = new Set([
  'log-viewer',
  'health-check',
  'health-check-group',
  'indexer',
  'searcher',
  'models-builder',
  'profiling',
  'published-cache',
  'telemetry',
  'webhook',
  'partial-view',
  'script',
  'stylesheet',
  'relation-type',
])

/** Type actions only the Settings section may take, beyond every write. */
const TYPE_ADMIN_ACTIONS = new Set([
  'configuration',
  'available-compositions',
  'composition-references',
  'export',
  'import',
  'copy',
  'move',
  'template',
  'folder',
])

/**
 * The sections an operation demands: every set must be satisfied, each by any
 * one of its sections; the string `admin` requires the admin group. Operations
 * absent here need only a signed-in backoffice user.
 */
export function sectionRequirements(operation: OperationInfo): Array<Sections | 'admin'> {
  const [area = '', second = '', third = ''] = operation.path
    .replace(/^\/umbraco\/management\/api\/v1\//, '')
    .split('/')
  const write = operation.method !== 'get'
  const action = second.startsWith('{') ? third : second
  const typeAdmin = write || TYPE_ADMIN_ACTIONS.has(action)
  if (SETTINGS_AREAS.has(area)) return [SETTINGS]
  switch (area) {
    case 'tree':
      return TREES[second] ? [TREES[second]] : []
    case 'recycle-bin':
      return [second === 'media' ? MEDIA : second === 'element' ? LIBRARY : CONTENT]
    case 'collection':
      return [second === 'media' ? MEDIA : CONTENT]
    case 'filter':
      if (second === 'data-type') return [['content', 'settings']]
      if (second === 'user' || second === 'user-group') return [USERS]
      if (second === 'member') return [MEMBERS]
      return []
    case 'redirect-management':
      // Tracking on or off is a setting for the whole site, not an edit to content
      return second === 'status' && write ? [SETTINGS] : [CONTENT]
    case 'document':
    case 'document-version':
    case 'relation':
    case 'oembed':
    case 'dynamic-root':
      return [CONTENT]
    case 'document-type':
      if (second === 'folder') return [SETTINGS]
      if (third === 'blueprint') return [['content', 'library', 'settings'], CONTENT]
      return typeAdmin
        ? [['content', 'library', 'settings'], SETTINGS]
        : [['content', 'library', 'settings']]
    case 'document-blueprint':
      if (second === 'from-document' || third === 'scaffold') return [CONTENT]
      if (!write && second.startsWith('{') && third === '') return [['content', 'settings']]
      return [SETTINGS]
    case 'data-type':
      if (second === 'folder') return [SETTINGS]
      return typeAdmin
        ? [['content', 'library', 'media', 'members', 'settings'], SETTINGS]
        : [['content', 'library', 'media', 'members', 'settings']]
    case 'media':
      return [MEDIA]
    case 'media-type':
      if (second === 'folder') return [SETTINGS]
      return typeAdmin ? [['media', 'settings'], SETTINGS] : [['media', 'settings']]
    case 'member-type':
      if (second === 'folder') return [SETTINGS]
      return typeAdmin ? [['settings', 'members'], SETTINGS] : [['settings', 'members']]
    case 'member':
    case 'member-group':
      return [MEMBERS]
    case 'template':
      return write ? [['settings', 'content'], SETTINGS] : [['settings', 'content']]
    case 'language':
      return write ? [SETTINGS] : []
    case 'dictionary':
      return [TRANSLATION]
    case 'user':
      return second === 'current' ? [] : [USERS]
    case 'user-group':
      return [USERS]
    case 'element':
    case 'element-version':
      return [LIBRARY]
    case 'package':
      return [PACKAGES]
    case 'upgrade':
      return ['admin']
    case 'server':
      return second === 'upgrade-check' ? ['admin'] : []
    default:
      return []
  }
}

/** Where a rule finds the node it checks: a path or query parameter, a body field, or a fixed place. */
type NodeRef =
  | { param: string }
  | { query: string; orRoot?: true }
  | { body: readonly string[] }
  | { version: string }
  | 'root'
  | 'bin'

interface DocumentRule {
  verbs: readonly string[]
  node: NodeRef
  /** Every descendant too. */
  branch?: boolean
  /** Also check the cultures the body names. */
  cultures?: boolean
}

const id: NodeRef = { param: 'id' }
const DOCUMENT_RULES: Record<string, readonly DocumentRule[]> = {
  GetDocumentById: [{ verbs: [D.Read], node: id }],
  GetDocumentByIdPublished: [{ verbs: [D.Read], node: id }],
  GetDocumentByIdAuditLog: [{ verbs: [D.Read], node: id }],
  GetDocumentByIdDomains: [{ verbs: [D.Read], node: id }],
  GetDocumentByIdNotifications: [{ verbs: [D.Read], node: id }],
  PutDocumentByIdNotifications: [{ verbs: [D.Read], node: id }],
  GetDocumentByIdAvailableSegmentOptions: [{ verbs: [D.Read], node: id }],
  GetDocumentByIdPreviewUrl: [{ verbs: [D.Read], node: id }],
  GetDocumentVersion: [{ verbs: [D.Read], node: { query: 'documentId' } }],
  GetDocumentVersionById: [{ verbs: [D.Read], node: { version: 'id' } }],
  PutDocumentVersionByIdPreventCleanup: [{ verbs: [D.Update], node: { version: 'id' } }],
  // The list view: it answers with the children's own property values, so it is
  // a read of the branch and not merely of the tree, and Umbraco filters it per
  // item (ContentListViewService.FilterAuthorizedKeysAsync). Requiring Read on
  // the parent is the same boundary expressed once: a caller who cannot reach the
  // parent's path cannot reach anything below it either.
  GetCollectionDocumentById: [{ verbs: [D.Read], node: id }],
  PostDocument: [{ verbs: [D.Create], node: { body: ['parent', 'id'] } }],
  PostDocumentValidate: [{ verbs: [D.Create], node: { body: ['parent', 'id'] } }],
  PutDocumentById: [{ verbs: [D.Update], node: id }],
  PatchDocumentByIdPatch: [{ verbs: [D.Update], node: id }],
  PutDocumentByIdValidate: [{ verbs: [D.Update], node: id }],
  PostDocumentCreateAndPublish: [
    { verbs: [D.Publish], node: { body: ['parent', 'id'] }, cultures: true },
  ],
  PutDocumentByIdUpdateAndPublish: [{ verbs: [D.Publish], node: id, cultures: true }],
  PutDocumentByIdPublish: [{ verbs: [D.Publish], node: id, cultures: true }],
  PutDocumentByIdPublishWithDescendants: [
    { verbs: [D.Publish], node: id, branch: true, cultures: true },
  ],
  PutDocumentByIdUnpublish: [{ verbs: [D.Unpublish], node: id, cultures: true }],
  DeleteDocumentById: [{ verbs: [D.Delete], node: id }],
  PutDocumentByIdMoveToRecycleBin: [{ verbs: [D.Delete], node: id }],
  PutDocumentByIdMove: [
    { verbs: [D.Move], node: id },
    { verbs: [D.Create], node: { body: ['target', 'id'] } },
  ],
  PostDocumentByIdCopy: [
    { verbs: [D.Duplicate], node: id },
    { verbs: [D.Create], node: { body: ['target', 'id'] } },
  ],
  PutDocumentSort: [
    { verbs: [D.Sort], node: { body: ['parent', 'id'] } },
    { verbs: [D.Sort], node: { body: ['sorting', '*', 'id'] } },
  ],
  PutDocumentByIdSortChildren: [{ verbs: [D.Sort], node: id }],
  PutDocumentRootSortChildren: [{ verbs: [D.Sort], node: 'root' }],
  GetDocumentByIdPublicAccess: [{ verbs: [D.PublicAccess], node: id }],
  PostDocumentByIdPublicAccess: [{ verbs: [D.PublicAccess], node: id }],
  PutDocumentByIdPublicAccess: [{ verbs: [D.PublicAccess], node: id }],
  DeleteDocumentByIdPublicAccess: [{ verbs: [D.PublicAccess], node: id }],
  PutDocumentByIdDomains: [{ verbs: [D.CultureAndHostnames], node: id }],
  PostDocumentVersionByIdRollback: [{ verbs: [D.Rollback], node: { version: 'id' } }],
  PostDocumentBlueprintFromDocument: [
    { verbs: [D.CreateBlueprint], node: { body: ['document', 'id'] } },
  ],
  DeleteRecycleBinDocument: [{ verbs: [D.Delete], node: 'bin' }],
  DeleteRecycleBinDocumentById: [{ verbs: [D.Delete], node: 'bin' }],
  PutRecycleBinDocumentByIdRestore: [{ verbs: [D.Move], node: 'bin' }],
  GetRecycleBinDocumentByIdOriginalParent: [{ verbs: [D.Read], node: 'bin' }],
}

/**
 * Media verbs are the groups' fallback ones (media has no per-node permissions),
 * on top of the start-node path checks on the nodes a rule names. Trees and
 * items stay open to pickers, as for documents.
 */
interface MediaRule {
  verbs: readonly string[]
  nodes: readonly NodeRef[]
}

const MEDIA_RULES: Record<string, MediaRule> = {
  GetMediaById: { verbs: [M.Read], nodes: [id] },
  // As for documents above. `id` is a query parameter here and omitting it means
  // the root, so the rule says so rather than leaving the absent case unchecked.
  GetCollectionMedia: { verbs: [M.Read], nodes: [{ query: 'id', orRoot: true }] },
  GetMediaByIdAuditLog: { verbs: [M.Read], nodes: [id] },
  GetRecycleBinMediaByIdOriginalParent: { verbs: [M.Read], nodes: ['bin'] },
  PutMediaById: { verbs: [M.Update], nodes: [id] },
  PutMediaByIdValidate: { verbs: [M.Update], nodes: [id] },
  DeleteMediaById: { verbs: [M.Update], nodes: [id] },
  PutMediaByIdMove: { verbs: [M.Update], nodes: [id, { body: ['target', 'id'] }] },
  PutMediaByIdMoveToRecycleBin: { verbs: [M.Update], nodes: [id] },
  PutMediaByIdSortChildren: { verbs: [M.Update], nodes: [id] },
  PostMedia: { verbs: [M.Update], nodes: [{ body: ['parent', 'id'] }] },
  PostMediaValidate: { verbs: [M.Update], nodes: [{ body: ['parent', 'id'] }] },
  PutMediaSort: {
    verbs: [M.Update],
    nodes: [{ body: ['parent', 'id'] }, { body: ['sorting', '*', 'id'] }],
  },
  PutMediaRootSortChildren: { verbs: [M.Update], nodes: ['root'] },
  DeleteRecycleBinMedia: { verbs: [M.Update], nodes: ['bin'] },
  DeleteRecycleBinMediaById: { verbs: [M.Update], nodes: ['bin'] },
  PutRecycleBinMediaByIdRestore: { verbs: [M.Update], nodes: ['bin'] },
}

/**
 * The element and element folder verbs each Library operation needs, held in
 * the groups' fallback permissions. Mirrors DOCUMENT_RULES verb for verb.
 */
const ELEMENT_RULES: Record<string, readonly string[]> = {
  GetElementById: [E.Read],
  GetElementByIdPublished: [E.Read],
  GetElementByIdAuditLog: [E.Read],
  GetElementVersion: [E.Read],
  GetElementVersionById: [E.Read],
  GetRecycleBinElementByIdOriginalParent: [E.Read],
  PostElement: [E.Create],
  PostElementValidate: [E.Create],
  PutElementById: [E.Update],
  PutElementByIdValidate: [E.Update],
  PutElementVersionByIdPreventCleanup: [E.Update],
  PostElementCreateAndPublish: [E.Publish],
  PutElementByIdUpdateAndPublish: [E.Publish],
  PutElementByIdPublish: [E.Publish],
  PutElementByIdUnpublish: [E.Unpublish],
  DeleteElementById: [E.Delete],
  PutElementByIdMoveToRecycleBin: [E.Delete],
  PutElementByIdMove: [E.Move],
  PostElementByIdCopy: [E.Duplicate, E.Create],
  PostElementVersionByIdRollback: [E.Rollback],
  DeleteRecycleBinElementById: [E.Delete],
  PutRecycleBinElementByIdRestore: [E.Move],
  // Emptying the bin deletes the folders in it as well as the elements
  DeleteRecycleBinElement: [E.Delete, EC.Delete],
  GetElementFolderById: [EC.Read],
  GetRecycleBinElementFolderByIdOriginalParent: [EC.Read],
  PostElementFolder: [EC.Create],
  PutElementFolderById: [EC.Update],
  DeleteElementFolderById: [EC.Delete],
  PutElementFolderByIdMoveToRecycleBin: [EC.Delete],
  DeleteRecycleBinElementFolderById: [EC.Delete],
  PutElementFolderByIdMove: [EC.Move],
  PutRecycleBinElementFolderByIdRestore: [EC.Move],
}

/** Values at `path` in `body`; `*` walks every element of an array. A missing or null step means the root. */
function pick(body: unknown, path: readonly string[]): Array<string | null> {
  let current: unknown[] = [body]
  for (const step of path) {
    const next: unknown[] = []
    for (const value of current) {
      if (value === null || value === undefined) {
        next.push(null)
        continue
      }
      if (step === '*') {
        if (Array.isArray(value)) next.push(...value)
      } else next.push((value as Record<string, unknown>)[step] ?? null)
    }
    current = next
  }
  return current.map((v) => (typeof v === 'string' ? v : null))
}

function culturesIn(body: unknown): string[] {
  const b = (body ?? {}) as Record<string, unknown>
  const out: string[] = []
  for (const field of ['cultures', 'culturesToPublish'])
    if (Array.isArray(b[field]))
      out.push(...((b[field] as unknown[]).filter((c) => typeof c === 'string') as string[]))
  if (Array.isArray(b.publishSchedules))
    for (const schedule of b.publishSchedules as Array<Record<string, unknown>>)
      if (typeof schedule?.culture === 'string') out.push(schedule.culture)
  return out
}

/** Whether the user may work in every culture named. */
export function hasCultureAccess(principal: Principal, cultures: readonly string[]): boolean {
  if (principal.hasAccessToAllLanguages) return true
  const allowed = new Set(principal.languages.map((l) => l.toLowerCase()))
  return cultures.every((c) => allowed.has(c.toLowerCase()))
}

/** Root and the recycle bin are reached only with root access, and hold the groups' default verbs. */
const fixedPlaceAllows = (start: StartNodes, principal: Principal, verbs: readonly string[]) => {
  if (!start.root) return false
  const granted = permissionsForPath(principal.groups, [])
  return verbs.every((v) => granted.has(v))
}

async function resolveKeys(
  ref: NodeRef,
  params: Readonly<Record<string, string>>,
  url: URL,
  body: () => Promise<unknown>,
  nodes: NodeLookup,
): Promise<Array<string | 'root' | 'bin'>> {
  if (ref === 'root' || ref === 'bin') return [ref]
  if ('param' in ref) return params[ref.param] ? [params[ref.param] as string] : []
  if ('query' in ref) {
    const value = url.searchParams.get(ref.query)
    if (value) return [value]
    // An absent parameter means the root for an operation that says so, rather
    // than nothing to check — otherwise omitting it is how the check is skipped.
    return ref.orRoot ? ['root'] : []
  }
  if ('version' in ref) {
    const document = params[ref.version]
      ? await nodes.versionDocument(params[ref.version] as string)
      : undefined
    return document ? [document] : []
  }
  return pick(await body(), ref.body).map((key) => key ?? 'root')
}

/**
 * Keys the caller is denied Read on as children of a parent they can read. A
 * child can only lose what its parent grants by an explicit setting on the child
 * itself, so the candidates are the nodes the caller's groups set explicitly; a
 * candidate that is not a child of this parent filters nothing.
 */
export function deniedChildren(principal: Principal, parentChain: readonly string[]): string[] {
  const candidates = new Set(principal.groups.flatMap((g) => [...g.granular.keys()]))
  return [...candidates].filter(
    (key) => !permissionsForPath(principal.groups, [...parentChain, key]).has(D.Read),
  )
}

/** One property value as a save carries it. */
export interface PropertyValueRef {
  alias: string
  culture: string | null
  segment: string | null
  value: unknown
}

/** JSON with object keys in order, so equal values compare equal however they were built. */
const canonical = (value: unknown): string =>
  JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )

/** Each property's values by culture and segment, nulls left out: what a save would leave stored. */
function valuesByAlias(values: readonly PropertyValueRef[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const v of values) {
    if (v.value === null || v.value === undefined) continue
    const alias = v.alias.toLowerCase()
    const variants = out.get(alias) ?? new Map<string, string>()
    const where = `${v.culture?.toLowerCase() ?? ''}|${v.segment ?? ''}`
    if (!variants.has(where)) variants.set(where, canonical(v.value))
    out.set(alias, variants)
  }
  return out
}

/**
 * The first property a save would change that the caller's groups may not
 * write (`Umb.Document.PropertyValue.Write`, per property type), or undefined.
 * A value sent back as it was is not a change; one left out that was stored is.
 */
export function deniedPropertyWrite<P extends { alias: string; key: string }>(
  principal: Principal,
  properties: readonly P[],
  before: readonly PropertyValueRef[],
  after: readonly PropertyValueRef[],
): P | undefined {
  const old = valuesByAlias(before)
  const next = valuesByAlias(after)
  for (const property of properties) {
    const alias = property.alias.toLowerCase()
    const a = old.get(alias) ?? new Map<string, string>()
    const b = next.get(alias) ?? new Map<string, string>()
    const changed = a.size !== b.size || [...a].some(([where, value]) => b.get(where) !== value)
    if (!changed) continue
    if (!propertyValuePermissions(principal.groups, property.key).has(D.PropertyValueWrite))
      return property
  }
  return undefined
}

/** Whether the caller may read a document's draft: the Content section, its path, and Read on it. */
export async function canReadDocument(
  principal: Principal,
  key: string,
  nodes: NodeLookup,
): Promise<boolean> {
  const node = (await nodes.documents([key])).get(key.toLowerCase())
  return node !== undefined && canReadDocumentAt(principal, node.chain, node.trashed)
}

/** `canReadDocument` for a document whose place is known: its ancestors' keys then its own. Pure. */
export function canReadDocumentAt(
  principal: Principal,
  chain: readonly string[],
  trashed = false,
): boolean {
  if (!hasSection(principal, 'content')) return false
  if (!hasPathAccess(principal.startNodes.document, chain, trashed)) return false
  return permissionsForPath(principal.groups, chain).has(D.Read)
}

/** Evaluates the operation's section requirements, then its node rules. */
export async function authorize(
  operation: OperationInfo,
  params: Readonly<Record<string, string>>,
  request: Request,
  principal: Principal,
  nodes: NodeLookup | undefined,
): Promise<boolean> {
  const sections = sectionsOf(principal)
  for (const requirement of sectionRequirements(operation)) {
    if (requirement === 'admin') {
      if (!principal.isAdmin) return false
    } else if (!requirement.some((s) => sections.has(s))) return false
  }
  // Administrators are not exempt: their group holds every verb and the root, as in Umbraco
  if (!nodes) return true

  const url = new URL(request.url)
  let parsed: Promise<unknown> | undefined
  const body = () => {
    parsed ??= request
      .clone()
      .json()
      .catch(() => undefined)
    return parsed
  }

  for (const rule of DOCUMENT_RULES[operation.operationId] ?? []) {
    const start = principal.startNodes.document
    const keys = await resolveKeys(rule.node, params, url, body, nodes)
    const real = keys.filter((k): k is string => k !== 'root' && k !== 'bin')
    const found = await nodes.documents(real)
    for (const key of keys) {
      if (key === 'root' || key === 'bin') {
        if (!fixedPlaceAllows(start, principal, rule.verbs)) return false
        continue
      }
      const node = found.get(key.toLowerCase())
      // A missing node is not denied: the handler answers 404
      if (!node) continue
      const targets = rule.branch ? [node, ...(await nodes.documentDescendants(key))] : [node]
      for (const target of targets) {
        if (!hasPathAccess(start, target.chain, target.trashed)) return false
        const granted = permissionsForPath(principal.groups, target.chain)
        if (!rule.verbs.every((v) => granted.has(v))) return false
      }
    }
    if (rule.cultures && !hasCultureAccess(principal, culturesIn(await body()))) return false
  }

  const fallback = fallbackPermissions(principal.groups)
  const elementVerbs = ELEMENT_RULES[operation.operationId]
  if (elementVerbs && !elementVerbs.every((v) => fallback.has(v))) return false

  const media = MEDIA_RULES[operation.operationId]
  if (media) {
    if (!media.verbs.every((v) => fallback.has(v))) return false
    const start = principal.startNodes.media
    for (const ref of media.nodes) {
      const keys = await resolveKeys(ref, params, url, body, nodes)
      const found = await nodes.media(keys.filter((k): k is string => k !== 'root' && k !== 'bin'))
      for (const key of keys) {
        if (key === 'root' || key === 'bin') {
          if (!start.root) return false
          continue
        }
        const node = found.get(key.toLowerCase())
        if (node && !hasPathAccess(start, node.chain, node.trashed)) return false
      }
    }
  }
  return true
}

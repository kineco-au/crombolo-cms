/**
 * Story 444: a site's members held by another site. The client signs in to that site
 * as a service account by client credentials, keeps the token until it expires, and
 * calls its Management API by the vendored contract. The remote ports implement the
 * member and member group ports over it, so every caller of the ports reaches the other
 * site. docs/configuration.md, "Members held by another site".
 */
import {
  hasSection,
  type MemberGroupItem,
  type MemberGroupPort,
  type MemberGroupResponse,
  type MemberGroupStatus,
  type MemberGroupTreeItem,
  type MemberItem,
  type MemberPort,
  type MemberResponse,
  type PortFailure,
  type Principal,
  type SaveMember,
} from '@crombolo/api-management/domain'
import { type DocumentOperations, systemActor } from '@crombolo/content'
import { listOperations, loadSpec, type OperationId, type OperationInfo } from '@crombolo/contracts'
import {
  DEFAULT_BACKOFFICE_PATH,
  normaliseUuid,
  type Page,
  problemDetails,
  problemResponse,
} from '@crombolo/core'
import { type AuditActor, type Db, PublicAccessRepository } from '@crombolo/data'
import type { CromboloConfig } from './config.ts'
import type { DeliveryMemberSecurity } from './delivery-members.ts'
import type { MemberAuth } from './member-auth.ts'
import type { MemberLinkOutcome } from './member-links.ts'

/** The header a write carries, naming who it is for: `<id>|<name>`, each part URI-encoded. */
export const ACTING_FOR_HEADER = 'Crombolo-Acting-For'

export interface ActingFor {
  id: string
  name: string
}

/** The header's value for this person or code. Pure. */
export const actingForValue = (actor: ActingFor): string =>
  `${encodeURIComponent(actor.id)}|${encodeURIComponent(actor.name)}`

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
const CONTROL = /[\u0000-\u001f\u007f]/g

/** Whom a header names, length-limited and with control characters removed; undefined when malformed. Pure. */
export function readActingFor(value: string | null | undefined): AuditActor | undefined {
  if (!value) return undefined
  const at = value.indexOf('|')
  if (at < 1) return undefined
  try {
    const id = decodeURIComponent(value.slice(0, at)).replace(CONTROL, '').trim().slice(0, 200)
    const name = decodeURIComponent(value.slice(at + 1))
      .replace(CONTROL, '')
      .trim()
      .slice(0, 100)
    return id ? { id, name: name || null } : undefined
  } catch {
    return undefined
  }
}

/** Who a back-office user's write is for. Pure. */
export const actingForPrincipal = (principal: Pick<Principal, 'id' | 'name'>): ActingFor => ({
  id: principal.id,
  name: principal.name,
})

/** Why the other site couldn't be used: it didn't answer, or it refused, in its own words. */
export class MembersSourceError extends Error {
  constructor(
    readonly kind: 'unreachable' | 'refused',
    message: string,
    readonly status?: number,
    readonly operationStatus?: string,
  ) {
    super(message)
  }
}

/** What the Members section says while the other site isn't answering. Pure. */
export const notAnswering = (source: string) =>
  `Members are kept at ${source}, which isn't answering.`

/** The Management API's answer to a request the other site couldn't serve; undefined for anything else. */
export function membersSourceResponse(error: unknown): Response | undefined {
  if (!(error instanceof MembersSourceError)) return undefined
  return problemResponse(
    problemDetails({
      title: error.message,
      status: error.kind === 'unreachable' ? 503 : (error.status ?? 502),
      ...(error.operationStatus ? { operationStatus: error.operationStatus } : {}),
    }),
  )
}

type Query = Record<string, string | number | boolean | readonly string[] | null | undefined>

export interface CallOptions {
  params?: Record<string, string>
  query?: Query
  body?: unknown
  actingFor?: ActingFor
}

export interface MembersClient {
  /** The other site's address, as configured. */
  readonly source: string
  /** One Management API operation; throws `MembersSourceError` when the site doesn't answer. */
  call(operationId: OperationId, options?: CallOptions): Promise<Response>
  /**
   * Story 448: one of the other site's own routes under `{pluginPath}/api`, for what the
   * Management API has no operation for; throws as `call` does.
   */
  route(method: string, path: string, options?: Omit<CallOptions, 'params'>): Promise<Response>
}

export interface MembersClientOptions {
  source: string
  client: { id: string; secret: string }
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

const MANAGEMENT = '/umbraco/management/api/v1'
/** The other site's own routes, at the default back-office path. */
const PLUGIN_API = `${DEFAULT_BACKOFFICE_PATH}/crombolo/api`
/** A token is given up this long before it expires, so a request never carries a dead one. */
const MARGIN_MS = 30_000

let operations: Map<string, OperationInfo> | undefined
const operationOf = (id: OperationId): OperationInfo => {
  operations ??= new Map(listOperations(loadSpec()).map((op) => [op.operationId, op]))
  const found = operations.get(id)
  if (!found) throw new Error(`The contract has no operation ${id}.`)
  return found
}

/** A problem's own sentence: its detail, else its title. */
async function sentenceOf(response: Response, fallback: string): Promise<string> {
  const body = (await response
    .clone()
    .json()
    .catch(() => undefined)) as { detail?: unknown; title?: unknown; message?: unknown } | undefined
  const said = [body?.detail, body?.title, body?.message].find(
    (text): text is string => typeof text === 'string' && text.trim() !== '',
  )
  return said ?? fallback
}

async function operationStatusOf(response: Response): Promise<string | undefined> {
  const body = (await response
    .clone()
    .json()
    .catch(() => undefined)) as { operationStatus?: unknown } | undefined
  return typeof body?.operationStatus === 'string' ? body.operationStatus : undefined
}

export function createMembersClient(options: MembersClientOptions): MembersClient {
  const source = options.source.replace(/\/+$/, '')
  const send = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? 10_000
  let held: { token: string; until: number } | undefined
  let asking: Promise<string> | undefined

  const reach = async (url: string, init: RequestInit): Promise<Response> => {
    let response: Response
    try {
      response = await send(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      throw new MembersSourceError('unreachable', notAnswering(source))
    }
    if (response.status >= 500) throw new MembersSourceError('unreachable', notAnswering(source))
    return response
  }

  const signIn = async (): Promise<string> => {
    const response = await reach(`${source}${MANAGEMENT}/security/back-office/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.client.id,
        client_secret: options.client.secret,
      }).toString(),
    })
    const body = (await response.json().catch(() => undefined)) as
      | { access_token?: unknown; expires_in?: unknown }
      | undefined
    if (!response.ok || typeof body?.access_token !== 'string')
      throw new MembersSourceError(
        'refused',
        `${source} refused this site's service account, ${options.client.id}: check members.client.`,
        502,
      )
    const seconds = typeof body.expires_in === 'number' ? body.expires_in : 300
    held = { token: body.access_token, until: now() + seconds * 1000 - MARGIN_MS }
    return body.access_token
  }

  const token = async (): Promise<string> => {
    if (held && held.until > now()) return held.token
    asking ??= signIn().finally(() => {
      asking = undefined
    })
    return asking
  }

  const searchOf = (query: Query | undefined): string => {
    const search = new URLSearchParams()
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) for (const each of value) search.append(name, each)
      else search.set(name, String(value))
    }
    const text = search.toString()
    return text ? `?${text}` : ''
  }

  const urlOf = (operation: OperationInfo, call: CallOptions): string => {
    const path = operation.path.replace(/\{(\w+)\}/g, (_whole, name: string) =>
      encodeURIComponent(call.params?.[name] ?? ''),
    )
    return `${source}${path}${searchOf(call.query)}`
  }

  /** A request with this site's token, signed in again once on a 401. */
  const authorised = async (url: string, method: string, call: CallOptions) => {
    const attempt = async () =>
      reach(url, {
        method,
        headers: {
          authorization: `Bearer ${await token()}`,
          accept: 'application/json',
          ...(call.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(call.actingFor ? { [ACTING_FOR_HEADER]: actingForValue(call.actingFor) } : {}),
        },
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      })
    let response = await attempt()
    if (response.status === 401) {
      held = undefined
      response = await attempt()
    }
    if (response.status === 401)
      throw new MembersSourceError(
        'refused',
        `${source} refused this site's service account, ${options.client.id}: check members.client.`,
        502,
      )
    return response
  }

  return {
    source,
    call(operationId, call = {}) {
      const operation = operationOf(operationId)
      return authorised(urlOf(operation, call), operation.method.toUpperCase(), call)
    },
    route(method, path, call = {}) {
      return authorised(
        `${source}${PLUGIN_API}/${path.replace(/^\/+/, '')}${searchOf(call.query)}`,
        method.toUpperCase(),
        call,
      )
    },
  }
}

/** A refusal the other site gave for a read, in its words. */
async function refusedRead(response: Response): Promise<never> {
  throw new MembersSourceError(
    'refused',
    await sentenceOf(response, 'The site that holds the members refused that.'),
    response.status === 403 ? 403 : 502,
  )
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) return refusedRead(response)
  return (await response.json()) as T
}

async function failureOf(response: Response, fallback: string): Promise<PortFailure> {
  const operationStatus = await operationStatusOf(response)
  return {
    ok: false,
    reason: await sentenceOf(response, fallback),
    status: response.status,
    ...(operationStatus ? { operationStatus } : {}),
  }
}

const createdKey = (response: Response, fallback: string): string => {
  const generated = response.headers.get('umb-generated-resource')
  if (generated) return generated
  const location = response.headers.get('location')
  return location?.split('/').pop() || fallback
}

/** What a save sends, as the Management API's member handlers read it. Pure. */
export function memberBody(input: SaveMember, forCreate: boolean): Record<string, unknown> {
  const shared = {
    email: input.email,
    username: input.username,
    isApproved: input.isApproved,
    values: input.values.map((value) => ({
      alias: value.alias,
      culture: value.culture ?? null,
      segment: value.segment ?? null,
      value: value.value,
    })),
    variants: input.variants,
    ...(input.groupKeys === undefined ? {} : { groups: input.groupKeys }),
  }
  if (forCreate)
    return {
      id: input.key,
      memberType: { id: input.memberTypeKey },
      ...shared,
      ...(input.password ? { password: input.password } : {}),
    }
  return {
    ...shared,
    isLockedOut: input.isLockedOut,
    isTwoFactorEnabled: input.isTwoFactorEnabled,
    ...(input.password ? { newPassword: input.password } : {}),
    ...(input.oldPassword ? { oldPassword: input.oldPassword } : {}),
  }
}

/** A provider a member signs in with: its id, its name there, and their id there to Sensitive data. */
export interface MemberSignIn {
  provider: string
  name: string
  declared: boolean
  subject?: string
}

/** What a reset link came to: sent, handed back, or refused as they have no password. */
export type RemoteResetLink = { sent: boolean; link?: string } | { refused: 'provider' }

/** The other site's members, each call naming who it is for. */
export function remoteMembers(client: MembersClient) {
  return {
    async byKey(key: string): Promise<MemberResponse | undefined> {
      const response = await client.call('GetMemberById', { params: { id: key } })
      if (response.status === 404) return undefined
      return json<MemberResponse>(response)
    },
    async create(
      input: SaveMember,
      actingFor: ActingFor | undefined,
    ): Promise<{ ok: true; key: string } | PortFailure> {
      const response = await client.call('PostMember', {
        body: memberBody(input, true),
        actingFor,
      })
      if (response.status === 201) return { ok: true, key: createdKey(response, input.key) }
      return failureOf(response, 'The member could not be created.')
    },
    async update(
      key: string,
      input: SaveMember,
      actingFor: ActingFor | undefined,
    ): Promise<{ ok: true } | PortFailure> {
      const response = await client.call('PutMemberById', {
        params: { id: key },
        body: memberBody(input, false),
        actingFor,
      })
      if (response.ok) return { ok: true }
      return failureOf(response, 'The member could not be saved.')
    },
    async remove(key: string, actingFor: ActingFor | undefined): Promise<boolean | PortFailure> {
      const response = await client.call('DeleteMemberById', { params: { id: key }, actingFor })
      if (response.ok) return true
      if (response.status === 404) return false
      return failureOf(response, 'The member could not be deleted.')
    },
    async filter(query: Query): Promise<Page<MemberResponse>> {
      const page = await json<{ items: MemberResponse[]; total: number }>(
        await client.call('GetFilterMember', { query }),
      )
      return { items: page.items, total: page.total }
    },
    async items(keys: readonly string[]): Promise<MemberItem[]> {
      if (keys.length === 0) return []
      return json<MemberItem[]>(await client.call('GetItemMember', { query: { id: keys } }))
    },
    async search(query: Query): Promise<Page<MemberItem>> {
      const page = await json<{ items: MemberItem[]; total: number }>(
        await client.call('GetItemMemberSearch', { query }),
      )
      return { items: page.items, total: page.total }
    },
    /** A member by their exact username, found through the filter. */
    async byUsername(username: string): Promise<MemberResponse | undefined> {
      const page = await this.filter({ filter: username, skip: 0, take: 100 })
      return page.items.find((m) => m.username.toLowerCase() === username.toLowerCase())
    },
    async byEmail(email: string): Promise<MemberResponse | undefined> {
      const page = await this.filter({ filter: email, skip: 0, take: 100 })
      return page.items.find((m) => m.email.toLowerCase() === email.toLowerCase())
    },
    /** Story 448: the identity providers a member signs in with, as the other site knows them. */
    async signIns(key: string): Promise<MemberSignIn[]> {
      const response = await client.route('GET', `members/${encodeURIComponent(key)}/sign-ins`)
      if (response.status === 404) return []
      return (await json<{ items: MemberSignIn[] }>(response)).items
    },
    /**
     * Story 448: a reset link, sent by the other site's mail to its reset page, or handed
     * back where it can't send; one who signs in through a provider is refused.
     */
    async resetLink(key: string, actingFor: ActingFor | undefined): Promise<RemoteResetLink> {
      const response = await client.route('POST', `members/${encodeURIComponent(key)}/reset-link`, {
        body: {},
        actingFor,
      })
      if (response.ok) {
        const body = (await response.json()) as { sent?: unknown; link?: unknown }
        return {
          sent: body.sent === true,
          ...(typeof body.link === 'string' ? { link: body.link } : {}),
        }
      }
      const body = (await response
        .clone()
        .json()
        .catch(() => undefined)) as { code?: unknown } | undefined
      if (body?.code === 'signs-in-through-provider') return { refused: 'provider' }
      return refusedRead(response)
    },
    /**
     * Story 448: `crombolo members link` run on the other site, against its members and its
     * member identity providers; answers its report.
     */
    async link(
      options: { provider: string; property: string; dryRun?: boolean },
      actingFor: ActingFor | undefined,
    ): Promise<MemberLinkOutcome> {
      return json<MemberLinkOutcome>(
        await client.route('POST', 'members/link', {
          body: {
            provider: options.provider,
            property: options.property,
            dryRun: options.dryRun === true,
          },
          actingFor,
        }),
      )
    },
  }
}

export type RemoteMembers = ReturnType<typeof remoteMembers>

/**
 * The member port over the other site. Validation is this site's, because member types
 * are schema and the same on both; the other site checks again, and its refusals,
 * `ManagedOutside` included, come back in its words.
 */
export function createRemoteMemberPort(
  client: MembersClient,
  options: { validate: MemberPort['validate'] },
): MemberPort {
  const remote = remoteMembers(client)
  return {
    byKey: (key) => remote.byKey(key),
    validate: options.validate,
    create: (input, principal) => remote.create(input, actingForPrincipal(principal)),
    update: (key, input, principal) => remote.update(key, input, actingForPrincipal(principal)),
    remove: (key, principal) => remote.remove(key, actingForPrincipal(principal)),
    filter: (criteria) =>
      remote.filter({
        skip: criteria.skip,
        take: criteria.take,
        memberTypeId: criteria.memberTypeKey,
        memberGroupName: criteria.memberGroupName,
        isApproved: criteria.isApproved,
        isLockedOut: criteria.isLockedOut,
        filter: criteria.filter,
        orderBy: criteria.orderBy,
        orderDirection: criteria.orderDirection,
      }),
    items: (keys) => remote.items(keys),
    search: (query, paging) =>
      remote.search({
        query,
        skip: paging.skip,
        take: paging.take,
        allowedMemberTypes: paging.allowedMemberTypeKeys,
      }),
  }
}

export interface NamedGroup {
  key: string
  name: string
}

/** What a rename here does to this site's own rules, after the other site has answered. */
export interface GroupRenames {
  renamed(from: string, to: string, principal: Principal | undefined): Promise<void>
}

/** The member group port over the other site. A rename rewrites this site's rules naming the group. */
export function createRemoteMemberGroupPort(
  client: MembersClient,
  options: { renames?: GroupRenames; onChange?: () => void } = {},
): MemberGroupPort {
  const forWhom = (principal: Principal | undefined) =>
    principal ? actingForPrincipal(principal) : undefined
  const duplicate = async (response: Response) =>
    response.status === 400 && (await operationStatusOf(response)) === 'DuplicateName'
  const byKey = async (key: string): Promise<MemberGroupResponse | undefined> => {
    const response = await client.call('GetMemberGroupById', { params: { id: key } })
    if (response.status === 404) return undefined
    return json<MemberGroupResponse>(response)
  }
  return {
    async list(paging) {
      const page = await json<{ items: MemberGroupResponse[]; total: number }>(
        await client.call('GetMemberGroup', { query: { skip: paging.skip, take: paging.take } }),
      )
      return { items: page.items, total: page.total }
    },
    byKey,
    async items(keys) {
      if (keys.length === 0) return []
      return json<MemberGroupItem[]>(
        await client.call('GetItemMemberGroup', { query: { id: keys } }),
      )
    },
    async tree(paging) {
      const page = await json<{ items: MemberGroupTreeItem[]; total: number }>(
        await client.call('GetTreeMemberGroupRoot', {
          query: { skip: paging.skip, take: paging.take },
        }),
      )
      return { items: page.items, total: page.total }
    },
    async create(input, principal) {
      const response = await client.call('PostMemberGroup', {
        body: { name: input.name, ...(input.key ? { id: input.key } : {}) },
        actingFor: forWhom(principal),
      })
      if (response.status === 201) {
        options.onChange?.()
        return { status: 'ok', key: createdKey(response, input.key ?? '') }
      }
      if (await duplicate(response)) return { status: 'duplicate-name' }
      return refusedRead(response)
    },
    async rename(key, name, principal): Promise<MemberGroupStatus> {
      const before = await byKey(key)
      if (!before) return 'not-found'
      const response = await client.call('PutMemberGroupById', {
        params: { id: key },
        body: { name },
        actingFor: forWhom(principal),
      })
      if (response.status === 404) return 'not-found'
      if (await duplicate(response)) return 'duplicate-name'
      if (!response.ok) return refusedRead(response)
      options.onChange?.()
      if (before.name !== name) await options.renames?.renamed(before.name, name, principal)
      return 'ok'
    },
    async remove(key, principal): Promise<MemberGroupStatus> {
      const response = await client.call('DeleteMemberGroupById', {
        params: { id: key },
        actingFor: forWhom(principal),
      })
      if (response.status === 404) return 'not-found'
      if (!response.ok) return refusedRead(response)
      options.onChange?.()
      return 'ok'
    },
  }
}

/** How many of this site's pages have a rule of their own naming the group. */
export async function pagesNamingGroup(db: Db, name: string): Promise<number> {
  return (await new PublicAccessRepository(db).namingGroup(name)).length
}

/**
 * Rewrites this site's rules naming a group the other site renamed, through the
 * document operations, so the next change carries them as any rule change.
 */
export function rulesFollowRenames(
  db: Db,
  documents: () => DocumentOperations | undefined,
): GroupRenames {
  return {
    async renamed(from, to, principal) {
      const operations = documents()
      if (!operations) return
      const actor = systemActor('Member group renamed', {
        source: 'request',
        ...(principal ? { user: { id: principal.id, name: principal.name } } : {}),
        note: `the member group "${from}" renamed to "${to}"`,
      })
      for (const entry of await new PublicAccessRepository(db).namingGroup(from))
        await operations.setPublicAccess(
          actor,
          entry.nodeKey,
          {
            loginDocumentKey: entry.loginNodeKey,
            errorDocumentKey: entry.errorNodeKey,
            memberGroupNames: entry.memberGroupNames.map((group) => (group === from ? to : group)),
            memberUserNames: entry.memberUserNames,
          },
          'set',
        )
    },
  }
}

const GROUPS_FOR_MS = 60_000

/** Everything this site keeps of the other site: the client, and its groups for a minute. */
export interface MembersSource {
  readonly source: string
  readonly client: MembersClient
  readonly members: RemoteMembers
  /** Every group by key and name, for rendering and preview here: kept for a minute. */
  groups(): Promise<NamedGroup[]>
  /** Forgets the groups kept, after a change made from here. */
  forgetGroups(): void
  /** Whether the other site answers this site's account now. */
  answering(): Promise<{ ok: true } | { ok: false; message: string }>
}

export function createMembersSource(
  client: MembersClient,
  options: { now?: () => number } = {},
): MembersSource {
  const now = options.now ?? Date.now
  let kept: { groups: NamedGroup[]; until: number } | undefined
  const members = remoteMembers(client)
  const all = async (): Promise<NamedGroup[]> => {
    const found: NamedGroup[] = []
    for (let skip = 0; ; skip += 500) {
      const page = await json<{ items: MemberGroupResponse[]; total: number }>(
        await client.call('GetMemberGroup', { query: { skip, take: 500 } }),
      )
      found.push(...page.items.map((g) => ({ key: normaliseUuid(g.id), name: g.name })))
      if (page.items.length === 0 || found.length >= page.total) break
    }
    return found.sort((a, b) => a.name.localeCompare(b.name))
  }
  return {
    source: client.source,
    client,
    members,
    async groups() {
      if (kept && kept.until > now()) return kept.groups
      const groups = await all()
      kept = { groups, until: now() + GROUPS_FOR_MS }
      return groups
    },
    forgetGroups() {
      kept = undefined
    },
    async answering() {
      try {
        const response = await client.call('GetMemberGroup', { query: { skip: 0, take: 1 } })
        if (response.ok) return { ok: true }
        return {
          ok: false,
          message: await sentenceOf(response, 'The site that holds the members refused that.'),
        }
      } catch (error) {
        if (error instanceof MembersSourceError) return { ok: false, message: error.message }
        throw error
      }
    },
  }
}

/** The other site's client, when `members.source` is set; undefined when members are this site's own. */
export function membersSourceFor(
  config: Pick<CromboloConfig, 'members'>,
  options: { fetch?: typeof fetch } = {},
): MembersSource | undefined {
  const source = config.members?.source
  const client = config.members?.client
  if (!source || !client) return undefined
  return createMembersSource(createMembersClient({ source, client, fetch: options.fetch }))
}

/** The sentence a path this site no longer serves for members gives. Pure. */
export const membersKeptAt = (source: string) =>
  `Members are kept at ${source}: they sign in, register and are managed there.`

const keptAt = (source: string) =>
  Response.json(
    { message: membersKeptAt(source) },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  )

/**
 * Member sign-in, registration, reset and external sign-in, off: this site holds no
 * members, so nobody is signed in and every member route answers 404. Public Access
 * still decides, and a protected page sends a visitor to its sign-in page.
 */
export function memberAuthOff(auth: MemberAuth, source: string): MemberAuth {
  return {
    ...auth,
    resolve: async () => undefined,
    session: async () => undefined,
    byKey: async () => undefined,
    handle: async () => keptAt(source),
    sendResetLink: async () => ({ refused: 'unavailable' }),
    externalSignInUrl: () => undefined,
  }
}

/** The Delivery API's member routes, off, for the same reason. */
export function deliveryMembersOff(
  security: DeliveryMemberSecurity,
  source: string,
): DeliveryMemberSecurity {
  return {
    ...security,
    member: async () => undefined,
    handle: async () => keptAt(source),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const noStore = { 'cache-control': 'no-store' }
const said = (status: number, message: string) =>
  Response.json({ message }, { status, headers: noStore })

/**
 * The back office's view of where members are kept, to whoever holds Members:
 * `{pluginPath}/api/members-source` says where and whether it answers;
 * `…/member-groups/{key}/rules` counts this site's pages whose rules name a group, for
 * the warning before a rename; `…/members/{key}/manager` says who keeps a member there.
 */
export function createMembersSourceApi(
  db: Db,
  source: MembersSource | undefined,
  groups: () => MemberGroupPort | undefined,
) {
  return {
    async status(principal: Principal): Promise<Response> {
      if (!hasSection(principal, 'members')) return said(403, 'This user may not use Members.')
      if (!source) return Response.json({ source: null }, { headers: noStore })
      const answer = await source.answering()
      return Response.json(
        {
          source: source.source,
          answering: answer.ok,
          ...(answer.ok ? {} : { message: answer.message }),
        },
        { headers: noStore },
      )
    },

    async groupRules(principal: Principal, key: string): Promise<Response> {
      if (!hasSection(principal, 'members')) return said(403, 'This user may not use Members.')
      if (!UUID.test(key)) return said(404, 'There is no such member group.')
      try {
        const group = await groups()?.byKey(key)
        if (!group) return said(404, 'There is no such member group.')
        return Response.json(
          {
            name: group.name,
            pages: await pagesNamingGroup(db, group.name),
            rewritten: Boolean(source),
          },
          { headers: noStore },
        )
      } catch (error) {
        const answered = membersSourceResponse(error)
        if (answered) return answered
        throw error
      }
    },

    async manager(request: Request, principal: Principal, key: string): Promise<Response> {
      if (!source) return said(404, 'There is no such member.')
      if (!hasSection(principal, 'members')) return said(403, 'This user may not use Members.')
      if (request.method === 'DELETE')
        return Response.json(
          {
            message: `A member is handed back to the site at ${source.source}, by whoever keeps them.`,
            operationStatus: 'ManagedOutside',
          },
          { status: 403, headers: noStore },
        )
      if (request.method !== 'GET') return new Response(null, { status: 405 })
      if (!UUID.test(key)) return said(404, 'There is no such member.')
      try {
        const member = await source.members.byKey(key)
        if (!member) return said(404, 'There is no such member.')
        return Response.json({ managedBy: member.managedBy ?? null }, { headers: noStore })
      } catch (error) {
        const answered = membersSourceResponse(error)
        if (answered) return answered
        throw error
      }
    },
  }
}

/**
 * Service accounts (story 433): the API users other systems and the site's own code sign
 * in as, at `<plugin>/api/service-accounts`, for administrators alone. What each is used for
 * comes from the config the server started with; taking away what something depends on is
 * refused unless the caller says they know, naming each use. docs/backoffice-hosting.md,
 * "Service accounts".
 */
import { randomBytes } from 'node:crypto'
import type { Principal } from '@crombolo/api-management/domain'
import { hashPassword } from '@crombolo/auth'
import { normaliseUuid } from '@crombolo/core'
import {
  AuditLog,
  type ClientCredentialDetail,
  type Db,
  UserGroupRepository,
  type UserRecord,
  UserRepository,
} from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import { API_CLIENT_ID_PREFIX } from './config.ts'

/** The settings that name an API client, in the words the screen says them in. */
export interface ServiceAccountSettings {
  content?: { actAs?: string }
  members?: { actAs?: string; managedBy?: readonly string[]; actorsFrom?: readonly string[] }
  users?: { managedBy: readonly string[] }
  groups?: { managedBy: readonly string[] }
}

/** What each client id is used for, from the config. */
export function serviceAccountUses(config: ServiceAccountSettings): (clientId: string) => string[] {
  return (clientId) => [
    ...(config.content?.actAs === clientId ? ["Changes pages for the site's own code"] : []),
    ...(config.members?.actAs === clientId
      ? ['Reads and changes members for background jobs']
      : []),
    ...(config.members?.managedBy?.includes(clientId)
      ? ["Keeps this site's members from a directory up to date"]
      : []),
    ...(config.members?.actorsFrom?.includes(clientId)
      ? ["Manages this site's members from another site, saying who for"]
      : []),
    ...(config.users?.managedBy.includes(clientId) ? ["Keeps this site's users up to date"] : []),
    ...(config.groups?.managedBy.includes(clientId) ? ["Keeps this site's groups up to date"] : []),
  ]
}

/** The uses of all an account's client ids. */
export const accountUses = (uses: (clientId: string) => string[], clientIds: readonly string[]) => [
  ...new Set(clientIds.flatMap(uses)),
]

/** How long a replaced secret keeps working. */
export const OLD_SECRET_STOPS = { now: 0, day: 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000 }
export type OldSecretStops = keyof typeof OLD_SECRET_STOPS

export interface ServiceAccountView {
  key: string
  name: string
  enabled: boolean
  groups: Array<{ key: string; name: string }>
  clients: Array<{
    clientId: string
    addedAt: string
    lastUsedAt: string | null
    oldSecretUntil: string | null
    usedFor: string[]
  }>
  lastUsedAt: string | null
  usedFor: string[]
}

type Client = { ipAddress: string | null; forwardedFor: string | null }

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
const refused = (message: string, status = 400) => json({ message }, status)

/** A refusal naming what would stop, unless the caller says they know (`?confirm=true`). */
const inUse = (what: string, uses: readonly string[]) =>
  json(
    {
      message: `${what} would stop what it is used for: ${uses.join('; ')}.`,
      uses,
      confirm: true,
    },
    409,
  )

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'account'

export function createServiceAccountsApi(deps: {
  db: Db
  uses: () => (clientId: string) => string[]
}) {
  const { db } = deps
  const users = new UserRepository(db)
  const groups = new UserGroupRepository(db)

  const view = async (user: UserRecord): Promise<ServiceAccountView> => {
    const uses = deps.uses()
    const clients: ClientCredentialDetail[] = await users.clientCredentialDetails(user.id)
    const names = new Map((await groups.byKeys(user.groupKeys)).map((g) => [g.key, g.name]))
    const last = clients
      .map((c) => c.lastUsedAt?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), user.lastLoginDate?.getTime() ?? 0)
    return {
      key: user.key,
      name: user.name,
      enabled: user.isApproved && !user.isLockedOut,
      groups: user.groupKeys.map((key) => ({ key, name: names.get(key) ?? key })),
      clients: clients.map((c) => ({
        clientId: c.clientId,
        addedAt: c.addedAt.toISOString(),
        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
        oldSecretUntil: c.oldSecretUntil?.toISOString() ?? null,
        usedFor: uses(c.clientId),
      })),
      lastUsedAt: last > 0 ? new Date(last).toISOString() : null,
      usedFor: accountUses(
        uses,
        clients.map((c) => c.clientId),
      ),
    }
  }

  const account = async (key: string) => {
    const user = /^[0-9a-f-]{32,36}$/i.test(key) ? await users.byKey(key) : undefined
    return user?.kind === 'Api' ? user : undefined
  }

  const groupsExist = async (keys: unknown): Promise<string[] | undefined> => {
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) return undefined
    const wanted: string[] = [...new Set((keys as string[]).map((k) => normaliseUuid(k)))]
    return (await groups.byKeys(wanted)).length === wanted.length ? wanted : undefined
  }

  const newSecret = () => randomBytes(32).toString('base64url')

  return {
    async handle(
      request: Request,
      principal: Principal,
      rest: string,
      client: Client,
    ): Promise<Response> {
      if (!principal.isAdmin)
        return refused('Only an administrator can look after service accounts.', 403)
      const url = new URL(request.url)
      const confirmed = url.searchParams.get('confirm') === 'true'
      const parts = rest.split('/').filter(Boolean).map(decodeURIComponent)
      const method = request.method
      const body = async () => (await request.json().catch(() => ({}))) as Record<string, unknown>
      const audit = (action: string, who: { key: string; name: string }, detail?: string) =>
        recordAudit(db, {
          category: 'user',
          action,
          source: 'request',
          userKey: principal.id,
          userName: principal.name,
          entityType: 'User',
          entityKey: who.key,
          entityName: who.name,
          detail: detail ?? null,
          ...client,
        })

      if (parts.length === 0 && method === 'GET') {
        const all = (await users.all()).filter((u) => u.kind === 'Api')
        all.sort((a, b) => a.name.localeCompare(b.name))
        const choices = (await groups.all()).map((g) => ({ key: g.key, name: g.name }))
        return json({ items: await Promise.all(all.map(view)), groups: choices })
      }

      if (parts.length === 0 && method === 'POST') {
        const input = await body()
        const name = typeof input.name === 'string' ? input.name.trim() : ''
        if (!name) return refused('A service account needs a name.')
        const groupKeys = await groupsExist(input.groupKeys ?? [])
        if (!groupKeys) return refused('One of those groups is not there.')
        const key = crypto.randomUUID()
        const created = await users.create({
          key,
          name,
          userName: `service-${slug(name)}-${key.slice(0, 8)}`,
          email: '',
          kind: 'Api',
          groupKeys,
          languageIsoCode: null,
        })
        if (!created) return refused('The service account could not be made.')
        await audit('Create', created, 'A service account')
        return json(await view(created), 201)
      }

      const user = parts[0] ? await account(parts[0]) : undefined
      if (!user) return refused('There is no such service account.', 404)
      const clientIds = (await users.clientCredentials(user.id)) as string[]
      const uses = accountUses(deps.uses(), clientIds)

      if (parts.length === 1 && method === 'GET') {
        const entries = await new AuditLog(db).query({ entityKey: user.key }, { skip: 0, take: 50 })
        return json({
          ...(await view(user)),
          activity: entries.items.map((e) => ({
            at: e.occurredAt.toISOString(),
            action: e.action,
            by: e.userName,
            detail: e.detail,
          })),
        })
      }

      if (parts.length === 1 && method === 'PUT') {
        const input = await body()
        const name = typeof input.name === 'string' ? input.name.trim() : user.name
        if (!name) return refused('A service account needs a name.')
        const groupKeys =
          input.groupKeys === undefined ? user.groupKeys : await groupsExist(input.groupKeys)
        if (!groupKeys) return refused('One of those groups is not there.')
        const result = await users.update(user.key, {
          name,
          userName: user.userName,
          email: user.email,
          languageIsoCode: user.languageIsoCode,
          groupKeys,
        })
        if (result !== 'updated') return refused('The service account could not be changed.')
        await audit('Update', { key: user.key, name })
        return json(await view((await users.byKey(user.key)) as UserRecord))
      }

      if (parts.length === 1 && method === 'DELETE') {
        if (uses.length > 0 && !confirmed) return inUse('Deleting it', uses)
        await users.delete(user.key)
        await audit(
          'Delete',
          user,
          uses.length > 0 ? `Deleted, though used for: ${uses.join('; ')}` : 'Deleted',
        )
        return json({ deleted: user.key })
      }

      if (
        parts.length === 2 &&
        (parts[1] === 'enable' || parts[1] === 'disable') &&
        method === 'POST'
      ) {
        const enable = parts[1] === 'enable'
        if (!enable && uses.length > 0 && !confirmed) return inUse('Disabling it', uses)
        await users.setApproved([user.key], enable)
        if (enable) await users.unlock([user.key])
        await audit(enable ? 'Enable' : 'Disable', user)
        return json(await view((await users.byKey(user.key)) as UserRecord))
      }

      if (parts.length === 2 && parts[1] === 'clients' && method === 'POST') {
        const clientId = `${API_CLIENT_ID_PREFIX}${slug(user.name)}-${randomBytes(4).toString('hex')}`
        const secret = newSecret()
        if (!(await users.addClientCredential(user.id, clientId, await hashPassword(secret))))
          return refused('That client id is taken; try again.', 409)
        await audit('AddClientCredentials', user, `Client id ${clientId} added`)
        return json({ clientId, secret }, 201)
      }

      const clientId = parts[2]
      if (parts[1] === 'clients' && clientId && !clientIds.includes(clientId))
        return refused('This account has no such client id.', 404)

      if (parts.length === 4 && parts[3] === 'secret' && method === 'POST' && clientId) {
        const input = await body()
        const stops = (input.oldStops ?? 'now') as string
        if (!(stops in OLD_SECRET_STOPS))
          return refused('Say when the old secret stops: now, in a day, or in a week.')
        const after = OLD_SECRET_STOPS[stops as OldSecretStops]
        const until = after > 0 ? new Date(Date.now() + after) : undefined
        const secret = newSecret()
        await users.replaceClientSecret(clientId, await hashPassword(secret), until)
        await audit(
          'RotateClientSecret',
          user,
          until
            ? `A new secret for ${clientId}; the old one works until ${until.toISOString()}`
            : `A new secret for ${clientId}; the old one stopped`,
        )
        return json({ clientId, secret, oldSecretUntil: until?.toISOString() ?? null })
      }

      if (parts.length === 3 && method === 'DELETE' && clientId) {
        const clientUses = deps.uses()(clientId)
        if (clientUses.length > 0 && !confirmed) return inUse('Removing it', clientUses)
        await users.removeClientCredential(user.id, clientId)
        await audit('DeleteClientCredentials', user, `Client id ${clientId} removed`)
        return json(await view(user))
      }

      return refused('Not found.', 404)
    },
  }
}

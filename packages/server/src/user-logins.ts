/**
 * Story 404: a user's external logins, linked by the directory that manages the site's
 * users (`users.managedBy`), so a person it made signs in through their provider the
 * first time without the site creating or regrouping anyone. Without the setting, an
 * administrator links them. docs/configuration.md, "Users managed from outside".
 */
import type { Principal } from '@crombolo/api-management/domain'
import { normaliseUuid } from '@crombolo/core'
import {
  type Db,
  ExternalLoginRepository,
  externalLoginProvider,
  UserRepository,
} from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import { MANAGED_OUTSIDE } from './managed-users.ts'

export interface UserLoginsOptions {
  db: Db
  /** The back-office identity providers' ids, as the site's config names them. */
  providers: () => readonly string[]
  /** The API clients that manage users; empty when the site's users are its own. */
  managedBy: () => readonly string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PREFIX = `${externalLoginProvider('user', '')}`

export function createUserLogins(options: UserLoginsOptions) {
  const { db } = options
  const logins = new ExternalLoginRepository(db)
  const refused = (status: number, message: string) => Response.json({ message }, { status })

  /** Whether the principal links logins: the directory's client, or an administrator when there is none. */
  const mayLink = (principal: Principal) => {
    const managedBy = options.managedBy()
    if (managedBy.length === 0) return principal.isAdmin
    return principal.viaClient !== undefined && managedBy.includes(principal.viaClient)
  }

  const linksOf = async (key: string) => ({
    items: (await logins.forOwner(key))
      .filter((l) => l.loginProvider.startsWith(PREFIX))
      .map((l) => ({
        provider: l.loginProvider.slice(PREFIX.length),
        subject: l.providerKey,
        linkedAt: l.createDate.toISOString(),
      })),
  })

  const audit = (
    principal: Principal,
    action: string,
    user: { key: string; name: string },
    detail: string,
  ) =>
    recordAudit(db, {
      category: 'user',
      action,
      source: 'request',
      userKey: principal.id,
      userName: principal.name,
      entityType: 'User',
      entityKey: user.key,
      entityName: user.name,
      detail,
      ipAddress: null,
      forwardedFor: null,
    })

  return {
    /** `rest` is what follows `users/`: `{key}/logins` or `{key}/logins/{provider}`. */
    async handle(request: Request, principal: Principal, rest: string): Promise<Response> {
      const [key, sub, provider, ...more] = rest.split('/').map(decodeURIComponent)
      if (!key || !UUID.test(key) || sub !== 'logins' || more.length > 0)
        return refused(404, 'There is no such route.')
      if (!mayLink(principal))
        return refused(
          403,
          options.managedBy().length > 0
            ? MANAGED_OUTSIDE
            : 'Only an administrator links a person’s sign-in.',
        )
      const user = await new UserRepository(db).byKey(normaliseUuid(key)).catch(() => undefined)
      if (!user) return refused(404, 'There is no such user.')

      if (request.method === 'GET' && provider === undefined)
        return Response.json(await linksOf(user.key))

      if (request.method === 'PUT' && provider === undefined) {
        const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
        const id = typeof body.provider === 'string' ? body.provider.trim() : ''
        const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
        if (!id || !subject) return refused(400, 'Name the provider and the subject.')
        if (!options.providers().includes(id))
          return refused(404, `There is no identity provider "${id}" for the back office here.`)
        const loginProvider = externalLoginProvider('user', id)
        const taken = await logins.find(loginProvider, subject)
        if (taken && normaliseUuid(taken.ownerKey) !== normaliseUuid(user.key))
          return refused(409, 'That sign-in is linked to another user already.')
        await logins.link(user.key, loginProvider, subject)
        await audit(principal, 'Link', user, `Linked a sign-in with ${id}`)
        return Response.json(await linksOf(user.key))
      }

      if (request.method === 'DELETE' && provider !== undefined) {
        const loginProvider = externalLoginProvider('user', provider)
        if (!(await logins.forOwner(user.key)).some((l) => l.loginProvider === loginProvider))
          return refused(404, `There is no sign-in with ${provider} linked to this user.`)
        await logins.unlink(user.key, loginProvider)
        await audit(principal, 'Unlink', user, `Unlinked the sign-in with ${provider}`)
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 405 })
    },
  }
}

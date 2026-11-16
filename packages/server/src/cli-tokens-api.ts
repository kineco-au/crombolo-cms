/**
 * Command-line tokens over HTTP (story 351), at `<plugin>/api/cli-tokens`:
 * GET lists your own, or `?user=<key>` someone's for an administrator; POST
 * `{ name, days }` makes one and answers it once; DELETE `/{key}` revokes your
 * own, or anyone's for an administrator. While tokens are off, GET answers
 * `{ enabled: false }` and the rest are refused. docs/operations.md,
 * "Command-line tokens".
 */
import type { Principal } from '@crombolo/api-management/domain'
import {
  CLI_TOKEN_REFUSALS,
  type CliToken,
  type CliTokenPerson,
  type CliTokenRefusal,
  type CliTokens,
  DEFAULT_CLI_TOKEN_DAYS,
} from '@crombolo/auth'
import type { Db } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'

export interface CliTokenView {
  key: string
  name: string
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
}

export const cliTokenView = (token: CliToken): CliTokenView => ({
  key: token.key,
  name: token.name,
  createdAt: token.createdAt.toISOString(),
  expiresAt: token.expiresAt.toISOString(),
  lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
})

type Person = CliTokenPerson

type Client = { ipAddress: string | null; forwardedFor: string | null }

const json = (body: unknown, status = 200) => Response.json(body, { status })
const refused = (message: string, status = 403) => json({ message }, status)

/** A token's refusal, with its reason, for a client that sent one the site would not take. */
export const tokenRefusal = (reason: CliTokenRefusal): Response =>
  json({ reason, message: CLI_TOKEN_REFUSALS[reason] }, 401)

export function createCliTokensApi(db: Db, tokens: CliTokens) {
  const person = (who: string) => tokens.person(who)
  const ownerOf = (token: CliToken) => tokens.ownerOf(token)

  const audit = (by: Principal, action: string, whose: Person, detail: string, client: Client) =>
    recordAudit(db, {
      category: 'user',
      action,
      source: 'request',
      userKey: by.id,
      userName: by.name,
      entityType: 'User',
      entityKey: whose.key,
      entityName: whose.name,
      detail,
      ...client,
    })

  return {
    async handle(
      request: Request,
      principal: Principal,
      rest: string,
      client: Client,
    ): Promise<Response> {
      const { enabled, maxDays } = tokens.settings
      const me = await person(principal.id)
      if (!me) return new Response('Unauthorized', { status: 401 })
      if (request.method === 'GET' && rest === '') {
        if (!enabled) return json({ enabled: false })
        const asked = new URL(request.url).searchParams.get('user')
        let whose = me
        if (asked) {
          const found = await person(asked)
          if (found?.key !== me.key) {
            if (!principal.isAdmin)
              return refused("Only an administrator can see other people's tokens.")
            if (!found) return refused('There is no such user.', 404)
            whose = found
          }
        }
        return json({
          enabled: true,
          mayCreate: whose.key === me.key && (await tokens.mayCreate(me.id)),
          maxDays,
          defaultDays: Math.min(DEFAULT_CLI_TOKEN_DAYS, maxDays),
          items: (await tokens.list(whose.id)).map(cliTokenView),
        })
      }
      if (!enabled) return refused(CLI_TOKEN_REFUSALS.off)
      if (request.method === 'POST' && rest === '') {
        // Story 364: a sign-in through another service lasts minutes; a token it made would not.
        if (principal.viaExchange)
          return refused(
            'A sign-in through another service cannot make command-line tokens. Make one signed in as yourself.',
            403,
          )
        const body = (await request.json().catch(() => ({}))) as { name?: unknown; days?: unknown }
        const issued = await tokens.issue(
          me.id,
          typeof body.name === 'string' ? body.name : '',
          body.days === undefined || body.days === null ? undefined : Number(body.days),
        )
        if (!issued.ok) return refused(issued.message, issued.refused === 'not-allowed' ? 403 : 400)
        await audit(
          principal,
          'CreateToken',
          me,
          `"${issued.issued.name}", until ${issued.issued.expiresAt.toISOString().slice(0, 10)}`,
          client,
        )
        return json({ ...cliTokenView(issued.issued), token: issued.token }, 201)
      }
      const key = /^\/([0-9a-fA-F-]{36})$/.exec(rest)?.[1]
      if (request.method === 'DELETE' && key) {
        const token = await tokens.byKey(key)
        if (!token || token.revokedAt) return refused('There is no such token.', 404)
        if (token.userId !== me.id && !principal.isAdmin)
          return refused('There is no such token.', 404)
        const owner = token.userId === me.id ? me : await ownerOf(token)
        await tokens.revoke(token.key, me.key)
        await audit(
          principal,
          'RevokeToken',
          owner,
          owner === me ? `"${token.name}"` : `"${token.name}", ${owner.name}'s`,
          client,
        )
        return new Response(null, { status: 204 })
      }
      return new Response('Method Not Allowed', { status: 405 })
    },

    /** The first use of a token, audited under its person, before the request names the token. */
    async firstUse(token: CliToken, client: Client): Promise<void> {
      const owner = await ownerOf(token)
      await recordAudit(db, {
        category: 'user',
        action: 'FirstUseOfToken',
        source: 'request',
        userKey: owner.key,
        userName: owner.name,
        entityType: 'User',
        entityKey: owner.key,
        entityName: owner.name,
        detail: `"${token.name}"`,
        ...client,
      })
    },
  }
}

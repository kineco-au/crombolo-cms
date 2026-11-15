/**
 * Command-line tokens from the command line (story 351): made, listed and
 * revoked in this site's database as the signed-in person, or on a hosted site
 * through its `cli-tokens` endpoints. The commands do not know which.
 */
import type { Principal } from '@crombolo/api-management/domain'
import type { CliToken, CliTokenPerson } from '@crombolo/auth'
import { recordAudit } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { type HostedSite, hostedOrHere } from '../profiles/choose.ts'
import { problemOf, type RemoteClient } from '../remote/client.ts'
import { signedInPerson } from './acting.ts'
import { siteCliTokens, withSiteDatabase } from './local-sign-in.ts'
import { connectSite } from './remote.ts'
import { siteConfig } from './site.ts'

export interface TokenRecord {
  key: string
  name: string
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
}

export interface TokenSource {
  list(user?: string): Promise<TokenRecord[]>
  create(name: string, days?: number): Promise<TokenRecord & { token: string }>
  revoke(name: string, user?: string): Promise<TokenRecord>
}

export const tokenFlags = {
  profile: Flags.string({
    summary: 'the site this profile names, rather than this one; a hosted one as you, signed in',
    helpValue: '<name>',
  }),
  remote: Flags.string({ summary: 'gone: --profile names the site', hidden: true }),
}

export const userFlag = Flags.string({
  summary: "someone else's, by e-mail, login or key: for administrators",
  helpValue: '<user>',
})

export const tokenFields = [
  { name: 'key', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'createdAt', type: 'string' },
  { name: 'expiresAt', type: 'string' },
  { name: 'lastUsedAt', type: 'string', nullable: true },
] as const

const record = (token: CliToken): TokenRecord => ({
  key: token.key,
  name: token.name,
  createdAt: token.createdAt.toISOString(),
  expiresAt: token.expiresAt.toISOString(),
  lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
})

export function openTokens(flags: { profile?: string; remote?: string }): Promise<TokenSource> {
  const site = hostedOrHere(flags)
  return site ? Promise.resolve(hosted(site)) : Promise.resolve(local())
}

const noPerson = () =>
  new CliError('auth', 'Tokens are made as a person, so this needs you signed in to this site.', {
    hint: 'Sign in with `crombolo login` while the site is running.',
  })

function local(): TokenSource {
  const use = async <T>(
    work: (
      tokens: ReturnType<typeof siteCliTokens>,
      me: Principal,
      person: CliTokenPerson,
      audit: (action: string, whose: CliTokenPerson, detail: string) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> => {
    const me = signedInPerson()
    if (!me) throw noPerson()
    const config = await siteConfig()
    return withSiteDatabase(config, async (db) => {
      const tokens = siteCliTokens(config, db)
      if (!tokens.settings.enabled)
        throw new CliError('refused', 'This site does not take command-line tokens.', {
          hint: 'An administrator turns them on with CROMBOLO_CLI_TOKENS=true.',
        })
      const person = await tokens.person(me.id)
      if (!person) throw noPerson()
      const audit = (action: string, whose: CliTokenPerson, detail: string) =>
        recordAudit(db, {
          category: 'user',
          action,
          source: 'cli',
          userKey: me.id,
          userName: me.name,
          entityType: 'User',
          entityKey: whose.key,
          entityName: whose.name,
          detail,
        })
      return work(tokens, me, person, audit)
    })
  }

  const whose = async (
    tokens: ReturnType<typeof siteCliTokens>,
    me: Principal,
    person: CliTokenPerson,
    user: string | undefined,
  ): Promise<CliTokenPerson> => {
    if (user === undefined) return person
    const found = await tokens.person(user)
    if (found?.key === person.key) return person
    if (!me.isAdmin)
      throw new CliError(
        'refused',
        "Only an administrator can see or revoke other people's tokens.",
      )
    if (!found)
      throw new CliError('not_found', `No user "${user}".`, {
        hint: '`crombolo users list` lists them.',
      })
    return found
  }

  return {
    list: (user) =>
      use(async (tokens, me, person) =>
        (await tokens.list((await whose(tokens, me, person, user)).id)).map(record),
      ),
    create: (name, days) =>
      use(async (tokens, _me, person, audit) => {
        const issued = await tokens.issue(person.id, name, days)
        if (!issued.ok)
          throw new CliError(
            issued.refused === 'name' || issued.refused === 'days'
              ? 'usage'
              : issued.refused === 'name-taken'
                ? 'conflict'
                : 'refused',
            issued.message,
          )
        await audit(
          'CreateToken',
          person,
          `"${issued.issued.name}", until ${issued.issued.expiresAt.toISOString().slice(0, 10)}`,
        )
        return { ...record(issued.issued), token: issued.token }
      }),
    revoke: (name, user) =>
      use(async (tokens, me, person, audit) => {
        const owner = await whose(tokens, me, person, user)
        const token = await tokens.byName(owner.id, name)
        if (!token) throw notFound(name, owner === person ? undefined : owner.name)
        await tokens.revoke(token.key, person.key)
        await audit(
          'RevokeToken',
          owner,
          owner === person ? `"${token.name}"` : `"${token.name}", ${owner.name}'s`,
        )
        return record(token)
      }),
  }
}

const notFound = (name: string, whose?: string) =>
  new CliError('not_found', `${whose ? `${whose} has` : 'You have'} no token called "${name}".`, {
    hint: '`crombolo tokens list` lists them.',
  })

function hosted(site: HostedSite): TokenSource {
  let connected: Promise<RemoteClient> | undefined
  const client = () => {
    connected ??= connectSite(site).then((c) => c.client)
    return connected
  }
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const remote = await client()
    const response = await remote.call(`${remote.cliTokensUrl}${path}`, init)
    if (response.status === 204) return undefined as T
    if (!response.ok) {
      const body = (await response
        .clone()
        .json()
        .catch(() => undefined)) as { message?: string } | undefined
      if (body?.message)
        throw new CliError(
          response.status === 404 ? 'not_found' : response.status === 400 ? 'usage' : 'refused',
          body.message,
        )
      throw await problemOf(response)
    }
    return (await response.json()) as T
  }
  type Listing = { enabled: boolean; items?: TokenRecord[] }
  const list = async (user?: string) => {
    const listing = await call<Listing>(user ? `?user=${encodeURIComponent(user)}` : '')
    if (!listing.enabled)
      throw new CliError('refused', `${site.name} does not take command-line tokens.`)
    return listing.items ?? []
  }
  return {
    list,
    create: (name, days) =>
      call(``, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, days }),
      }),
    async revoke(name, user) {
      const token = (await list(user)).find((t) => t.name === name.trim())
      if (!token) throw notFound(name, user)
      await call(`/${token.key}`, { method: 'DELETE' })
      return token
    },
  }
}

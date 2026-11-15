/**
 * Back-office users from the command line (story 151), through the same user
 * port the Management API uses, so a rule the back office keeps — who may act
 * on an admin, what an invite is — is the rule here too. It opens the site's
 * database directly, not through the server, so it works when the site will not
 * boot; in a container it runs through `docker exec`.
 */
import type { Principal, UserGroupPort, UserPort, UserStatus } from '@crombolo/api-management'
import { AuthStore } from '@crombolo/auth'
import { type Db, SUPER_USER_KEY, UserRepository } from '@crombolo/data'
import {
  bootstrapDatabase,
  type CromboloConfig,
  createNodeLookup,
  createUserPorts,
  MediaFileStore,
  mediaStoreFor,
  TwoFactorService,
  type UserAdminError,
  userRefusal,
} from '@crombolo/server'
import { CliError } from '../errors.ts'
import { signedInPerson } from './acting.ts'

/** The operator: an administrator who is nobody in particular, so no rule about acting on oneself applies. */
const CLI_PRINCIPAL_ID = '00000000-0000-4000-8000-0000000c1c1e'

const principal = (id: string): Principal =>
  ({
    id,
    userName: 'crombolo',
    name: 'The command line',
    email: '',
    isAdmin: true,
    languageIsoCode: undefined,
    avatarUrls: [],
    allowedSections: [],
    permissions: [],
    groupKeys: [],
    hasAccessToAllLanguages: true,
    languages: [],
  }) as unknown as Principal

/** Sees every user, the built-in administrator included, as only that administrator may. */
export const OBSERVER = principal(SUPER_USER_KEY)
/** Acts on any user, the built-in administrator included. */
export const OPERATOR = principal(CLI_PRINCIPAL_ID)

/** Whom a `users` command acts as (story 356): the person signed in, or the command line. */
export const actingPrincipal = (): Principal => signedInPerson() ?? OPERATOR

/** Whom a `users` command reads as: the person signed in, or the command line, which sees everyone. */
export const readingPrincipal = (): Principal => signedInPerson() ?? OBSERVER

export interface People {
  config: CromboloConfig
  db: Db
  users: UserPort
  groups: UserGroupPort
  repository: UserRepository
  twoFactor: TwoFactorService
  /** The link the last invite would have e-mailed. */
  lastLink(): string | undefined
}

export async function openPeople(config: CromboloConfig): Promise<People> {
  const { db } = await bootstrapDatabase(config)
  const store = new AuthStore(db)
  let link: string | undefined
  const { users, groups } = createUserPorts(db, {
    config: {
      ...config,
      // Captured, not sent: the command prints it, for a site with no e-mail.
      sendUserLink: async (message) => {
        link = message.link
      },
    },
    mediaFiles: new MediaFileStore(await mediaStoreFor(config)),
    nodes: createNodeLookup(db),
    endSessions: async (userId) => {
      await store.endAllSessionsForUser(userId)
    },
  })
  return {
    config,
    db,
    users,
    groups,
    repository: new UserRepository(db),
    twoFactor: new TwoFactorService(db, { secretKey: config.secretKey, issuer: config.siteName }),
    lastLink: () => link,
  }
}

/** A user by e-mail or username, whatever the casing; `not_found` otherwise. */
export async function userNamed(people: People, who: string) {
  const wanted = who.trim().toLowerCase()
  const row = await people.db.q
    .selectFrom('user_account')
    .select('key')
    .where((eb) =>
      eb.or([
        eb(eb.fn('lower', ['email']), '=', wanted),
        eb(eb.fn('lower', ['login']), '=', wanted),
      ]),
    )
    .executeTakeFirst()
  const key = row?.key
  const user = key ? await people.repository.byKey(String(key)) : undefined
  if (!user)
    throw new CliError('not_found', `No user "${who}".`, {
      hint: '`crombolo users list` lists them.',
    })
  return user
}

/** A user port status other than `Success`, as a failure; `who` names them in a refusal that does. */
export function checkStatus(status: UserStatus, who?: string): void {
  const refusal = userRefusal(status, who)
  if (refusal) throw cliRefusal(refusal)
}

/** A refusal from the user core, as the command line reports one. */
export const cliRefusal = (error: UserAdminError): CliError =>
  new CliError(error.kind, error.message, error.hint ? { hint: error.hint } : undefined)

export function describeUser(user: {
  key: string
  name: string
  email: string
  userName: string
}): string {
  return `${user.name} <${user.email || user.userName}>`
}

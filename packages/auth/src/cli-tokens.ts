/**
 * Command-line tokens (story 351): a person's own long-lived credential for a
 * script or a CI job, acting as them with their permissions as they are now.
 * Only a token's hash is kept; the token itself is shown once, when it is made.
 * docs/operations.md, "Command-line tokens".
 */
import { CliTokenPermissions, normaliseUuid } from '@crombolo/core'
import { type Db, DbDate } from '@crombolo/data'
import { generateToken, hashToken } from './pkce.ts'
import { AuthStore, type UserRow } from './store.ts'

/** What every token starts with, so secret scanners can recognise one. */
export const CLI_TOKEN_PREFIX = 'crombolo_pat_'

export const DEFAULT_CLI_TOKEN_DAYS = 30
export const DEFAULT_CLI_TOKEN_MAX_DAYS = 90
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export const isCliToken = (token: string): boolean => token.startsWith(CLI_TOKEN_PREFIX)

export interface CliTokenSettings {
  /** `cliTokens`: off, no token is issued and every one is refused. */
  enabled: boolean
  /** `cliTokenMaxDays`: the longest a token may last. */
  maxDays: number
}

export interface CliToken {
  key: string
  userId: number
  name: string
  createdAt: Date
  expiresAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
  revokedBy: string | null
}

export interface CliTokenPerson {
  id: number
  key: string
  name: string
}

export type CliTokenRefusal =
  | 'unknown'
  | 'expired'
  | 'revoked'
  | 'disabled'
  | 'locked'
  | 'removed'
  | 'not-allowed'
  | 'off'

/** Why a token was refused, in a sentence each. */
export const CLI_TOKEN_REFUSALS: Readonly<Record<CliTokenRefusal, string>> = {
  unknown: 'This site does not know that token.',
  expired: 'That token has expired.',
  revoked: 'That token has been revoked.',
  disabled: "That token's person has been disabled.",
  locked: "That token's person is locked out.",
  removed: "That token's person has been removed from the site.",
  'not-allowed':
    "That token's person is no longer in a group that gives command-line tokens, so it doesn't work for now.",
  off: 'This site does not take command-line tokens.',
}

export type IssueRefusal = 'off' | 'not-allowed' | 'name' | 'name-taken' | 'days'

export type Issued =
  | { ok: true; token: string; issued: CliToken }
  | { ok: false; refused: IssueRefusal; message: string }

export type ResolvedCliToken =
  | { ok: true; user: UserRow; token: CliToken; firstUse: boolean }
  | { ok: false; reason: CliTokenRefusal; token?: CliToken }

const toToken = (row: {
  key: string
  user_id: number
  name: string
  created_at: unknown
  expires_at: unknown
  last_used_at: unknown
  revoked_at: unknown
  revoked_by: string | null
}): CliToken => ({
  key: normaliseUuid(String(row.key)),
  userId: Number(row.user_id),
  name: String(row.name),
  createdAt: DbDate.fromDb(row.created_at) ?? new Date(0),
  expiresAt: DbDate.fromDb(row.expires_at) ?? new Date(0),
  lastUsedAt: DbDate.fromDb(row.last_used_at) ?? null,
  revokedAt: DbDate.fromDb(row.revoked_at) ?? null,
  revokedBy: row.revoked_by ?? null,
})

const COLUMNS = [
  'key',
  'user_id',
  'name',
  'created_at',
  'expires_at',
  'last_used_at',
  'revoked_at',
  'revoked_by',
] as const

export class CliTokens {
  #db: Db
  #store: AuthStore
  #settings: CliTokenSettings

  constructor(db: Db, settings: CliTokenSettings) {
    this.#db = db
    this.#store = new AuthStore(db)
    this.#settings = settings
  }

  get settings(): CliTokenSettings {
    return this.#settings
  }

  /** A person by key, e-mail or login, for listing or revoking someone's tokens. */
  async person(who: string): Promise<CliTokenPerson | undefined> {
    const wanted = who.trim().toLowerCase()
    const uuid = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/.test(wanted)
    const row = await this.#db.q
      .selectFrom('user_account')
      .select(['id', 'key', 'user_name'])
      .where((eb) =>
        uuid
          ? eb('key', '=', normaliseUuid(wanted))
          : eb.or([
              eb(eb.fn('lower', ['email']), '=', wanted),
              eb(eb.fn('lower', ['login']), '=', wanted),
            ]),
      )
      .executeTakeFirst()
    return (
      row && {
        id: Number(row.id),
        key: normaliseUuid(String(row.key)),
        name: String(row.user_name),
      }
    )
  }

  /** A token's person, or a stand-in once they have been removed. */
  async ownerOf(token: CliToken): Promise<CliTokenPerson> {
    const row = await this.#db.q
      .selectFrom('user_account')
      .select(['id', 'key', 'user_name'])
      .where('id', '=', token.userId)
      .executeTakeFirst()
    return row
      ? { id: Number(row.id), key: normaliseUuid(String(row.key)), name: String(row.user_name) }
      : { id: token.userId, key: '', name: 'a removed user' }
  }

  /** Whether the person's groups give them command-line tokens now. */
  async mayCreate(userId: number): Promise<boolean> {
    const authorization = await this.#store.loadAuthorization(userId)
    return authorization.permissions.includes(CliTokenPermissions.Create)
  }

  /** A new token for the person, returned once: `days` defaults to 30 and is capped by the site. */
  async issue(userId: number, name: string, days?: number, now = new Date()): Promise<Issued> {
    const refuse = (refused: IssueRefusal, message: string): Issued => ({
      ok: false,
      refused,
      message,
    })
    const { enabled, maxDays } = this.#settings
    if (!enabled) return refuse('off', CLI_TOKEN_REFUSALS.off)
    if (!(await this.mayCreate(userId)))
      return refuse(
        'not-allowed',
        "None of your groups gives you command-line tokens, so you can't create one.",
      )
    const trimmed = name.trim()
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
    if (trimmed.length === 0 || trimmed.length > 100 || /[\u0000-\u001f]/.test(trimmed))
      return refuse('name', 'Give the token a name of up to 100 characters.')
    const lasting = days ?? Math.min(DEFAULT_CLI_TOKEN_DAYS, maxDays)
    if (!Number.isInteger(lasting) || lasting < 1 || lasting > maxDays)
      return refuse(
        'days',
        `A token lasts from 1 to ${maxDays} day${maxDays === 1 ? '' : 's'} on this site.`,
      )
    if ((await this.byName(userId, trimmed)) !== undefined)
      return refuse('name-taken', `You already have a token called "${trimmed}".`)
    const token = `${CLI_TOKEN_PREFIX}${generateToken(32)}`
    const issued: CliToken = {
      key: crypto.randomUUID(),
      userId,
      name: trimmed,
      createdAt: now,
      expiresAt: new Date(now.getTime() + lasting * DAY_MS),
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
    }
    await this.#db.q
      .insertInto('cli_token')
      .values({
        key: issued.key,
        user_id: userId,
        name: issued.name,
        token_hash: hashToken(token),
        created_at: DbDate.toDb(issued.createdAt),
        expires_at: DbDate.toDb(issued.expiresAt),
      })
      .execute()
    return { ok: true, token, issued }
  }

  /** A person's tokens not yet revoked, or everyone's, newest first. */
  async list(userId?: number): Promise<CliToken[]> {
    let query = this.#db.q
      .selectFrom('cli_token')
      .select(COLUMNS)
      .where('revoked_at', 'is', null)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
    if (userId !== undefined) query = query.where('user_id', '=', userId)
    return (await query.execute()).map(toToken)
  }

  /** A person's token by its name, among those not revoked. */
  async byName(userId: number, name: string): Promise<CliToken | undefined> {
    const row = await this.#db.q
      .selectFrom('cli_token')
      .select(COLUMNS)
      .where('user_id', '=', userId)
      .where('name', '=', name.trim())
      .where('revoked_at', 'is', null)
      .executeTakeFirst()
    return row && toToken(row)
  }

  async byKey(key: string): Promise<CliToken | undefined> {
    const row = await this.#db.q
      .selectFrom('cli_token')
      .select(COLUMNS)
      .where('key', '=', normaliseUuid(key))
      .executeTakeFirst()
    return row && toToken(row)
  }

  /** Revokes a token, by whom; the token as it was, or undefined when there is none to revoke. */
  async revoke(key: string, byUserKey: string, now = new Date()): Promise<CliToken | undefined> {
    const token = await this.byKey(key)
    if (!token || token.revokedAt) return undefined
    await this.#db.q
      .updateTable('cli_token')
      .set({ revoked_at: DbDate.toDb(now), revoked_by: normaliseUuid(byUserKey) })
      .where('key', '=', token.key)
      .execute()
    return token
  }

  /**
   * The person a token acts as, or why it may not. Its use is noted at most once
   * an hour; `firstUse` says this is the first, for the audit log.
   */
  async resolve(token: string, now = new Date()): Promise<ResolvedCliToken> {
    if (!isCliToken(token)) return { ok: false, reason: 'unknown' }
    if (!this.#settings.enabled) return { ok: false, reason: 'off' }
    const row = await this.#db.q
      .selectFrom('cli_token')
      .select(COLUMNS)
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst()
    if (!row) return { ok: false, reason: 'unknown' }
    const found = toToken(row)
    const refused = (reason: CliTokenRefusal): ResolvedCliToken => ({
      ok: false,
      reason,
      token: found,
    })
    if (found.revokedAt) return refused('revoked')
    if (found.expiresAt.getTime() <= now.getTime()) return refused('expired')
    const user = await this.#store.findUserById(found.userId)
    if (!user) return refused('removed')
    if (!user.isApproved) return refused('disabled')
    if (user.isLockedOut) return refused('locked')
    if (!(await this.mayCreate(user.id))) return refused('not-allowed')
    const firstUse = found.lastUsedAt === null
    if (firstUse || now.getTime() - (found.lastUsedAt?.getTime() ?? 0) >= HOUR_MS)
      await this.#db.q
        .updateTable('cli_token')
        .set({ last_used_at: DbDate.toDb(now) })
        .where('key', '=', found.key)
        .execute()
    return { ok: true, user, token: found, firstUse }
  }
}

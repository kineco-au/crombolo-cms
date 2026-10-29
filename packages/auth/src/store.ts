/**
 * Persistence for identity, sessions, codes and reference tokens.
 *
 * Everything bearer-shaped is stored hashed, so a database read cannot yield a
 * usable credential.
 */
import { type Db, DbDate, fromDbBool, Locks } from '@crombolo/data'
import { DeviceStore } from './device.ts'
import { hashToken } from './pkce.ts'

export interface UserRow {
  id: number
  key: string
  userName: string
  login: string
  email: string
  passwordHash: string | null
  /** The algorithm marker beside the hash; an imported one names Umbraco's. */
  passwordConfig: string | null
  language: string | null
  avatar: string | null
  isLockedOut: boolean
  isApproved: boolean
  failedLoginAttempts: number
  /** Umbraco's `UserKind`: API users sign in with client credentials only. */
  kind: 'Default' | 'Api'
}

export interface AuthorizationCodeInit {
  code: string
  userId: number
  sessionId: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  scope: string
  expiresAt: Date
}

export interface AuthorizationCodeRow extends Omit<AuthorizationCodeInit, 'code'> {
  consumedAt: Date | undefined
}

export type TokenType = 'access' | 'refresh'

export interface TokenInit {
  token: string
  type: TokenType
  userId: number
  sessionId: string
  clientId: string
  scope: string
  expiresAt: Date
  parentId?: number
}

export interface TokenRow {
  id: number
  type: TokenType
  userId: number
  sessionId: string
  clientId: string
  scope: string
  expiresAt: Date
  revokedAt: Date | undefined
}

function mapUser(row: Record<string, unknown>): UserRow {
  return {
    id: Number(row.id),
    key: String(row.key),
    userName: String(row.user_name),
    login: String(row.login),
    email: String(row.email),
    passwordHash: (row.password_hash as string | null) ?? null,
    passwordConfig: (row.password_config as string | null) ?? null,
    language: (row.language as string | null) ?? null,
    avatar: (row.avatar as string | null) ?? null,
    isLockedOut: fromDbBool(row.is_locked_out),
    isApproved: fromDbBool(row.is_approved),
    failedLoginAttempts: Number(row.failed_login_attempts ?? 0),
    kind: Number(row.kind) === 1 ? 'Api' : 'Default',
  }
}

const USER_COLUMNS = [
  'id',
  'key',
  'user_name',
  'login',
  'email',
  'password_hash',
  'password_config',
  'language',
  'avatar',
  'is_locked_out',
  'is_approved',
  'failed_login_attempts',
  'kind',
] as const

export class AuthStore {
  #db: Db
  /** Device sign-ins (story 107), beside the sessions they become. */
  readonly devices: DeviceStore

  constructor(db: Db) {
    this.#db = db
    this.devices = new DeviceStore(db)
  }

  async findUserByLogin(login: string): Promise<UserRow | undefined> {
    // login is a case-insensitive column in both dialects, so no lower() needed.
    const row = await this.#db.q
      .selectFrom('user_account')
      .select(USER_COLUMNS)
      .where('login', '=', login)
      .executeTakeFirst()
    return row ? mapUser(row) : undefined
  }

  async findUserById(id: number): Promise<UserRow | undefined> {
    const row = await this.#db.q
      .selectFrom('user_account')
      .select(USER_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? mapUser(row) : undefined
  }

  /** An API user's client credential: whose it is, and the secret's hash. */
  async findClientCredential(
    clientId: string,
  ): Promise<{ userId: number; secretHash: string } | undefined> {
    const row = await this.#db.q
      .selectFrom('user_client_credential')
      .select(['user_id', 'secret_hash'])
      .where('client_id', '=', clientId)
      .executeTakeFirst()
    return row ? { userId: Number(row.user_id), secretHash: String(row.secret_hash) } : undefined
  }

  async recordLoginSuccess(userId: number, sessionId: string, ipAddress?: string): Promise<void> {
    const now = DbDate.toDb(new Date())
    await this.#db.q
      .updateTable('user_account')
      .set({ failed_login_attempts: 0, last_login_date: now, update_date: now })
      .where('id', '=', userId)
      .execute()
    await this.#db.q
      .insertInto('user_login_session')
      .values({
        session_id: sessionId,
        user_id: userId,
        logged_in_utc: now,
        last_validated_utc: now,
        ip_address: ipAddress ?? null,
      })
      .execute()
  }

  async recordLoginFailure(userId: number): Promise<number> {
    const row = await this.#db.q
      .selectFrom('user_account')
      .select('failed_login_attempts')
      .where('id', '=', userId)
      .executeTakeFirst()
    const attempts = Number(row?.failed_login_attempts ?? 0) + 1
    await this.#db.q
      .updateTable('user_account')
      .set({ failed_login_attempts: attempts, update_date: DbDate.toDb(new Date()) })
      .where('id', '=', userId)
      .execute()
    return attempts
  }

  async lockOut(userId: number): Promise<void> {
    const now = DbDate.toDb(new Date())
    await this.#db.q
      .updateTable('user_account')
      .set({
        is_locked_out: this.#db.dialect.boolValue(true) as boolean | number,
        last_lockout_date: now,
        update_date: now,
      })
      .where('id', '=', userId)
      .execute()
  }

  /**
   * Replaces a user's password. The caller supplies an already-hashed value, so
   * this module never needs to know which algorithm is in use.
   */
  /**
   * Replaces an imported hash with argon2id after a successful sign-in. The
   * password is the same, so the security stamp and change date stand.
   */
  async rehashPassword(
    userId: number,
    passwordHash: string,
    passwordConfig: string,
  ): Promise<void> {
    await this.#db.q
      .updateTable('user_account')
      .set({ password_hash: passwordHash, password_config: passwordConfig })
      .where('id', '=', userId)
      .execute()
  }

  async setPassword(userId: number, passwordHash: string, passwordConfig: string): Promise<void> {
    const now = DbDate.toDb(new Date())
    await this.#db.q
      .updateTable('user_account')
      .set({
        password_hash: passwordHash,
        password_config: passwordConfig,
        security_stamp: crypto.randomUUID(),
        last_password_change_date: now,
        failed_login_attempts: 0,
        update_date: now,
      })
      .where('id', '=', userId)
      .execute()
  }

  /** Ends every session a user holds, so a password change logs them out. */
  async endAllSessionsForUser(userId: number): Promise<number> {
    const sessions = await this.#db.q
      .selectFrom('user_login_session')
      .select('session_id')
      .where('user_id', '=', userId)
      .where('logged_out_utc', 'is', null)
      .execute()
    for (const session of sessions) await this.endSession(String(session.session_id))
    return sessions.length
  }

  /** Clears a lockout without touching the password. */
  async enable(userId: number): Promise<void> {
    await this.#db.q
      .updateTable('user_account')
      .set({
        is_locked_out: this.#db.dialect.boolValue(false) as boolean | number,
        is_approved: this.#db.dialect.boolValue(true) as boolean | number,
        failed_login_attempts: 0,
        update_date: DbDate.toDb(new Date()),
      })
      .where('id', '=', userId)
      .execute()
  }

  async findSession(sessionId: string): Promise<{ userId: number } | undefined> {
    const row = await this.#db.q
      .selectFrom('user_login_session')
      .select('user_id')
      .where('session_id', '=', sessionId)
      .where('logged_out_utc', 'is', null)
      .executeTakeFirst()
    return row ? { userId: Number(row.user_id) } : undefined
  }

  async endSession(sessionId: string): Promise<void> {
    const now = DbDate.toDb(new Date())
    await this.#db.q
      .updateTable('user_login_session')
      .set({ logged_out_utc: now })
      .where('session_id', '=', sessionId)
      .where('logged_out_utc', 'is', null)
      .execute()
    await this.#db.q
      .updateTable('auth_token')
      .set({ revoked_at: now })
      .where('session_id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute()
  }

  async createAuthorizationCode(init: AuthorizationCodeInit): Promise<void> {
    await this.#db.q
      .insertInto('auth_code')
      .values({
        code_hash: hashToken(init.code),
        user_id: init.userId,
        session_id: init.sessionId,
        client_id: init.clientId,
        redirect_uri: init.redirectUri,
        code_challenge: init.codeChallenge,
        code_challenge_method: init.codeChallengeMethod,
        scope: init.scope,
        expires_at: DbDate.toDb(init.expiresAt),
        create_date: DbDate.toDb(new Date()),
      })
      .execute()
  }

  /**
   * Consumes a code atomically under the key-value lock: an authorization code is
   * single-use, and two simultaneous exchanges must not both succeed.
   */
  async consumeAuthorizationCode(code: string): Promise<AuthorizationCodeRow | undefined> {
    return this.#db.locks.withLock(Locks.KeyValues, async () => {
      const hash = hashToken(code)
      const row = await this.#db.q
        .selectFrom('auth_code')
        .select([
          'user_id',
          'session_id',
          'client_id',
          'redirect_uri',
          'code_challenge',
          'code_challenge_method',
          'scope',
          'expires_at',
          'consumed_at',
        ])
        .where('code_hash', '=', hash)
        .executeTakeFirst()
      if (!row) return undefined
      await this.#db.q
        .updateTable('auth_code')
        .set({ consumed_at: DbDate.toDb(new Date()) })
        .where('code_hash', '=', hash)
        .execute()
      return {
        userId: Number(row.user_id),
        sessionId: String(row.session_id),
        clientId: String(row.client_id),
        redirectUri: String(row.redirect_uri),
        codeChallenge: String(row.code_challenge),
        codeChallengeMethod: String(row.code_challenge_method),
        scope: String(row.scope),
        expiresAt: DbDate.fromDb(row.expires_at) ?? new Date(0),
        consumedAt: DbDate.fromDb(row.consumed_at),
      }
    })
  }

  async createToken(init: TokenInit): Promise<number> {
    await this.#db.q
      .insertInto('auth_token')
      .values({
        token_hash: hashToken(init.token),
        token_type: init.type,
        user_id: init.userId,
        session_id: init.sessionId,
        client_id: init.clientId,
        scope: init.scope,
        expires_at: DbDate.toDb(init.expiresAt),
        create_date: DbDate.toDb(new Date()),
        parent_id: init.parentId ?? null,
      })
      .execute()
    const row = await this.#db.q
      .selectFrom('auth_token')
      .select('id')
      .where('token_hash', '=', hashToken(init.token))
      .executeTakeFirst()
    return Number(row?.id ?? 0)
  }

  async findToken(token: string, type: TokenType): Promise<TokenRow | undefined> {
    const row = await this.#db.q
      .selectFrom('auth_token')
      .select([
        'id',
        'token_type',
        'user_id',
        'session_id',
        'client_id',
        'scope',
        'expires_at',
        'revoked_at',
      ])
      .where('token_hash', '=', hashToken(token))
      .where('token_type', '=', type)
      .executeTakeFirst()
    if (!row) return undefined
    return {
      id: Number(row.id),
      type: String(row.token_type) as TokenType,
      userId: Number(row.user_id),
      sessionId: String(row.session_id),
      clientId: String(row.client_id),
      scope: String(row.scope),
      expiresAt: DbDate.fromDb(row.expires_at) ?? new Date(0),
      revokedAt: DbDate.fromDb(row.revoked_at),
    }
  }

  async revokeToken(id: number): Promise<void> {
    await this.#db.q
      .updateTable('auth_token')
      .set({ revoked_at: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .execute()
  }

  /** Removes expired codes and tokens; called by the background job. */
  async pruneExpired(now = new Date()): Promise<void> {
    const cutoff = DbDate.toDb(now)
    await this.#db.q.deleteFrom('auth_code').where('expires_at', '<', cutoff).execute()
    await this.#db.q.deleteFrom('auth_token').where('expires_at', '<', cutoff).execute()
  }

  /** Section aliases and admin membership, unioned across the user's groups. */
  async loadAuthorization(userId: number): Promise<{
    appAliases: string[]
    groupKeys: string[]
    isAdmin: boolean
    hasAccessToAllLanguages: boolean
    permissions: string[]
    granular: Array<{ nodeKey: string; permission: string; context: string }>
  }> {
    const groups = await this.#db.q
      .selectFrom('user_group as g')
      .innerJoin('user_group_member as m', 'm.user_group_id', 'g.id')
      .select(['g.id', 'g.key', 'g.alias', 'g.has_access_to_all_languages'])
      .where('m.user_id', '=', userId)
      .execute()
    const groupKeys = groups.map((g) => String(g.key))
    const isAdmin = groups.some((g) => String(g.alias) === 'admin')
    const hasAccessToAllLanguages = groups.some((g) => fromDbBool(g.has_access_to_all_languages))

    if (groups.length === 0) {
      return {
        appAliases: [],
        groupKeys: [],
        isAdmin: false,
        hasAccessToAllLanguages: false,
        permissions: [],
        granular: [],
      }
    }

    const sections = await this.#db.q
      .selectFrom('user_group_section as s')
      .innerJoin('user_group_member as m', 'm.user_group_id', 's.user_group_id')
      .select('s.app_alias')
      .distinct()
      .where('m.user_id', '=', userId)
      .execute()
    const permissions = await this.#db.q
      .selectFrom('user_group_permission as p')
      .innerJoin('user_group as g', 'g.key', 'p.user_group_key')
      .innerJoin('user_group_member as m', 'm.user_group_id', 'g.id')
      .select('p.permission')
      .distinct()
      .where('m.user_id', '=', userId)
      .execute()
    const granular = await this.#db.q
      .selectFrom('user_group_granular_permission as gp')
      .innerJoin('user_group as g', 'g.key', 'gp.user_group_key')
      .innerJoin('user_group_member as m', 'm.user_group_id', 'g.id')
      .select(['gp.unique_id', 'gp.permission', 'gp.context'])
      .where('m.user_id', '=', userId)
      .where('gp.unique_id', 'is not', null)
      .execute()

    return {
      appAliases: sections.map((s) => String(s.app_alias)),
      groupKeys,
      isAdmin,
      hasAccessToAllLanguages,
      permissions: permissions.map((p) => String(p.permission)),
      granular: granular.map((g) => ({
        nodeKey: String(g.unique_id),
        permission: String(g.permission),
        context: String(g.context),
      })),
    }
  }
}

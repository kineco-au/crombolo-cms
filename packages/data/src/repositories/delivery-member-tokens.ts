/**
 * The Delivery API's member tokens. A token is random and opaque; only its
 * SHA-256 is kept, so the table cannot be replayed from a backup.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export type MemberTokenKind = 'code' | 'access' | 'refresh'

export interface MemberToken {
  kind: MemberTokenKind
  memberKey: string
  clientId: string
  scopes: string[]
  redirectUri: string | null
  codeChallenge: string | null
  expiresAt: Date
  redeemedAt: Date | null
}

/** A new token for a client to hold, and the hash it is stored under. Pure apart from the randomness. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

/** PKCE S256: the verifier's SHA-256, base64url, against the challenge. Pure. */
export const pkceMatches = (verifier: string, challenge: string): boolean =>
  createHash('sha256').update(verifier).digest('base64url') === challenge

export class DeliveryMemberTokenRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  async issue(
    token: Omit<MemberToken, 'redeemedAt' | 'expiresAt'> & { lifetimeMs: number },
  ): Promise<{ token: string; expiresAt: Date }> {
    const { token: value, hash } = newToken()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + token.lifetimeMs)
    await this.#db.q
      .insertInto('delivery_member_token')
      .values({
        hash,
        kind: token.kind,
        member_key: token.memberKey,
        client_id: token.clientId,
        scopes: token.scopes.join(' '),
        redirect_uri: token.redirectUri,
        code_challenge: token.codeChallenge,
        expires_at: DbDate.toDb(expiresAt),
        create_date: DbDate.toDb(now),
      })
      .execute()
    return { token: value, expiresAt }
  }

  /** The token a client presents, whatever its state; the caller judges it. */
  async find(token: string): Promise<MemberToken | undefined> {
    const row = await this.#db.q
      .selectFrom('delivery_member_token')
      .selectAll()
      .where('hash', '=', hashToken(token))
      .executeTakeFirst()
    if (!row) return undefined
    return {
      kind: String(row.kind) as MemberTokenKind,
      memberKey: String(row.member_key),
      clientId: String(row.client_id),
      scopes: String(row.scopes ?? '')
        .split(' ')
        .filter(Boolean),
      redirectUri: (row.redirect_uri as string | null) ?? null,
      codeChallenge: (row.code_challenge as string | null) ?? null,
      expiresAt: DbDate.fromDb(row.expires_at) ?? new Date(0),
      redeemedAt: DbDate.fromDb(row.redeemed_at) ?? null,
    }
  }

  /** Marks a code or refresh token used; false when it already was, so only one redemption wins. */
  async redeem(token: string): Promise<boolean> {
    const rows = await this.#db.q
      .updateTable('delivery_member_token')
      .set({ redeemed_at: DbDate.toDb(new Date()) })
      .where('hash', '=', hashToken(token))
      .where('redeemed_at', 'is', null)
      .returning('hash')
      .execute()
    return rows.length > 0
  }

  async revoke(token: string): Promise<void> {
    await this.#db.q
      .deleteFrom('delivery_member_token')
      .where('hash', '=', hashToken(token))
      .execute()
  }

  /** Every token a member holds, as signing out ends them. */
  async revokeMember(memberKey: string): Promise<void> {
    await this.#db.q
      .deleteFrom('delivery_member_token')
      .where('member_key', '=', memberKey)
      .execute()
  }

  /** Expired tokens, which nothing will accept again. */
  async purgeExpired(): Promise<void> {
    await this.#db.q
      .deleteFrom('delivery_member_token')
      .where('expires_at', '<', DbDate.toDb(new Date()))
      .execute()
  }
}

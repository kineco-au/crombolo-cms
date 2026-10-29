/**
 * The accounts at external identity providers linked to local members and
 * users (story 031). `external_login` is polymorphic on `user_or_member_key`, as
 * Umbraco's is; the login provider says which audience it belongs to, as
 * Umbraco's scheme names do — `UmbracoMembers.{id}` for members, `Umbraco.{id}`
 * for users — so one provider configured for both never mixes them up.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export type ExternalLoginAudience = 'member' | 'user'

/** The login provider a provider id is recorded under, for an audience. */
export function externalLoginProvider(audience: ExternalLoginAudience, providerId: string): string {
  return `${audience === 'member' ? 'UmbracoMembers' : 'Umbraco'}.${providerId}`
}

export interface ExternalLogin {
  /** The member's or user's key. */
  ownerKey: string
  loginProvider: string
  /** The provider's id for the account: its `sub`. */
  providerKey: string
  createDate: Date
}

const toLogin = (row: Record<string, unknown>): ExternalLogin => ({
  ownerKey: normaliseUuid(String(row.user_or_member_key)),
  loginProvider: String(row.login_provider),
  providerKey: String(row.provider_key),
  createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
})

export class ExternalLoginRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** Who an account at a provider is linked to, if anyone. */
  async find(loginProvider: string, providerKey: string): Promise<ExternalLogin | undefined> {
    const row = await this.#db.q
      .selectFrom('external_login')
      .selectAll()
      .where('login_provider', '=', loginProvider)
      .where('provider_key', '=', providerKey)
      .executeTakeFirst()
    return row ? toLogin(row) : undefined
  }

  /** Every provider account linked to a member or user. */
  async forOwner(ownerKey: string): Promise<ExternalLogin[]> {
    const rows = await this.#db.q
      .selectFrom('external_login')
      .selectAll()
      .where('user_or_member_key', '=', normaliseUuid(ownerKey))
      .orderBy('login_provider')
      .execute()
    return rows.map(toLogin)
  }

  /** Links a provider account to a member or user, replacing an earlier link to that provider. */
  async link(ownerKey: string, loginProvider: string, providerKey: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await removeLink(tx, ownerKey, loginProvider)
      await tx.q
        .insertInto('external_login')
        .values({
          user_or_member_key: normaliseUuid(ownerKey),
          login_provider: loginProvider,
          provider_key: providerKey,
          create_date: DbDate.toDb(new Date()),
        })
        .execute()
    })
  }

  async unlink(ownerKey: string, loginProvider: string): Promise<void> {
    await this.#db.transaction((tx) => removeLink(tx, ownerKey, loginProvider))
  }
}

/** A link and the tokens kept for it, which reference it. */
async function removeLink(tx: Db, ownerKey: string, loginProvider: string): Promise<void> {
  const owner = normaliseUuid(ownerKey)
  await tx.q
    .deleteFrom('external_login_token')
    .where('external_login_id', 'in', (eb) =>
      eb
        .selectFrom('external_login')
        .select('id')
        .where('login_provider', '=', loginProvider)
        .where('user_or_member_key', '=', owner),
    )
    .execute()
  await tx.q
    .deleteFrom('external_login')
    .where('login_provider', '=', loginProvider)
    .where('user_or_member_key', '=', owner)
    .execute()
}

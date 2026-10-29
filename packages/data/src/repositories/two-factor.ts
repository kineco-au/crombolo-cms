/**
 * The authenticators and recovery codes of users and members (story 032). The
 * secret arrives here already sealed and leaves still sealed: sealing is the
 * server's, with `CROMBOLO_SECRET_KEY`, so this layer never holds a key.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import { sql } from '../query.ts'

export interface TwoFactorLogin {
  ownerKey: string
  providerName: string
  sealedSecret: string
  lastUsedStep: number | null
}

export class TwoFactorRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** The providers an owner has turned on. */
  async providers(ownerKey: string): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('two_factor_login')
      .select('provider_name')
      .where('owner_key', '=', normaliseUuid(ownerKey))
      .orderBy('provider_name')
      .execute()
    return rows.map((row) => String(row.provider_name))
  }

  /** Which of these owners have any provider on, for list views. */
  async enabledAmong(ownerKeys: readonly string[]): Promise<Set<string>> {
    if (ownerKeys.length === 0) return new Set()
    const keys = ownerKeys.map(normaliseUuid)
    const rows = await this.#db.q
      .selectFrom('two_factor_login')
      .select('owner_key')
      .distinct()
      .where('owner_key', 'in', keys)
      .execute()
    return new Set(rows.map((row) => normaliseUuid(String(row.owner_key))))
  }

  async get(ownerKey: string, providerName: string): Promise<TwoFactorLogin | undefined> {
    const row = await this.#db.q
      .selectFrom('two_factor_login')
      .selectAll()
      .where('owner_key', '=', normaliseUuid(ownerKey))
      .where('provider_name', '=', providerName)
      .executeTakeFirst()
    if (!row) return undefined
    return {
      ownerKey: normaliseUuid(String(row.owner_key)),
      providerName: String(row.provider_name),
      sealedSecret: String(row.secret),
      lastUsedStep:
        row.last_used_step === null || row.last_used_step === undefined
          ? null
          : Number(row.last_used_step),
    }
  }

  /** Turns a provider on, with its recovery codes' hashes; replaces any earlier setup. */
  async enable(
    ownerKey: string,
    providerName: string,
    sealedSecret: string,
    acceptedStep: number,
    recoveryHashes: readonly string[],
  ): Promise<void> {
    const owner = normaliseUuid(ownerKey)
    await this.#db.transaction(async (tx) => {
      await tx.q
        .deleteFrom('two_factor_login')
        .where('owner_key', '=', owner)
        .where('provider_name', '=', providerName)
        .execute()
      await tx.q
        .insertInto('two_factor_login')
        .values({
          owner_key: owner,
          provider_name: providerName,
          secret: sealedSecret,
          last_used_step: acceptedStep,
          create_date: DbDate.toDb(new Date()),
        })
        .execute()
      await tx.q.deleteFrom('two_factor_recovery_code').where('owner_key', '=', owner).execute()
      for (const hash of recoveryHashes)
        await tx.q
          .insertInto('two_factor_recovery_code')
          .values({ owner_key: owner, code_hash: hash })
          .execute()
    })
  }

  /** Records a step a code was accepted for, refusing one at or before the last; true when recorded. */
  async useStep(ownerKey: string, providerName: string, step: number): Promise<boolean> {
    const rows = await this.#db.q
      .updateTable('two_factor_login')
      .set({ last_used_step: step })
      .where('owner_key', '=', normaliseUuid(ownerKey))
      .where('provider_name', '=', providerName)
      .where((eb) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', step)]))
      .returning('owner_key')
      .execute()
    return rows.length > 0
  }

  /** Spends a recovery code by its hash; true when it was there and unused. */
  async useRecoveryCode(ownerKey: string, hash: string): Promise<boolean> {
    const rows = await this.#db.q
      .updateTable('two_factor_recovery_code')
      .set({ used_date: DbDate.toDb(new Date()) })
      .where('owner_key', '=', normaliseUuid(ownerKey))
      .where('code_hash', '=', hash)
      .where('used_date', 'is', null)
      .returning('id')
      .execute()
    return rows.length > 0
  }

  async recoveryCodesLeft(ownerKey: string): Promise<number> {
    const row = await this.#db.q
      .selectFrom('two_factor_recovery_code')
      .select(sql<number>`count(*)`.as('n'))
      .where('owner_key', '=', normaliseUuid(ownerKey))
      .where('used_date', 'is', null)
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  /** Turns a provider off, or every provider when none is named, with the recovery codes once none is left. */
  async disable(ownerKey: string, providerName?: string): Promise<void> {
    const owner = normaliseUuid(ownerKey)
    await this.#db.transaction(async (tx) => {
      await tx.q
        .deleteFrom('two_factor_login')
        .where('owner_key', '=', owner)
        .$if(!!providerName, (q) => q.where('provider_name', '=', providerName ?? ''))
        .execute()
      const left = await tx.q
        .selectFrom('two_factor_login')
        .select(sql<number>`count(*)`.as('n'))
        .where('owner_key', '=', owner)
        .executeTakeFirst()
      if (Number(left?.n ?? 0) === 0)
        await tx.q.deleteFrom('two_factor_recovery_code').where('owner_key', '=', owner).execute()
    })
  }
}

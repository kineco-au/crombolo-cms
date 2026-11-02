/**
 * Trust rules and CI tokens (story 160): which CI identities may act on this
 * site, and the short-lived tokens an accepted identity is given. A token is
 * kept only as its hash, and goes with its rule: a disabled or deleted rule's
 * tokens stop working at once. docs/remote-protocol.md, "Signing in from CI".
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

/** What a rule matches beside the repository: a branch, a tag, or a CI environment. */
export type TrustRefKind = 'branch' | 'tag' | 'environment'

export interface TrustRule {
  key: string
  name: string
  /** The identity token's `iss`, exactly. */
  issuer: string
  /** GitHub's `owner/repo`, GitLab's `group/project`. */
  repository: string
  refKind: TrustRefKind
  refValue: string
  /** Remote permission verbs, and nothing else. */
  permissions: string[]
  disabled: boolean
  createdBy: string | null
  createDate: Date
  updateDate: Date
  lastUsedDate: Date | null
}

export type TrustRuleInput = Pick<
  TrustRule,
  'name' | 'issuer' | 'repository' | 'refKind' | 'refValue' | 'permissions'
>

/** A CI token, as a request presenting it resolves to. */
export interface CiToken {
  rule: TrustRule
  /** The identity token's claims that say where the run was: repository, ref, run. */
  claims: Record<string, string>
  expiresAt: Date
}

const listOf = (value: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

const recordOf = (value: unknown): Record<string, string> => {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    return parsed && typeof parsed === 'object'
      ? Object.fromEntries(
          Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
        )
      : {}
  } catch {
    return {}
  }
}

export const hashCiToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

interface RuleRow {
  key: string
  name: string
  issuer: string
  repository: string
  ref_kind: string
  ref_value: string
  permissions: unknown
  disabled_at: unknown
  created_by: string | null
  create_date: unknown
  update_date: unknown
  last_used_date: unknown
}

const ruleOf = (row: RuleRow): TrustRule => ({
  key: row.key,
  name: row.name,
  issuer: row.issuer,
  repository: row.repository,
  refKind: (['branch', 'tag', 'environment'].includes(row.ref_kind)
    ? row.ref_kind
    : 'branch') as TrustRefKind,
  refValue: row.ref_value,
  permissions: listOf(row.permissions),
  disabled: row.disabled_at !== null && row.disabled_at !== undefined,
  createdBy: row.created_by,
  createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
  updateDate: DbDate.fromDb(row.update_date) ?? new Date(0),
  lastUsedDate: DbDate.fromDb(row.last_used_date) ?? null,
})

export class RemoteTrustRepository {
  constructor(private readonly db: Db) {}

  async all(): Promise<TrustRule[]> {
    const rows = await this.db.q
      .selectFrom('remote_trust_rule')
      .selectAll()
      .orderBy('name')
      .execute()
    return rows.map(ruleOf)
  }

  async byKey(key: string): Promise<TrustRule | undefined> {
    const row = await this.db.q
      .selectFrom('remote_trust_rule')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst()
    return row ? ruleOf(row) : undefined
  }

  /** The live rules for one issuer, which is all a token from it can match. */
  async liveFor(issuer: string): Promise<TrustRule[]> {
    const rows = await this.db.q
      .selectFrom('remote_trust_rule')
      .selectAll()
      .where('issuer', '=', issuer)
      .where('disabled_at', 'is', null)
      .execute()
    return rows.map(ruleOf)
  }

  async create(input: TrustRuleInput, by: string | null): Promise<TrustRule> {
    const key = randomUUID()
    const now = DbDate.toDb(new Date())
    await this.db.q
      .insertInto('remote_trust_rule')
      .values({
        key,
        name: input.name,
        issuer: input.issuer,
        repository: input.repository,
        ref_kind: input.refKind,
        ref_value: input.refValue,
        permissions: JSON.stringify(input.permissions),
        disabled_at: null,
        created_by: by,
        create_date: now,
        update_date: now,
        last_used_date: null,
      })
      .execute()
    return (await this.byKey(key)) as TrustRule
  }

  async update(key: string, input: TrustRuleInput): Promise<TrustRule | undefined> {
    await this.db.q
      .updateTable('remote_trust_rule')
      .set({
        name: input.name,
        issuer: input.issuer,
        repository: input.repository,
        ref_kind: input.refKind,
        ref_value: input.refValue,
        permissions: JSON.stringify(input.permissions),
        update_date: DbDate.toDb(new Date()),
      })
      .where('key', '=', key)
      .execute()
    // What it was trusted for has changed, so what it was given goes.
    await this.revokeTokens(key)
    return this.byKey(key)
  }

  async setDisabled(key: string, disabled: boolean): Promise<TrustRule | undefined> {
    await this.db.q
      .updateTable('remote_trust_rule')
      .set({
        disabled_at: disabled ? DbDate.toDb(new Date()) : null,
        update_date: DbDate.toDb(new Date()),
      })
      .where('key', '=', key)
      .execute()
    if (disabled) await this.revokeTokens(key)
    return this.byKey(key)
  }

  async remove(key: string): Promise<boolean> {
    await this.revokeTokens(key)
    const result = await this.db.q
      .deleteFrom('remote_trust_rule')
      .where('key', '=', key)
      .executeTakeFirst()
    return Number(result.numDeletedRows) > 0
  }

  async revokeTokens(ruleKey: string): Promise<void> {
    await this.db.q.deleteFrom('remote_ci_token').where('rule_key', '=', ruleKey).execute()
  }

  /**
   * A token for an accepted identity token, or undefined when its `jti` was
   * already exchanged: an identity token is good once.
   */
  async issue(
    rule: TrustRule,
    identity: { issuer: string; jti: string; claims: Record<string, string> },
    seconds: number,
  ): Promise<{ token: string; expiresAt: Date } | undefined> {
    const now = new Date()
    // A spent token's row outlives it by its jti only as long as the identity
    // token could still be valid, so old rows are swept as new ones arrive.
    await this.db.q
      .deleteFrom('remote_ci_token')
      .where('expires_at', '<', DbDate.toDb(new Date(now.getTime() - 2 * 60 * 60 * 1000)))
      .execute()
    const seen = await this.db.q
      .selectFrom('remote_ci_token')
      .select('token_hash')
      .where('issuer', '=', identity.issuer)
      .where('jti', '=', identity.jti)
      .executeTakeFirst()
    if (seen) return undefined
    const token = `crci_${randomBytes(32).toString('base64url')}`
    const expiresAt = new Date(now.getTime() + seconds * 1000)
    try {
      await this.db.q
        .insertInto('remote_ci_token')
        .values({
          token_hash: hashCiToken(token),
          rule_key: rule.key,
          issuer: identity.issuer,
          jti: identity.jti,
          claims: JSON.stringify(identity.claims),
          expires_at: DbDate.toDb(expiresAt),
          create_date: DbDate.toDb(now),
        })
        .execute()
    } catch {
      // Two exchanges of one identity token at once: the unique index lets one in.
      return undefined
    }
    await this.db.q
      .updateTable('remote_trust_rule')
      .set({ last_used_date: DbDate.toDb(now) })
      .where('key', '=', rule.key)
      .execute()
    return { token, expiresAt }
  }

  /** What a presented token is, while it is current and its rule live. */
  async resolve(token: string): Promise<CiToken | undefined> {
    if (!token.startsWith('crci_')) return undefined
    const row = await this.db.q
      .selectFrom('remote_ci_token')
      .selectAll()
      .where('token_hash', '=', hashCiToken(token))
      .executeTakeFirst()
    if (!row) return undefined
    const expiresAt = DbDate.fromDb(row.expires_at) ?? new Date(0)
    if (expiresAt.getTime() <= Date.now()) return undefined
    const rule = await this.byKey(row.rule_key)
    if (!rule || rule.disabled) return undefined
    return { rule, claims: recordOf(row.claims), expiresAt }
  }
}

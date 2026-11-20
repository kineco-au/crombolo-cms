/**
 * Links to a workspace's site (story 379): each kept by the SHA-256 of its
 * secret, with who made it, when it lapses, and whether it was withdrawn.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export interface WorkspaceLink {
  id: number
  workspaceId: number
  madeBy: string
  createdAt: Date
  expiresAt: Date
  withdrawnAt: Date | null
}

export class WorkspaceLinkRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  #view(row: Record<string, unknown>): WorkspaceLink {
    return {
      id: Number(row.id),
      workspaceId: Number(row.workspace_id),
      madeBy: normaliseUuid(String(row.made_by)),
      createdAt: DbDate.fromDb(row.created_at) ?? new Date(0),
      expiresAt: DbDate.fromDb(row.expires_at) ?? new Date(0),
      withdrawnAt: DbDate.fromDb(row.withdrawn_at) ?? null,
    }
  }

  async make(link: {
    workspaceId: number
    madeBy: string
    secretHash: string
    expiresAt: Date
  }): Promise<WorkspaceLink> {
    await this.#db.q
      .insertInto('workspace_link')
      .values({
        workspace_id: link.workspaceId,
        secret_hash: link.secretHash,
        made_by: normaliseUuid(link.madeBy),
        created_at: DbDate.toDb(new Date()),
        expires_at: DbDate.toDb(link.expiresAt),
        withdrawn_at: null,
      })
      .execute()
    return (await this.bySecretHash(link.secretHash)) as WorkspaceLink
  }

  async bySecretHash(hash: string): Promise<WorkspaceLink | undefined> {
    const rows = await this.#db.q
      .selectFrom('workspace_link')
      .selectAll()
      .where('secret_hash', '=', hash)
      .execute()
    return rows[0] ? this.#view(rows[0]) : undefined
  }

  async byId(id: number): Promise<WorkspaceLink | undefined> {
    const rows = await this.#db.q
      .selectFrom('workspace_link')
      .selectAll()
      .where('id', '=', id)
      .execute()
    return rows[0] ? this.#view(rows[0]) : undefined
  }

  /** A workspace's links, newest first. */
  async of(workspaceId: number): Promise<WorkspaceLink[]> {
    return (
      await this.#db.q
        .selectFrom('workspace_link')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .orderBy('id', 'desc')
        .execute()
    ).map((row) => this.#view(row))
  }

  async withdraw(workspaceId: number, id: number): Promise<boolean> {
    // Read first: not every driver reports the rows an update changed.
    const link = await this.byId(id)
    if (!link || link.workspaceId !== workspaceId || link.withdrawnAt) return false
    await this.#db.q
      .updateTable('workspace_link')
      .set({ withdrawn_at: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
    return true
  }
}

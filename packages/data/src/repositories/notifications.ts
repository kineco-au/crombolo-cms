/**
 * Which actions on a node a user asked to be notified of (Umbraco's
 * `umbracoUser2NodeNotify`). Delivered by e-mail through the content
 * notification outbox (story 045); kept regardless while a site has no e-mail.
 */
import type { Db } from '../database.ts'

/** The actions Umbraco offers in the notifications dialog, by letter and alias. */
export const NOTIFIABLE_ACTIONS: ReadonlyArray<{ actionId: string; alias: string }> = [
  { actionId: 'Umb.Document.Duplicate', alias: 'copy' },
  { actionId: 'Umb.Document.Delete', alias: 'delete' },
  { actionId: 'Umb.Document.Move', alias: 'move' },
  { actionId: 'Umb.Document.Create', alias: 'create' },
  { actionId: 'Umb.Document.PublicAccess', alias: 'protect' },
  { actionId: 'Umb.Document.Publish', alias: 'publish' },
  { actionId: 'Umb.DocumentRecycleBin.Restore', alias: 'restore' },
  { actionId: 'Umb.Document.Permissions', alias: 'rights' },
  { actionId: 'Umb.Document.Rollback', alias: 'rollback' },
  { actionId: 'Umb.Document.Sort', alias: 'sort' },
  { actionId: 'Umb.Document.Update', alias: 'update' },
]

export class NotificationRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async subscribed(userId: number, nodeId: number): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('user_notification')
      .select('action')
      .where('user_id', '=', userId)
      .where('node_id', '=', nodeId)
      .execute()
    return rows.map((row) => String(row.action))
  }

  /** Replaces the user's subscriptions on a node; unknown action ids are ignored. */
  async set(userId: number, nodeId: number, actionIds: readonly string[]): Promise<void> {
    const known = new Set(NOTIFIABLE_ACTIONS.map((a) => a.actionId))
    await this.#db.transaction(async (tx) => {
      await tx.q
        .deleteFrom('user_notification')
        .where('user_id', '=', userId)
        .where('node_id', '=', nodeId)
        .execute()
      for (const action of new Set(actionIds))
        if (known.has(action))
          await tx.q
            .insertInto('user_notification')
            .values({ user_id: userId, node_id: nodeId, action })
            .execute()
    })
  }

  /**
   * Who asked to hear of an action on any node of a path: a subscription on a
   * page covers the pages under it, as Umbraco's does.
   */
  async subscribersFor(actionId: string, pathNodeIds: readonly number[]): Promise<number[]> {
    if (pathNodeIds.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('user_notification')
      .select('user_id')
      .distinct()
      .where('action', '=', actionId)
      .where('node_id', 'in', pathNodeIds)
      .execute()
    return rows.map((row) => Number(row.user_id))
  }
}

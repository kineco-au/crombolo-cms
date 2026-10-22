/**
 * Content notifications, delivered (story 045): an editor who asked to hear
 * when a page is published — or moved, sorted, rolled back, and the rest of
 * Umbraco's eleven — gets an e-mail when it is.
 *
 * A change is turned into outbox rows when it happens, one per person,
 * resolved against the subscriptions on the page and the pages above it, and
 * never for the person who made it. The rows wait a minute, so a save and a
 * publish arrive as one e-mail, and a background job on the nodes that run
 * jobs sends them; each person's rows are claimed by one node.
 */
import type { RaisedContentChange } from '@crombolo/api-management'
import { hasPathAccess, isValidEmail, ObjectTypes, permissionsForPath } from '@crombolo/core'
import {
  type ContentNotification,
  ContentNotificationRepository,
  type Db,
  DocumentRepository,
  NOTIFIABLE_ACTIONS,
  NodeRepository,
  NotificationRepository,
  UserRepository,
} from '@crombolo/data'
import { createNodeLookup, loadAccess } from './access.ts'
import type { EmailPort } from './email.ts'
import { retryAfter } from './form-workflows.ts'
import { logger } from './logging.ts'

const log = logger('notifications')

/** How long a change waits for others to the same person, so they arrive as one e-mail. */
export const DIGEST_DELAY_MS = 60_000
/** A row a node took and never finished is retried after this long: that node died. */
export const STALE_AFTER_MS = 15 * 60_000

export interface Actor {
  key: string | null
  name: string
}

export interface ContentNotifierOptions {
  /** False when the site cannot send e-mail: nothing is queued, and nothing piles up. */
  canSend: boolean
  delayMs?: number
}

/**
 * What a change's notifications need, read when it commits (story 171): the
 * page as it was, where its subscribers are looked up, and who made the change.
 */
export interface NotificationFacts {
  actions: string[]
  nodeKey: string
  nodeName: string
  /** Node ids, root first: where the page is, or where it was before the recycle bin. */
  path: number[]
  detail: string | null
  actorUserKey: string | null
  actorName: string | null
  occurredAt: string
}

export interface ContentNotifier {
  /** The facts for a change, read on `db` — the change's transaction; undefined when it notifies no one. */
  factsFor(
    db: Db,
    change: RaisedContentChange,
    actor: Actor | null,
    detail?: string,
  ): Promise<NotificationFacts | undefined>
  /** Queues one row per subscriber, once per event however often it is repeated. */
  enqueueFor(db: Db, eventId: string | undefined, facts: NotificationFacts): Promise<void>
  /** Facts and queue at once, outside any outbox: for a change with no event to record. */
  raise(change: RaisedContentChange, actor: Actor | null, detail?: string): Promise<void>
}

/** The node ids of a path, root first, without the root's own -1 or the recycle bin's. */
const pathIds = (path: string): number[] =>
  path
    .split(',')
    .map(Number)
    .filter((id) => Number.isFinite(id) && id > 0)

export function createContentNotifier(db: Db, options: ContentNotifierOptions): ContentNotifier {
  const factsFor: ContentNotifier['factsFor'] = async (on, change, actor, detail) => {
    const nodes = new NodeRepository(on)
    const documents = new DocumentRepository(on)
    const node =
      change.keyKind === 'version'
        ? await documents
            .atVersion(change.key)
            .then((version) => (version ? nodes.byKey(version.document.key) : undefined))
        : await nodes.byKey(change.key)
    if (!node || node.objectType !== ObjectTypes.Document) return undefined
    // A trashed page sits under the recycle bin now; its subscribers are
    // the ones where it was.
    let path = pathIds(node.path)
    if (node.trashed) {
      const parentKey = await documents.originalParent(node.key)
      const parent = parentKey ? await nodes.byKey(parentKey) : undefined
      path = [...(parent ? pathIds(parent.path) : []), node.id]
    }
    let summary = detail ?? null
    if (change.withDescendants) {
      const [row] = await on.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM node WHERE path LIKE ? AND node_object_type = ? AND trashed = ?',
        [`${node.path},%`, ObjectTypes.Document, on.dialect.boolValue(false)],
      )
      const under = Number(row?.n ?? 0)
      if (under > 0) summary = `and ${under} page${under === 1 ? '' : 's'} under it`
    }
    return {
      actions: [...change.actions],
      nodeKey: node.key,
      nodeName: node.text ?? node.key,
      path,
      detail: summary,
      actorUserKey: actor?.key ?? null,
      actorName: actor?.name ?? null,
      occurredAt: new Date().toISOString(),
    }
  }

  const enqueueFor: ContentNotifier['enqueueFor'] = async (on, eventId, facts) => {
    // A site that cannot send e-mail queues nothing, so nothing piles up.
    if (!options.canSend) return
    const subscriptions = new NotificationRepository(on)
    const actorId = facts.actorUserKey
      ? (await new UserRepository(on).byKey(facts.actorUserKey))?.id
      : undefined
    const occurredAt = new Date(facts.occurredAt)
    const runAfter = new Date(Date.now() + (options.delayMs ?? DIGEST_DELAY_MS))
    const rows = []
    for (const actionId of facts.actions) {
      const userIds = (await subscriptions.subscribersFor(actionId, facts.path)).filter(
        (id) => id !== actorId,
      )
      if (userIds.length === 0) continue
      const keys = await on.query<{ key: string }>(
        `SELECT key FROM user_account WHERE id IN (${userIds.map(() => '?').join(', ')})`,
        userIds,
      )
      for (const { key } of keys)
        rows.push({
          recipientUserKey: String(key),
          actionId,
          nodeKey: facts.nodeKey,
          nodeName: facts.nodeName,
          actorUserKey: facts.actorUserKey,
          actorName: facts.actorName,
          detail: facts.detail,
          occurredAt,
          runAfter,
          eventId,
        })
    }
    await new ContentNotificationRepository(on).enqueue(rows)
  }

  return {
    factsFor,
    enqueueFor,
    async raise(change, actor, detail) {
      if (!options.canSend) return
      try {
        const facts = await factsFor(db, change, actor, detail)
        if (facts) await enqueueFor(db, undefined, facts)
      } catch (error) {
        log.error('A content notification could not be queued: {error}', { error: String(error) })
      }
    },
  }
}

const VERBS: Record<string, string> = {
  'Umb.Document.Duplicate': 'copied',
  'Umb.Document.Delete': 'moved to the recycle bin',
  'Umb.Document.Move': 'moved',
  'Umb.Document.Create': 'created',
  'Umb.Document.PublicAccess': 'changed who can see',
  'Umb.Document.Publish': 'published',
  'Umb.DocumentRecycleBin.Restore': 'restored',
  'Umb.Document.Permissions': 'changed the permissions on',
  'Umb.Document.Rollback': 'rolled back',
  'Umb.Document.Sort': 'sorted the pages under',
  'Umb.Document.Update': 'saved',
}

/** What the subscriber asked to hear of, as a reader would say it: "published". */
export const verbFor = (actionId: string): string => VERBS[actionId] ?? 'changed'

export interface NotificationEmailContext {
  siteName: string
  /** The page's address in the back office; undefined when the site's address is not known. */
  editUrl: (nodeKey: string) => string | undefined
  /** The recipient's language. Only English so far; the others fall back to it. */
  language?: string | null
}

const when = (date: Date) =>
  date.toLocaleString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** One plain-text e-mail for everything due to one person, oldest first. */
export function notificationEmail(
  recipient: { name: string },
  items: readonly ContentNotification[],
  context: NotificationEmailContext,
): { subject: string; text: string } {
  const who = (item: ContentNotification) => item.actorName ?? 'Someone'
  const first = items[0] as ContentNotification
  const subject =
    items.length === 1
      ? `[${context.siteName}] ${who(first)} ${verbFor(first.actionId)} "${first.nodeName}"`
      : `[${context.siteName}] ${items.length} changes to pages you follow`
  const lines = items.map((item) => {
    const link = context.editUrl(item.nodeKey)
    return [
      `${who(item)} ${verbFor(item.actionId)} "${item.nodeName}"${item.detail ? ` (${item.detail})` : ''}, ${when(item.occurredAt)} UTC.`,
      ...(link ? [`  ${link}`] : []),
    ].join('\n')
  })
  const verbs = [...new Set(items.map((item) => verbFor(item.actionId)))]
  const text = [
    `Hello ${recipient.name},`,
    '',
    ...lines,
    '',
    `You get this because you asked to hear when pages here are ${verbs.join(', ')}. To change that, open the page's Notifications in the back office.`,
  ].join('\n')
  return { subject, text }
}

export interface ContentNotificationRunReport {
  claimed: number
  sent: number
  skipped: number
  retrying: number
  failed: number
}

export interface ContentNotificationRunner {
  runDue(now?: Date, limit?: number): Promise<ContentNotificationRunReport>
  prune(before: Date): Promise<number>
}

export function createContentNotificationRunner(deps: {
  db: Db
  email: EmailPort | undefined
  siteName: string
  editUrl: (nodeKey: string) => string | undefined
}): ContentNotificationRunner {
  const { db } = deps
  const outbox = new ContentNotificationRepository(db)
  const users = new UserRepository(db)
  const lookup = createNodeLookup(db)

  /** Whether the person may still read the page: a change made since may have taken it away. */
  const mayRead = async (userId: number, item: ContentNotification) => {
    const found = (await lookup.documents([item.nodeKey])).get(item.nodeKey)
    if (!found) return false
    const access = await loadAccess(db, userId)
    // Moved to the recycle bin is about where the page was, so the bin does not count against it.
    const trashed = found.trashed && item.actionId !== 'Umb.Document.Delete'
    return (
      hasPathAccess(access.startNodes.document, found.chain, trashed) &&
      permissionsForPath(access.groups, found.chain).has('Umb.Document.Read')
    )
  }

  return {
    async runDue(now = new Date(), limit = 25) {
      const report: ContentNotificationRunReport = {
        claimed: 0,
        sent: 0,
        skipped: 0,
        retrying: 0,
        failed: 0,
      }
      await outbox.releaseStale(new Date(now.getTime() - STALE_AFTER_MS))
      for (const recipientKey of await outbox.dueRecipients(now, limit)) {
        const items = await outbox.claimFor(recipientKey, now)
        if (items.length === 0) continue
        report.claimed += items.length
        const skip = async (rows: readonly ContentNotification[], reason: string) => {
          await outbox.skip(
            rows.map((row) => row.id),
            reason,
          )
          report.skipped += rows.length
        }
        const user = await users.byKey(recipientKey)
        if (!user) {
          await skip(items, 'The user no longer exists.')
          continue
        }
        if (!user.isApproved) {
          await skip(items, 'The user is disabled.')
          continue
        }
        if (!isValidEmail(user.email)) {
          await skip(items, 'The user has no e-mail address.')
          continue
        }
        const allowed: ContentNotification[] = []
        for (const item of items) {
          if (await mayRead(user.id, item)) allowed.push(item)
          else await skip([item], 'The user can no longer see the page.')
        }
        if (allowed.length === 0) continue
        const ids = allowed.map((item) => item.id)
        if (!deps.email) {
          await outbox.fail(ids, 'This site has no e-mail provider.')
          report.failed += ids.length
          continue
        }
        const message = notificationEmail(user, allowed, {
          siteName: deps.siteName,
          editUrl: deps.editUrl,
          language: user.languageIsoCode,
        })
        const result = await deps.email.send({
          to: [{ email: user.email, name: user.name }],
          subject: message.subject,
          text: message.text,
        })
        if (result.ok) {
          await outbox.succeed(ids)
          report.sent += ids.length
          continue
        }
        const attempts = Math.max(...allowed.map((item) => item.attempts))
        const retryAt = retryAfter(attempts, now)
        await outbox.fail(ids, result.error, retryAt)
        if (retryAt) report.retrying += ids.length
        else report.failed += ids.length
        log.warning('A content notification to {email} was not sent: {error}', {
          email: user.email,
          error: result.error,
        })
      }
      return report
    },
    prune: (before) => outbox.prune(before),
  }
}

/** Every action a person can subscribe to, so a caller can say which one a change was. */
export const NOTIFICATION_ACTION_IDS: readonly string[] = NOTIFIABLE_ACTIONS.map((a) => a.actionId)

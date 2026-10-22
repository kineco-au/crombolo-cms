/**
 * Story 171: a committed change keeps what it announces through a crash. The
 * event is recorded in the change's transaction and dispatched after it; the
 * queues' unique keys let a dispatch repeat without queueing anything twice.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { createDocumentOperations, systemActor } from '@crombolo/content'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import {
  appendCacheInstruction,
  ContentEventRepository,
  DbDate,
  latestCacheInstructionId,
  pruneCacheInstructions,
  queueCounts,
  WebhookDeliveryRepository,
} from '@crombolo/data'
import {
  BACKLOG_AFTER_MS,
  createContentDispatcher,
  createContentEventSink,
  createWebhookService,
  outgoingResults,
} from '@crombolo/server'
import { createPage, type TreeSite, treeOps, treeSite } from './support/content-tree.ts'
import { V1 } from './support/harness.ts'

const KEY = 'k'.repeat(40)
const sites: TreeSite[] = []
afterEach(async () => {
  while (sites.length > 0) await sites.pop()?.h.db.close()
})

/** A site with one webhook that hears publishes and unpublishes. */
async function site() {
  const s = await treeSite({ config: { secretKey: KEY } })
  sites.push(s)
  const created = await s.h.post(`${V1}/webhook`, {
    enabled: true,
    contentTypeKeys: [],
    headers: {},
    events: ['Umbraco.ContentPublish', 'Umbraco.ContentUnpublish', 'Umbraco.MediaSave'],
    url: 'http://127.0.0.1:9/hook',
  })
  expect(created.status).toBe(201)
  const db = s.h.server.db
  const webhooks = createWebhookService({
    db,
    schemaDir: s.h.server.config.schemaDir,
    filesWritable: true,
    secretKey: KEY,
  })
  return { s, db, webhooks }
}

const deliveries = async (s: TreeSite) => new WebhookDeliveryRepository(s.h.server.db).all()
const events = async (s: TreeSite) => new ContentEventRepository(s.h.server.db).all()

describe('a change and what it announces commit together', () => {
  test('a publish records its event with it, and the dispatcher queues the delivery', async () => {
    const { s } = await site()
    const page = await createPage(s, 'Home')
    expect((await treeOps(s).publish(page)).status).toBe(200)
    const recorded = (await events(s)).filter((event) => event.kind === 'published')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.facts).toMatchObject({
      v: 1,
      webhook: { alias: 'Umbraco.ContentPublish', key: page },
    })
    await s.h.server.jobs.runEvents()
    const queued = await deliveries(s)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.eventId).toBe(recorded[0]?.id as string)
    expect(
      (await new ContentEventRepository(s.h.server.db).byId(recorded[0]?.id as string))?.state,
    ).toBe('dispatched')
  })

  test('a change that rolls back leaves neither the change nor its event', async () => {
    const { s, db } = await site()
    const page = await createPage(s, 'Home')
    const before = (await events(s)).length
    const failing = createDocumentOperations({
      db,
      repository: { nodeState: s.h.server.schema.nodeState },
      events: {
        async record(tx, event, actor) {
          await createContentEventSink({}).record(tx, event, actor)
          throw new Error('the database went away')
        },
      },
    })
    await expect(failing.publish(systemActor('test'), page, { cultures: null })).rejects.toThrow(
      'the database went away',
    )
    const published = await s.h.json<{ variants: Array<{ state: string }> }>(
      `${V1}/document/${page}`,
    )
    expect(published.variants[0]?.state).not.toBe('Published')
    expect((await events(s)).length).toBe(before)
  })

  test('the facts are those at commit: a publish undone before dispatch still goes out', async () => {
    const { s } = await site()
    const page = await createPage(s, 'Home')
    await treeOps(s).publish(page)
    await s.h.put(`${V1}/document/${page}/unpublish`, { cultures: null })
    await s.h.server.jobs.runEvents()
    expect((await deliveries(s)).map((d) => d.eventAlias).sort()).toEqual([
      'Umbraco.ContentPublish',
      'Umbraco.ContentUnpublish',
    ])
  })

  test('saving media records its webhook event in the same way', async () => {
    const { s } = await site()
    const created = await s.h.post(`${V1}/media`, {
      mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Pictures' }],
    })
    expect(created.status).toBe(201)
    expect((await events(s)).some((event) => event.kind === 'mediaSaved')).toBe(true)
  })
})

describe('dispatching', () => {
  test('a crash after queueing but before marking repeats without a second delivery', async () => {
    const { s, db, webhooks } = await site()
    const page = await createPage(s, 'Home')
    await treeOps(s).publish(page)
    const [event] = (await events(s)).filter((e) => e.kind === 'published')
    // What a dispatcher that died before marking the event had already done.
    await webhooks.enqueueFor(db, event?.id, event?.facts.webhook as never)
    expect(await deliveries(s)).toHaveLength(1)
    await s.h.server.jobs.runEvents()
    expect(await deliveries(s)).toHaveLength(1)
  })

  test('two dispatchers at once queue each delivery once', async () => {
    const { s, db, webhooks } = await site()
    for (const name of ['A', 'B', 'C']) {
      const page = await createPage(s, name)
      await treeOps(s).publish(page)
    }
    const a = createContentDispatcher({ db, webhooks })
    const b = createContentDispatcher({ db, webhooks })
    await s.h.server.jobs.runEvents().catch(() => undefined)
    // Put them back as though nobody had dispatched yet, then race.
    await db.exec("UPDATE content_event SET state = 'pending'")
    const [ra, rb] = await Promise.all([a.runDue(), b.runDue()])
    // Each event once between them: creating a page records one too, for its notification.
    expect(ra.claimed + rb.claimed).toBe((await events(s)).length)
    expect(await deliveries(s)).toHaveLength(3)
  })

  test('an event that keeps failing is kept as failed, and can be sent again', async () => {
    const { s, db } = await site()
    const page = await createPage(s, 'Home')
    await treeOps(s).publish(page)
    await s.h.server.jobs.runEvents()
    await db.exec("UPDATE content_event SET state = 'pending', attempts = 0")
    const broken = createContentDispatcher({
      db,
      webhooks: {
        enqueueFor: async () => {
          throw new Error('the queue is full')
        },
      },
    })
    let at = new Date()
    for (let attempt = 0; attempt < 5; attempt++) {
      await broken.runDue(at)
      at = new Date(at.getTime() + 2 * 3600_000)
    }
    const repo = new ContentEventRepository(db)
    const all = (await events(s)).length
    const [failed] = await repo.failed()
    expect(failed?.lastError).toBe('the queue is full')
    expect((await queueCounts(db, 'content_event')).failed).toBe(all)
    expect(await repo.retry()).toBe(all)
    expect((await queueCounts(db, 'content_event')).failed).toBe(0)
  })

  test('an event a node took and never finished is taken again after a while', async () => {
    const { s, db } = await site()
    const page = await createPage(s, 'Home')
    await treeOps(s).publish(page)
    await s.h.server.jobs.runEvents()
    const old = DbDate.toDb(new Date(Date.now() - 60 * 60_000))
    await db.exec("UPDATE content_event SET state = 'running', update_date = ?", [old])
    await db.exec("UPDATE webhook_delivery SET state = 'running', update_date = ?", [old])
    await s.h.server.jobs.runQueueUpkeep()
    expect((await queueCounts(db, 'webhook_delivery')).running).toBe(0)
    const report = await s.h.server.jobs.runEvents()
    expect(report.claimed).toBeGreaterThan(0)
  })
})

describe('keeping the queues tidy and visible', () => {
  test('old delivered work is pruned; failed work is kept', async () => {
    const { s, db } = await site()
    const page = await createPage(s, 'Home')
    await treeOps(s).publish(page)
    await s.h.server.jobs.runEvents()
    const longAgo = DbDate.toDb(new Date(Date.now() - 90 * 86_400_000))
    await db.exec("UPDATE webhook_delivery SET state = 'done', update_date = ?", [longAgo])
    await db.exec('UPDATE content_event SET update_date = ?', [longAgo])
    await new WebhookDeliveryRepository(db).enqueue([
      { subscriber: 'gone', eventAlias: 'Umbraco.ContentPublish', payload: {} },
    ])
    await db.exec(
      "UPDATE webhook_delivery SET state = 'failed', update_date = ? WHERE subscriber = 'gone'",
      [longAgo],
    )
    await s.h.server.jobs.runQueueUpkeep()
    expect((await deliveries(s)).map((d) => d.subscriber)).toEqual(['gone'])
    expect((await events(s)).filter((e) => e.state === 'dispatched')).toEqual([])
  })

  test('old cache instructions go, but the newest stays for a starting node to begin from', async () => {
    const { db } = await site()
    await appendCacheInstruction(db, { kind: 'content', payload: { key: 'a' } })
    await appendCacheInstruction(db, { kind: 'content', payload: { key: 'b' } })
    const newest = await latestCacheInstructionId(db)
    await pruneCacheInstructions(db, new Date(Date.now() + 60_000))
    expect(await latestCacheInstructionId(db)).toBe(newest)
    const [row] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM cache_instruction')
    expect(Number(row?.n)).toBe(1)
  })

  test('the health check names failures and a backlog, and is quiet otherwise', () => {
    const quiet = { pending: 0, running: 0, failed: 0, oldestPending: null }
    const at = new Date()
    expect(outgoingResults({ changes: quiet, webhooks: quiet, notifications: quiet }, at)).toEqual([
      { resultType: 'Success', message: 'Changes are going out as they happen.' },
    ])
    const results = outgoingResults(
      {
        changes: quiet,
        webhooks: { ...quiet, failed: 2 },
        notifications: {
          ...quiet,
          pending: 4,
          oldestPending: new Date(at.getTime() - BACKLOG_AFTER_MS - 1000),
        },
      },
      at,
    )
    expect(results.map((r) => r.resultType)).toEqual(['Warning', 'Warning'])
    expect(results[0]?.message).toContain('crombolo events retry --all')
    expect(results[1]?.message).toContain('4 change e-mail(s) waiting')
  })
})

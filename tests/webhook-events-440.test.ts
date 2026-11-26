/**
 * Story 440: every event named `Crombolo.` and its word, an old name refused wherever it is
 * written and renamed where it is stored; media and Library items raise what pages do; a bin
 * emptied says so once, every key in it, 1,000 to a delivery; a Library item's change names
 * the published pages that show it in Crombolo's payload.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eventNameProblem, RENAMED_EVENTS } from '@crombolo/api-management/domain'
import { elementWebhookFor, webhookFor } from '@crombolo/content'
import { webhookEventNamesMigration } from '@crombolo/data'
import {
  bundleEventProblems,
  extensionEventNameProblems,
  KEYS_PER_DELIVERY,
  siteEventProblems,
  webhookPayload,
  webhookProblems,
} from '@crombolo/server'
import { createPage, type TreeSite, treeOps, treeSite } from './support/content-tree.ts'
import { dialectUnderTest } from './support/db.ts'
import { V1 } from './support/harness.ts'

const KEY = 'a-secret-key-that-is-long-enough-to-use-0123'
const sites: TreeSite[] = []
const listeners: Array<{ stop(force?: boolean): void }> = []
const dirs: string[] = []
afterEach(async () => {
  while (sites.length > 0) await sites.pop()?.close()
  while (listeners.length > 0) listeners.pop()?.stop(true)
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function receiver() {
  const received: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({
        headers: Object.fromEntries(request.headers),
        body: (await request.json()) as Record<string, unknown>,
      })
      return new Response('thanks')
    },
  })
  listeners.push(server)
  return { url: `${server.url}hook`, received }
}

async function site() {
  const s = await treeSite({
    config: {
      secretKey: KEY,
      webhooks: { headerVariables: [] },
      allowPrivateAddresses: true,
    },
  })
  sites.push(s)
  return s
}

const hook = async (s: TreeSite, url: string, events: string[]) => {
  const made = await s.h.post(`${V1}/webhook`, {
    enabled: true,
    contentTypeKeys: [],
    headers: {},
    url,
    events,
  })
  expect(made.status, await made.clone().text()).toBe(201)
}

const deliver = async (s: TreeSite) => {
  await Bun.sleep(20)
  await s.h.server.jobs.runWebhooks()
}

describe('an event’s name', () => {
  test('is Crombolo.’s word; an old one is refused naming the new, wherever it is written', () => {
    expect(eventNameProblem('Crombolo.ContentPublish')).toBeUndefined()
    expect(eventNameProblem('Umbraco.ContentPublish')).toBe(
      '"Umbraco.ContentPublish" is now "Crombolo.ContentPublish": every event is named "Crombolo." and its word.',
    )
    expect(eventNameProblem('mediaMoved')).toContain('"Crombolo.MediaMoved"')
    expect(RENAMED_EVENTS['Umbraco.ElementSaved']).toBe('Crombolo.ElementSaved')
    const webhook = {
      key: '5d3c1a2b-0044-4c1a-9e7d-3a5b8c2d4e44',
      name: 'Old',
      description: null,
      url: 'https://example.test/hook',
      enabled: true,
      events: ['Umbraco.MediaSave'],
      contentTypeKeys: [],
      headers: {},
    }
    expect(webhookProblems(webhook, 'files')).toEqual([
      '"Umbraco.MediaSave" is now "Crombolo.MediaSave": every event is named "Crombolo." and its word.',
    ])
    expect(siteEventProblems({ 'Umbraco.ContentSaved': () => {} })[0]).toContain(
      '"Crombolo.ContentSaved"',
    )
    expect(
      bundleEventProblems([
        { id: 'acme', events: { 'Umbraco.ContentDelete': () => ({ ok: true }) as never } },
      ])[0],
    ).toContain('"Crombolo.ContentDelete"')

    // An extension's own code is read for them before it runs.
    const dir = mkdtempSync(join(process.cwd(), 'output', 'old-events-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'src', 'server.ts'),
      "export const events = { 'Umbraco.ContentPublish': () => {} }\n",
    )
    expect(extensionEventNameProblems(dir)).toEqual([
      'src/server.ts names the event "Umbraco.ContentPublish", which is now "Crombolo.ContentPublish": every event is named "Crombolo." and its word.',
    ])
  })

  test(`a stored webhook’s are renamed by migration 104 (${dialectUnderTest})`, async () => {
    const s = await site()
    const db = s.h.server.db
    const made = await s.h.post(`${V1}/webhook`, {
      enabled: true,
      contentTypeKeys: [],
      headers: {},
      url: 'https://example.test/hook',
      events: ['Crombolo.ContentPublish'],
    })
    const key = made.headers.get('umb-generated-resource') as string
    await db.q
      .updateTable('webhook')
      .set({
        events: JSON.stringify([
          'Umbraco.ContentPublish',
          'mediaMoved',
          'Crombolo.ChangePublished',
        ]),
      })
      .execute()
    // As before the migration: its column not there yet.
    await db.exec('ALTER TABLE webhook DROP COLUMN workflows')
    await webhookEventNamesMigration.up(db)
    const row = await db.q
      .selectFrom('webhook')
      .select('events')
      .where('key', '=', key)
      .executeTakeFirst()
    expect(JSON.parse(String(row?.events))).toEqual([
      'Crombolo.ContentPublish',
      'Crombolo.MediaMoved',
      'Crombolo.ChangePublished',
    ])
  })
})

describe(`what is raised (${dialectUnderTest})`, () => {
  test('a page bin emptied says so once, every key in it, and no delete for each', async () => {
    const remote = receiver()
    const s = await site()
    await hook(s, remote.url, ['Crombolo.ContentEmptiedRecycleBin', 'Crombolo.ContentDelete'])
    const parent = await createPage(s, 'Old news')
    const child = await createPage(s, 'Older news', parent)
    const other = await createPage(s, 'Gone')
    for (const key of [parent, other]) expect((await treeOps(s).trash(key)).status).toBe(200)
    expect((await s.h.del(`${V1}/recycle-bin/document`)).status).toBe(200)
    await deliver(s)
    expect(remote.received.map((r) => r.headers['webhook-event'])).toEqual([
      'Crombolo.ContentEmptiedRecycleBin',
    ])
    expect([...((remote.received[0]?.body.Keys as string[] | undefined) ?? [])].sort()).toEqual(
      [parent, child, other].sort(),
    )
  })

  test('the rest of what pages raise, for events: renamed, and a bin of keys in parts', () => {
    expect(webhookFor({ type: 'deleted', key: 'k', name: null, fromBin: true })).toBeUndefined()
    expect(webhookFor({ type: 'deleted', key: 'k', name: null })?.alias).toBe(
      'Crombolo.ContentDelete',
    )
    expect(webhookFor({ type: 'binEmptied', keys: [] })).toBeUndefined()
    const keys = Array.from({ length: KEYS_PER_DELIVERY + 1 }, (_, i) => `k${i}`)
    expect(
      webhookPayload({ alias: 'Crombolo.ContentEmptiedRecycleBin', key: '', keys }, undefined),
    ).toEqual({
      Keys: keys,
    })
  })

  test('a Library item raises what a page does, its published pages named in Crombolo’s payload', async () => {
    expect(elementWebhookFor({ type: 'saved', key: 'k' })?.alias).toBe('Crombolo.ElementSaved')
    expect(elementWebhookFor({ type: 'restored', key: 'k' })?.alias).toBe('Crombolo.ElementMoved')
    expect(elementWebhookFor({ type: 'deleted', key: 'k' })?.alias).toBe('Crombolo.ElementDelete')
    expect(elementWebhookFor({ type: 'rolledBack', key: 'k' })?.alias).toBe(
      'Crombolo.ElementRolledBack',
    )
    expect(elementWebhookFor({ type: 'binEmptied', keys: ['a'] })).toEqual({
      alias: 'Crombolo.ElementEmptiedRecycleBin',
      key: '',
      keys: ['a'],
    })
    expect(elementWebhookFor({ type: 'folderCreated', key: 'f' })).toBeUndefined()
    expect(
      webhookPayload(
        { alias: 'Crombolo.ElementSaved', key: 'e', usedBy: ['p1', 'p2'], usedByMore: 3 },
        'crombolo',
      ),
    ).toMatchObject({ Id: 'e', UsedBy: ['p1', 'p2'], UsedByMore: 3 })
    expect(
      webhookPayload({ alias: 'Crombolo.ElementSaved', key: 'e', usedBy: ['p1'] }, undefined),
    ).toEqual({ Id: 'e' })
  })
})

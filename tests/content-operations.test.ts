/**
 * Story 170: every document write goes through `@crombolo/content`, so the rules
 * and the record do not depend on what started it — the backoffice, the command
 * line, the scheduled job, an approval or a form.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Actor,
  createDocumentOperations,
  type DocumentEvent,
  liveEventsFor,
  notificationFor,
  operatorActor,
  systemActor,
  userActor,
  webhookFor,
} from '@crombolo/content'
import { DocumentPermissions as D, ROOT_ACCESS } from '@crombolo/core'
import {
  AuditLog,
  ComponentRepository,
  ContentTypeRepository,
  currentSchemaState,
  DocumentRepository,
  RedirectRepository,
} from '@crombolo/data'
import { siteDocumentOperations } from '@crombolo/server'
import { scheduleTimes } from '../packages/cli/src/support/publish.ts'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page", "policy"]
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const POLICY_TOML = PAGE_TOML.replace(
  'alias = "page"\nname = "Page"',
  'alias = "policy"\nname = "Policy"',
).replace(
  'components = ["page"]\ndefault-component = "page"',
  'components = ["page"]\ndefault-component = "page"',
)

/** Policies need an administrator's sign-off before they go live. */
const WORKFLOW_TOML = `[workflow]
alias = "sign-off"
name = "Sign-off"
applies-to = { branches = [], content-types = ["policy"] }
publishers-may-skip = false
on-edit = "withdraw"
self-approval = "allowed"
comments = "optional"
unpublish = true
on-change = "restart"

[[stage]]
alias = "final"
approvers = ["admin"]
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'content-operations-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'schema/workflows', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'schema', 'content-types', 'policy.toml'), POLICY_TOML)
  writeFileSync(join(root, 'schema', 'workflows', 'sign-off.toml'), WORKFLOW_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components') },
  })
  open.push(h)
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const types = new ContentTypeRepository(db)
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const input = async (name: string, parentKey: string | null, type = 'page') => ({
    key: crypto.randomUUID(),
    contentTypeKey: (await types.byAlias(type))?.key as string,
    componentKey,
    parentKey,
    values: [{ alias: 'title', culture: null, segment: null, value: `${name} title` }],
    variants: [{ culture: null, segment: null, name }],
  })
  const page = async (name: string, parentKey: string | null, type = 'page', publish = true) => {
    const doc = await docs.create(await input(name, parentKey, type))
    if (publish) await docs.publish(doc.key, null)
    h.server.cache.invalidate()
    return doc.key
  }
  /** Operations that tell this test what they announced. */
  const recorded = () => {
    const heard: Array<{ event: DocumentEvent; actor: Actor }> = []
    const operations = createDocumentOperations({
      db,
      repository: { nodeState: h.server.schema.nodeState },
      // Heard once committed: an event recorded in a transaction that rolled back never happened.
      events: {
        record: async () => {},
        afterCommit: (event, actor) => void heard.push({ event, actor }),
      },
    })
    return { operations, heard }
  }
  const audit = async (key: string) =>
    (await new AuditLog(db).query({ entityKey: key }, { skip: 0, take: 50 })).items
  return { h, db, docs, input, page, recorded, audit }
}

/** A user who may do everything, in one language only. */
const editor = (languages: string[] = []) =>
  userActor({
    id: crypto.randomUUID(),
    name: 'Ed',
    isAdmin: false,
    allowedSections: ['Umb.Section.Content'],
    hasAccessToAllLanguages: languages.length === 0,
    languages,
    startNodes: { document: ROOT_ACCESS, media: ROOT_ACCESS },
    groups: [
      {
        key: 'g',
        alias: 'editors',
        defaults: Object.values(D).filter((verb) => verb !== D.PropertyValueWrite),
        granular: new Map(),
        properties: new Map(),
      },
    ],
  })

describe('the command line follows approvals', () => {
  test('a page under a workflow is refused, unless the operator says to skip, which is recorded', async () => {
    const { db, h, page, audit } = await site()
    const home = await page('Home', null)
    const policy = await page('Policy', home, 'policy', false)
    // As `crombolo content publish` builds them.
    const { operations } = await siteDocumentOperations(db, h.server.config)
    const refused = await operations.publish(operatorActor('ci'), policy, { cultures: null })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.kind).toBe('needsApproval')
      expect(refused.reason).toContain('needs approval through "Sign-off"')
    }
    expect((await new DocumentRepository(db).byKeyPublished(policy))?.key).toBeUndefined()

    const skipped = await operations.publish(operatorActor('ci', { skipApproval: true }), policy, {
      cultures: null,
    })
    expect(skipped.ok).toBe(true)
    const entry = (await audit(policy)).find((e) => e.action === 'Publish')
    expect(entry).toMatchObject({
      source: 'cli',
      userName: 'ci',
      detail: 'Approval skipped from the command line',
      entityName: 'Policy',
    })
  })

  test('the system acts on what was decided, past the gate', async () => {
    const { page, recorded } = await site()
    const home = await page('Home', null)
    const policy = await page('Policy', home, 'policy', false)
    const { operations, heard } = recorded()
    const result = await operations.publish(systemActor('The schedule'), policy, { cultures: null })
    expect(result.ok).toBe(true)
    expect(heard.map((h) => h.event)).toEqual([{ type: 'published', key: policy, cultures: null }])
  })
})

describe('scheduling from the command line', () => {
  const at = '2030-01-01T09:00:00.000Z'
  const until = '2030-02-01T09:00:00.000Z'

  test('--at is when the command acts, --until when its opposite does', () => {
    expect(scheduleTimes(true, { at, until })).toEqual({
      publishTime: new Date(at),
      unpublishTime: new Date(until),
    })
    // `content unpublish --at` takes the page down then; it once scheduled a publish.
    expect(scheduleTimes(false, { at, until })).toEqual({
      publishTime: new Date(until),
      unpublishTime: new Date(at),
    })
    expect(scheduleTimes(false, { at })).toEqual({ publishTime: null, unpublishTime: new Date(at) })
  })
})

describe('a user is held to the rules from every entry point', () => {
  test('creating a page refuses a property the user may only read', async () => {
    const { input, recorded } = await site()
    const { operations, heard } = recorded()
    const result = await operations.create(editor(), await input('Home', null))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.reason).toBe('You may not change "Title" (title).')
    }
    expect(heard).toEqual([])
  })

  test('saving in a language the user does not work in is refused', async () => {
    const { page, input, recorded } = await site()
    const home = await page('Home', null)
    const { operations } = recorded()
    const sent = await input('Home', null)
    const result = await operations.save(editor(['en-US']), home, {
      ...sent,
      variants: [{ culture: 'da-DK', segment: null, name: 'Hjem' }],
      values: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('forbidden')
  })
})

describe('one change, one transaction', () => {
  test('creating and publishing under an unpublished parent leaves no draft behind', async () => {
    const { db, page, input, recorded } = await site()
    const parent = await page('Draft', null, 'page', false)
    const { operations } = recorded()
    const sent = await input('Child', parent)
    const result = await operations.createAndPublish(systemActor('test'), sent, null)
    expect(result.ok).toBe(false)
    expect(await new DocumentRepository(db).byKey(sent.key)).toBeUndefined()
  })

  test('publishing several pages checks all first, then writes all or none', async () => {
    const { db, page, recorded } = await site()
    const home = await page('Home', null)
    const ready = await page('Ready', home, 'page', false)
    const orphan = await page('Orphan', await page('Hidden', home, 'page', false), 'page', false)
    const { operations, heard } = recorded()
    const result = await operations.publishMany(
      systemActor('test'),
      [ready, orphan],
      null,
      'publish',
    )
    expect(result.ok).toBe(false)
    expect((await new DocumentRepository(db).byKeyPublished(ready))?.key).toBeUndefined()
    expect(heard).toEqual([])
  })
})

describe('an older copy cannot overwrite a newer one (story 172)', () => {
  const titleOf = async (h: Harness, key: string) =>
    (
      await h.json<{ values: Array<{ alias: string; value: unknown }> }>(`${V1}/document/${key}`)
    ).values.find((v) => v.alias === 'title')?.value
  const body = (h: Harness, key: string) => h.json<Record<string, unknown>>(`${V1}/document/${key}`)
  const withTitle = (document: Record<string, unknown>, title: string) => ({
    ...document,
    values: [{ alias: 'title', culture: null, segment: null, value: title }],
  })
  const put = (h: Harness, path: string, payload: unknown, headers: Record<string, string>) =>
    h.call(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    })

  test('a read names its revision, and a save from it answers with the next one', async () => {
    const { h, page } = await site()
    const home = await page('Home', null)
    const read = await h.call(`${V1}/document/${home}`)
    const etag = read.headers.get('etag') as string
    expect(etag).toMatch(/^"\d+\.\d+"$/)
    const saved = await put(h, `${V1}/document/${home}`, withTitle(await read.json(), 'Mine'), {
      'if-match': etag,
    })
    expect(saved.status).toBe(200)
    const next = saved.headers.get('etag')
    expect(next).not.toBe(etag)
    expect((await h.call(`${V1}/document/${home}`)).headers.get('etag')).toBe(next)
  })

  test('two saves from the same copy: the first lands, the second is refused and changes nothing', async () => {
    const { h, page } = await site()
    const home = await page('Home', null)
    const read = await h.call(`${V1}/document/${home}`)
    const etag = read.headers.get('etag') as string
    const copy = await read.json()
    expect(
      (await put(h, `${V1}/document/${home}`, withTitle(copy, 'First'), { 'if-match': etag }))
        .status,
    ).toBe(200)
    const second = await put(h, `${V1}/document/${home}`, withTitle(copy, 'Second'), {
      'if-match': etag,
    })
    expect(second.status).toBe(412)
    expect(await second.json()).toMatchObject({
      title: 'Could not save the document',
      detail: expect.stringContaining('Someone else changed this page after you opened it'),
    })
    expect(await titleOf(h, home)).toBe('First')
  })

  test('a save that names no revision is refused for a user; `*` says to overwrite', async () => {
    const { h, page } = await site()
    const home = await page('Home', null)
    const copy = await body(h, home)
    const none = await put(h, `${V1}/document/${home}`, withTitle(copy, 'Blind'), {
      'x-test-no-if-match': '1',
    })
    expect(none.status).toBe(428)
    expect(await titleOf(h, home)).toBe('Home title')
    const forced = await put(h, `${V1}/document/${home}`, withTitle(copy, 'Forced'), {
      'if-match': '*',
    })
    expect(forced.status).toBe(200)
    expect(await titleOf(h, home)).toBe('Forced')
  })

  test('saving and publishing from a stale copy is refused as a save', async () => {
    const { h, page } = await site()
    const home = await page('Home', null)
    const read = await h.call(`${V1}/document/${home}`)
    const etag = read.headers.get('etag') as string
    const copy = await read.json()
    await h.put(`${V1}/document/${home}`, withTitle(copy, 'Theirs'))
    const stale = await put(
      h,
      `${V1}/document/${home}/update-and-publish`,
      { ...withTitle(copy, 'Mine'), culturesToPublish: [] },
      { 'if-match': etag },
    )
    expect(stale.status).toBe(412)
    expect((await stale.json()).title).toBe('Could not save the document')
  })

  test('publishing from a stale copy is refused; without a revision it publishes what is there', async () => {
    const { h, page, db } = await site()
    const home = await page('Home', null)
    const etag = (await h.call(`${V1}/document/${home}`)).headers.get('etag') as string
    await h.put(`${V1}/document/${home}`, withTitle(await body(h, home), 'Newer'))
    const stale = await put(
      h,
      `${V1}/document/${home}/publish`,
      { publishSchedules: [] },
      {
        'if-match': etag,
      },
    )
    expect(stale.status).toBe(412)
    const plain = await put(h, `${V1}/document/${home}/publish`, { publishSchedules: [] }, {})
    expect(plain.status).toBe(200)
    const published = await new DocumentRepository(db).byKeyPublished(home)
    expect(published?.values.find((v) => v.alias === 'title')?.value).toBe('Newer')
  })

  test('rolling back from a stale copy is refused when a revision is sent', async () => {
    const { h, page } = await site()
    const home = await page('Home', null)
    const versions = await h.json<{ items: Array<{ id: string }> }>(
      `${V1}/document-version?documentId=${home}`,
    )
    const etag = (await h.call(`${V1}/document/${home}`)).headers.get('etag') as string
    await h.put(`${V1}/document/${home}`, withTitle(await body(h, home), 'Newer'))
    const version = versions.items.at(-1)?.id as string
    const stale = await h.call(`${V1}/document-version/${version}/rollback`, {
      method: 'POST',
      headers: { 'if-match': etag },
    })
    expect(stale.status).toBe(412)
    expect(await titleOf(h, home)).toBe('Newer')
  })

  test('a patch is checked against the copy it was applied to', async () => {
    const { h, page } = await site()
    const home = await page('Home', null)
    const etag = (await h.call(`${V1}/document/${home}`)).headers.get('etag') as string
    await h.put(`${V1}/document/${home}`, withTitle(await body(h, home), 'Theirs'))
    const patch = (headers: Record<string, string>) =>
      h.call(`${V1}/document/${home}/patch`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          operations: [{ op: 'replace', path: '/values/0/value', value: 'Patched' }],
        }),
      })
    expect((await patch({ 'if-match': etag })).status).toBe(412)
    expect(await titleOf(h, home)).toBe('Theirs')
    expect((await patch({ 'if-match': '*' })).status).toBe(200)
    expect(await titleOf(h, home)).toBe('Patched')
  })

  test('the site acts on the current page and needs no revision', async () => {
    const { page, input, recorded } = await site()
    const home = await page('Home', null)
    const { operations } = recorded()
    const sent = await input('Home', null)
    expect((await operations.save(systemActor('The schedule'), home, sent)).ok).toBe(true)
    expect((await operations.save(operatorActor('ci'), home, sent)).ok).toBe(true)
    const refused = await operations.save(editor(), home, sent)
    expect(refused.ok).toBe(false)
  })

  test('an approval publishes only the version it was given for', async () => {
    const { db, h, page, input, recorded } = await site()
    const home = await page('Home', null, 'page', false)
    const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
    const approvedOn = (await docs.eventMarkers(home))?.head as number
    const { operations } = recorded()
    await operations.save(systemActor('test'), home, await input('Home', null))
    const result = await operations.publish(systemActor('Approval'), home, {
      cultures: null,
      expectedHead: approvedOn,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.kind).toBe('stale')
    expect((await docs.byKeyPublished(home))?.key).toBeUndefined()
  })

  test('an upgrade rewriting values moves the revision, though it adds no version', async () => {
    const { db, h, page } = await site()
    const home = await page('Home', null)
    const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
    const before = await docs.revisionOf(home)
    const head = (await docs.eventMarkers(home))?.head
    await docs.appendUnderState(
      home,
      [{ alias: 'title', culture: null, segment: null, value: 'Upgraded' }],
      { schemaStateId: (await currentSchemaState(db)).id },
    )
    expect((await docs.eventMarkers(home))?.head).toBe(head)
    expect(await docs.revisionOf(home)).not.toBe(before)
  })
})

describe('the scheduled job', () => {
  test('tracks a renamed page as an editor’s publish does, and records it as the schedule', async () => {
    const { h, page, audit } = await site()
    const home = await page('Home', null)
    const about = await page('About', home)
    const document = await h.json<Record<string, unknown>>(`${V1}/document/${about}`)
    await h.put(`${V1}/document/${about}`, {
      ...document,
      variants: [{ culture: null, segment: null, name: 'About us' }],
    })
    const soon = new Date(Date.now() + 1000).toISOString()
    expect(
      (
        await h.put(`${V1}/document/${about}/publish`, {
          publishSchedules: [{ culture: null, schedule: { publishTime: soon } }],
        })
      ).status,
    ).toBe(200)
    await h.server.jobs.runScheduledPublishing(new Date(Date.now() + 60_000))
    const redirects = await new RedirectRepository(h.server.db).byDocument(about, { take: 10 })
    expect(redirects.items.map((r) => r.pattern)).toContain('/about')
    expect((await audit(about)).find((e) => e.source === 'job')).toMatchObject({
      action: 'Publish',
      userName: 'The schedule',
      detail: 'Scheduled',
    })
  })
})

describe('what an event announces', () => {
  test('the same webhooks, notifications and live events whoever made the change', () => {
    expect(webhookFor({ type: 'scheduled', key: 'k' })).toBeUndefined()
    expect(webhookFor({ type: 'rolledBack', key: 'k', versionId: '1' })?.alias).toBe(
      'Umbraco.ContentRolledBack',
    )
    expect(webhookFor({ type: 'sorted', parentKey: 'p' })?.alias).toBe('Umbraco.ContentSorted')
    expect(webhookFor({ type: 'restored', key: 'k' })?.alias).toBe('Umbraco.ContentMoved')
    expect(webhookFor({ type: 'copied', key: 'k', copyKey: 'c' })).toEqual({
      alias: 'Umbraco.ContentCopied',
      key: 'c',
    })
    expect(notificationFor({ type: 'unpublished', key: 'k', cultures: null })).toBeUndefined()
    expect(notificationFor({ type: 'rolledBack', key: 'k', versionId: 'v' })).toMatchObject({
      key: 'v',
      keyKind: 'version',
    })
    expect(
      liveEventsFor({ type: 'branchPublished', key: 'a', published: ['a', 'b'] }).map((e) => e.key),
    ).toEqual(['a', 'b'])
    expect(liveEventsFor({ type: 'publicAccessChanged', key: 'k', change: 'removed' })).toEqual([
      { eventSource: 'Umbraco:CMS:Document', eventType: 'Updated', key: 'k' },
    ])
  })
})

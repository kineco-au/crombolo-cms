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
      events: { emit: async (event, actor) => void heard.push({ event, actor }) },
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
    startNodes: { document: ROOT_ACCESS },
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

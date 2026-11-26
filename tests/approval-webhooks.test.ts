/**
 * Story 441: each step of an approval request raises its webhook, once, in the step's own
 * transaction: facts only, never a comment. A webhook may be narrowed to some workflows, as
 * to some page types.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository, UserGroupRepository } from '@crombolo/data'
import { parseWebhookFile, writeWebhookFile } from '@crombolo/server'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const API = `${BACKOFFICE}/crombolo/api/approvals`
const KEY = 'a-secret-key-that-is-long-enough-to-use-0123'

const POLICY = `[content-type]
alias = "policy"
name = "Policy"
allow-at-root = true
components = ["policy"]
default-component = "policy"
`

const WORKFLOW = `[workflow]
alias = "sign-off"
name = "Sign-off"
applies-to = { branches = [], content-types = ["policy"] }
publishers-may-skip = false
on-edit = "withdraw"
self-approval = "refused"
comments = "optional"
unpublish = false
on-change = "restart"

[[stage]]
alias = "legal"
name = "Legal review"
approvers = ["legal"]
`

const open: Harness[] = []
const dirs: string[] = []
const listeners: Array<{ stop(force?: boolean): void }> = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
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
  const root = mkdtempSync(join(process.cwd(), 'output', 'approval-webhooks-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'schema/workflows', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'policy.toml'), POLICY)
  writeFileSync(join(root, 'schema', 'workflows', 'sign-off.toml'), WORKFLOW)
  writeFileSync(join(root, 'components', 'policy.tsx'), 'export default () => <main />\n')
  const admin = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      secretKey: KEY,
      webhooks: { headerVariables: [] },
      allowPrivateAddresses: true,
    },
  })
  open.push(admin)
  const groups = new UserGroupRepository(admin.server.db)
  const writer = (await groups.byAlias('writer')) as NonNullable<
    Awaited<ReturnType<typeof groups.byAlias>>
  >
  await groups.save({
    ...writer,
    key: crypto.randomUUID(),
    alias: 'legal',
    name: 'Legal',
    sections: [...writer.sections, 'workflow'],
  })
  const editor = await signInAsGroup(admin, 'writer')
  const legal = await signInAsGroup(admin, 'legal')
  open.push(editor, legal)
  const typeKey = (await new ContentTypeRepository(admin.server.db).byAlias('policy'))
    ?.key as string
  const page = async () => {
    const created = await editor.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: null,
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Privacy' }],
    })
    expect(created.status).toBe(201)
    return created.headers.get('umb-generated-resource') as string
  }
  const hook = async (url: string, extra: Record<string, unknown> = {}) => {
    const made = await admin.post(`${V1}/webhook`, {
      enabled: true,
      contentTypeKeys: [],
      headers: {},
      url,
      events: [
        'Crombolo.ApprovalSent',
        'Crombolo.ApprovalStageReached',
        'Crombolo.ApprovalApproved',
        'Crombolo.ApprovalFinished',
        'Crombolo.ApprovalWithdrawn',
      ],
      ...extra,
    })
    expect(made.status, await made.clone().text()).toBe(201)
    return made.headers.get('umb-generated-resource') as string
  }
  const deliver = async () => {
    await Bun.sleep(20)
    await admin.server.jobs.runWebhooks()
  }
  return { admin, editor, legal, page, hook, deliver, typeKey }
}

describe(`approval webhooks (${dialectUnderTest})`, () => {
  test('each step raises its event, facts only, never the comment', async () => {
    const remote = receiver()
    const { editor, legal, page, hook, deliver } = await site()
    await hook(remote.url)
    const key = await page()
    const sent = await editor.post(`${API}/page/${key}/send`, {
      action: 'publish',
      comment: 'between us: the legal text is not final',
    })
    expect(sent.status, await sent.clone().text()).toBe(200)
    const request = ((await sent.json()) as { key: string }).key
    const approved = await legal.post(`${API}/request/${request}/approve`, {
      stage: 'legal',
      comment: 'fine by me, privately',
    })
    expect(approved.status, await approved.clone().text()).toBe(200)
    await deliver()

    expect(remote.received.map((r) => r.headers['webhook-event'])).toEqual([
      'Crombolo.ApprovalSent',
      'Crombolo.ApprovalStageReached',
      'Crombolo.ApprovalApproved',
      'Crombolo.ApprovalFinished',
    ])
    const [first, reached, , finished] = remote.received.map((r) => r.body)
    expect(first).toMatchObject({
      Id: request,
      Approval: {
        Request: request,
        Page: { Key: key, Name: 'Privacy' },
        Workflow: { Alias: 'sign-off', Name: 'Sign-off' },
        By: { Name: 'writer@example.com' },
        Action: 'publish',
      },
    })
    expect(reached).toMatchObject({
      Approval: { Stage: { Alias: 'legal', Name: 'Legal review', Groups: ['legal'] } },
    })
    expect(finished).toMatchObject({ Approval: { Outcome: 'published' } })
    expect(JSON.stringify(remote.received)).not.toContain('between us')
    expect(JSON.stringify(remote.received)).not.toContain('privately')
  })

  test('a withdrawn request says so', async () => {
    const remote = receiver()
    const { editor, page, hook, deliver } = await site()
    await hook(remote.url)
    const key = await page()
    const sent = (await (
      await editor.post(`${API}/page/${key}/send`, { action: 'publish' })
    ).json()) as { key: string }
    expect((await editor.post(`${API}/request/${sent.key}/withdraw`, {})).status).toBe(200)
    await deliver()
    expect(remote.received.map((r) => r.headers['webhook-event'])).toContain(
      'Crombolo.ApprovalWithdrawn',
    )
  })

  test('narrowed to a workflow, or a page type, it hears only those', async () => {
    const other = receiver()
    const mine = receiver()
    const typed = receiver()
    const { admin, editor, page, hook, deliver, typeKey } = await site()
    const otherHook = await hook(other.url)
    await hook(mine.url)
    await hook(typed.url, { contentTypeKeys: [crypto.randomUUID()] })
    const narrowed = await admin.call(
      `${BACKOFFICE}/crombolo/api/webhooks/${otherHook}/workflows`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflows: ['some-other-workflow'] }),
      },
    )
    expect(narrowed.status).toBe(400)
    // An empty list hears every workflow; one naming another workflow hears none of these.
    await admin.server.db.q
      .updateTable('webhook')
      .set({ workflows: JSON.stringify(['some-other-workflow']) })
      .where('key', '=', otherHook)
      .execute()
    const shown = await admin.json<{ chosen: string[]; available: Array<{ alias: string }> }>(
      `${BACKOFFICE}/crombolo/api/webhooks/${otherHook}/workflows`,
    )
    expect(shown.available.map((w) => w.alias)).toEqual(['sign-off'])
    await editor.post(`${API}/page/${await page()}/send`, { action: 'publish' })
    await deliver()
    expect(other.received).toEqual([])
    expect(typed.received).toEqual([])
    expect(mine.received.length).toBeGreaterThan(0)
    void typeKey
  })

  test('a webhook file names its workflows, and keeps them', () => {
    const file = `[webhook]
alias = "tickets"
url = "https://tickets.example/hook"
events = ["Crombolo.ApprovalSent"]
workflows = ["sign-off"]
`
    const read = parseWebhookFile('tickets.toml', file)
    expect(read.problems).toEqual([])
    expect(read.webhook?.workflows).toEqual(['sign-off'])
    expect(writeWebhookFile(read.webhook as NonNullable<typeof read.webhook>)).toContain(
      'workflows = ["sign-off"]',
    )
  })
})

/**
 * Story 229: a workflow stage nobody could approve says so. Only enabled people count, not
 * service accounts and not the sender where the workflow refuses self-approval; sending
 * through such a stage is refused naming it; a page already waiting there says so, the
 * Content status check names it, and administrators are told once.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { approvalsNeeded } from '@crombolo/core'
import {
  ApprovalRepository,
  ContentTypeRepository,
  UserGroupRepository,
  UserRepository,
} from '@crombolo/data'
import type { EmailMessage, EmailPort } from '@crombolo/server'
import { approversIn } from '../packages/server/src/approvals.ts'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const API = `${BACKOFFICE}/crombolo/api/approvals`

const POLICY_TOML = `[content-type]
alias = "policy"
name = "Policy"
allow-at-root = true
components = ["policy"]
default-component = "policy"
`

const WORKFLOW = (approvers: string, self = 'refused') => `[workflow]
alias = "sign-off"
name = "Sign-off"
applies-to = { branches = [], content-types = ["policy"] }
publishers-may-skip = false
on-edit = "withdraw"
self-approval = "${self}"
comments = "optional"
unpublish = false
on-change = "restart"

[[stage]]
alias = "legal"
name = "Legal review"
approvers = [${approvers}]
required = "all"
`

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

function capturing(): EmailPort & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  return {
    sent,
    description: 'test',
    provider: 'custom',
    async send(message) {
      sent.push(message)
      return { ok: true, id: 'x' }
    },
  }
}

async function site(workflow: string) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'approvals-nobody-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'schema/workflows', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'policy.toml'), POLICY_TOML)
  writeFileSync(join(root, 'schema', 'workflows', 'sign-off.toml'), workflow)
  writeFileSync(join(root, 'components', 'policy.tsx'), 'export default () => <main />\n')
  const email = capturing()
  const admin = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components'), email },
  })
  open.push(admin)
  const groups = new UserGroupRepository(admin.server.db)
  const writer = (await groups.byAlias('writer')) as NonNullable<
    Awaited<ReturnType<typeof groups.byAlias>>
  >
  expect(
    await groups.save({
      ...writer,
      key: crypto.randomUUID(),
      alias: 'legal',
      name: 'Legal',
      sections: [...writer.sections, 'workflow'],
    }),
  ).toBe('saved')
  const typeKey = (await new ContentTypeRepository(admin.server.db).byAlias('policy'))
    ?.key as string
  const page = async (by: Harness, name = 'Privacy') => {
    const created = await by.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: null,
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status).toBe(201)
    return created.headers.get('umb-generated-resource') as string
  }
  const send = (by: Harness, key: string) =>
    by.post(`${API}/page/${key}/send`, { action: 'publish' })
  return { admin, email, page, send }
}

describe(`a stage nobody can approve (${dialectUnderTest})`, () => {
  test('sending is refused naming the stage and its groups, a group not there included', async () => {
    const empty = await site(WORKFLOW('"legal"'))
    const writer = await signInAsGroup(empty.admin, 'writer')
    open.push(writer)
    const refused = await empty.send(writer, await empty.page(writer))
    expect(refused.status).toBe(409)
    const said = JSON.stringify(await refused.json())
    expect(said).toContain(
      'Nobody can approve \\"Legal review\\": Legal has nobody who can approve',
    )
    expect(said).toContain('Ask an administrator to add someone who can approve to Legal')

    const missing = await site(WORKFLOW('"compliance"'))
    const other = await signInAsGroup(missing.admin, 'writer')
    open.push(other)
    const gone = await missing.send(other, await missing.page(other))
    expect(gone.status).toBe(409)
    expect(JSON.stringify(await gone.json())).toContain('\\"compliance\\" is not a group here')
  })

  test('only enabled people count, never the sender where self-approval is refused', async () => {
    const { admin, page, send } = await site(WORKFLOW('"legal"'))
    const db = admin.server.db
    const legal = await signInAsGroup(admin, 'legal')
    open.push(legal)
    // The sole member of Legal sends their own page: nobody else could approve it.
    const own = await send(legal, await page(legal))
    expect(own.status).toBe(409)

    const users = new UserRepository(db)
    const member = (await users.byEmail('legal@example.com'))?.key as string
    expect(await approversIn(db, ['legal'])).toBe(1)
    await users.setApproved([member], false)
    expect(await approversIn(db, ['legal'])).toBe(0)
    await users.setApproved([member], true)
    // A service account in the group counts for nothing.
    const groupKey = (await new UserGroupRepository(db).byAlias('legal'))?.key as string
    await users.create({
      key: crypto.randomUUID(),
      name: 'Robot',
      userName: 'robot',
      email: '',
      kind: 'Api',
      groupKeys: [groupKey],
      languageIsoCode: null,
    })
    expect(await approversIn(db, ['legal'])).toBe(1)
    // The same count sets what "all" needs: a disabled member holds nothing up.
    expect(approvalsNeeded('all', await approversIn(db, ['legal']))).toBe(1)
  })

  test('a page waiting there says so, the status check names it, and administrators are told once', async () => {
    const { admin, email, page, send } = await site(WORKFLOW('"legal"'))
    const db = admin.server.db
    const writer = await signInAsGroup(admin, 'writer')
    const legal = await signInAsGroup(admin, 'legal')
    open.push(writer, legal)
    const key = await page(writer)
    const sent = await send(writer, key)
    expect(sent.status, await sent.clone().text()).toBe(200)
    const view = (await sent.json()) as { key: string; stages: Array<{ nobody?: string }> }
    expect(view.stages[0]?.nobody).toBeUndefined()

    // Its only approver leaves the group.
    const users = new UserRepository(db)
    const member = (await users.byEmail('legal@example.com')) as NonNullable<
      Awaited<ReturnType<typeof users.byEmail>>
    >
    await users.update(member.key, {
      name: member.name,
      userName: member.userName,
      email: member.email,
      languageIsoCode: member.languageIsoCode,
      groupKeys: [],
    })
    const now = (
      await admin.json<{ request: { stages: Array<{ nobody?: string }> } }>(`${API}/page/${key}`)
    ).request
    expect(now.stages[0]?.nobody).toBe(
      'Nobody can approve "Legal review": Legal has nobody who can approve.',
    )

    const ran = await admin.post(`${V1}/health-check-group/Content/check`, {})
    expect(ran.status).toBe(200)
    const results = JSON.stringify(await ran.json())
    expect(results).toContain('Legal has nobody who can approve')
    expect(results).toContain('1 page(s) wait there')

    // The schedules job looks for stalled requests too.
    await admin.server.jobs.runScheduledPublishing(new Date())
    const told = () => email.sent.filter((m) => m.subject.startsWith('Nobody can approve'))
    expect(told()).toHaveLength(1)
    expect(told()[0]?.to.map((t) => t.email)).toContain('admin@crombolo.local')
    await admin.server.jobs.runScheduledPublishing(new Date())
    expect(told()).toHaveLength(1)
    const history = await new ApprovalRepository(db).history(
      (await new ApprovalRepository(db).openFor(key))?.id as number,
    )
    expect(history.some((h) => h.kind === 'stalled')).toBe(true)
  })
})

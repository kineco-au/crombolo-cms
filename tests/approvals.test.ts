/**
 * Story 028: approval before publishing, end to end through the API — the gate
 * on publishing and saving, a graph of stages run in parallel and joined,
 * send-backs, edits while waiting, and a workflow changed in flight. Story 029:
 * a request that says when to publish, and the schedule job that does it.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository, DocumentRepository, UserGroupRepository } from '@crombolo/data'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const API = `${BACKOFFICE}/crombolo/api/approvals`

const POLICY_TOML = `[content-type]
alias = "policy"
name = "Policy"
allow-at-root = true
allow-children = ["policy"]
components = ["policy"]
default-component = "policy"

[[property]]
alias = "body"
name = "Body"
type = "textarea"
`

const WORKFLOW_TOML = (extra = '') => `[workflow]
alias = "policy-sign-off"
name = "Policy sign-off"
applies-to = { branches = [], content-types = ["policy"] }
publishers-may-skip = false
on-edit = "withdraw"
self-approval = "refused"
comments = "on-send-back"
unpublish = true
on-change = "restart"
${extra}
[[stage]]
alias = "legal"
approvers = ["legal"]
next = ["brand", "editorial"]
send-back = "editor"

[[stage]]
alias = "brand"
approvers = ["brand"]
next = ["final"]
send-back = "legal"

[[stage]]
alias = "editorial"
approvers = ["editor"]
next = ["final"]

[[stage]]
alias = "final"
approvers = ["admin"]
required = "all"
`

interface View {
  key: string
  state: string
  schedule: Array<{
    culture: string | null
    publishTime: string | null
    unpublishTime: string | null
  }> | null
  stages: Array<{ alias: string; state: string; approvals: number; needed: number }>
  history: Array<{ kind: string; stage: string | null; comment: string | null }>
  can: { approve: string[]; sendBack: string[]; withdraw: boolean }
}

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

/** A site with a Policy type under the workflow, its approver groups, and a client per person. */
async function site(workflow = WORKFLOW_TOML()) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'approvals-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'schema', 'workflows'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'policy.toml'), POLICY_TOML)
  writeFileSync(join(root, 'schema', 'workflows', 'policy-sign-off.toml'), workflow)
  writeFileSync(join(root, 'components', 'policy.tsx'), 'export default () => <main />\n')
  const admin = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components') },
  })
  open.push(admin)
  // Two approver groups that may edit content and not publish it.
  const groups = new UserGroupRepository(admin.server.db)
  const writer = (await groups.byAlias('writer')) as NonNullable<
    Awaited<ReturnType<typeof groups.byAlias>>
  >
  for (const alias of ['legal', 'brand'])
    expect(
      await groups.save({
        ...writer,
        key: crypto.randomUUID(),
        alias,
        name: alias,
        sections: [...writer.sections, 'workflow'],
      }),
    ).toBe('saved')
  const people = {
    admin,
    writer: await signInAsGroup(admin, 'writer'),
    legal: await signInAsGroup(admin, 'legal'),
    brand: await signInAsGroup(admin, 'brand'),
    editor: await signInAsGroup(admin, 'editor'),
  }
  open.push(people.writer, people.legal, people.brand, people.editor)
  const typeKey = (await new ContentTypeRepository(admin.server.db).byAlias('policy'))
    ?.key as string
  const page = async (name: string, by: Harness = people.writer) => {
    const created = await by.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: null,
      parent: null,
      values: [{ alias: 'body', culture: null, segment: null, value: `${name} text` }],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status).toBe(201)
    return created.headers.get('umb-generated-resource') as string
  }
  const send = async (key: string, by: Harness = people.writer, action = 'publish') => {
    const response = await by.post(`${API}/page/${key}/send`, { action })
    expect(response.status, await response.clone().text()).toBe(200)
    return (await response.json()) as View
  }
  const act = (request: string, verb: string, by: Harness, body: unknown = {}) =>
    by.post(`${API}/request/${request}/${verb}`, body)
  const published = async (key: string) =>
    (await admin.json<{ variants: Array<{ state: string }> }>(`${V1}/document/${key}`)).variants[0]
      ?.state
  return { root, people, page, send, act, published }
}

const states = (view: View) => Object.fromEntries(view.stages.map((s) => [s.alias, s.state]))

describe(`approval before publishing (${dialectUnderTest})`, () => {
  test('a covered page cannot be published directly, even by someone who may publish', async () => {
    const { people, page } = await site()
    const key = await page('Privacy')
    // A writer may not publish anything, workflow or not; an editor may, and is told why not here.
    expect(
      (await people.writer.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status,
    ).toBe(403)
    const refused = await people.editor.put(`${V1}/document/${key}/publish`, {
      publishSchedules: [],
    })
    expect(refused.status).toBe(400)
    expect((await refused.json()).detail).toContain('needs approval through "Policy sign-off"')
    const branch = await people.editor.put(`${V1}/document/${key}/publish-with-descendants`, {
      cultures: [],
      includeUnpublishedDescendants: true,
    })
    expect(branch.status).toBe(400)
  })

  test('stages run in parallel, the join waits for both, and the last approval publishes', async () => {
    const { people, page, send, act, published } = await site()
    const key = await page('Privacy')
    const sent = await send(key)
    expect(states(sent)).toEqual({
      legal: 'waiting',
      brand: 'pending',
      editorial: 'pending',
      final: 'pending',
    })

    // Only the stage's own group may act on it.
    expect((await act(sent.key, 'approve', people.brand)).status).toBe(403)
    const afterLegal = (await (await act(sent.key, 'approve', people.legal)).json()) as View
    expect(states(afterLegal)).toMatchObject({
      legal: 'approved',
      brand: 'waiting',
      editorial: 'waiting',
      final: 'pending',
    })

    const afterBrand = (await (await act(sent.key, 'approve', people.brand)).json()) as View
    expect(states(afterBrand).final).toBe('pending')
    const afterEditorial = (await (await act(sent.key, 'approve', people.editor)).json()) as View
    expect(states(afterEditorial).final).toBe('waiting')
    expect(await published(key)).not.toBe('Published')

    const done = (await (await act(sent.key, 'approve', people.admin)).json()) as View
    expect(done.state).toBe('approved')
    expect(done.history.map((h) => h.kind)).toEqual([
      'sent',
      'approved',
      'approved',
      'approved',
      'approved',
      'published',
    ])
    expect(await published(key)).toBe('Published')
  })

  test('the person who made the change cannot approve it', async () => {
    const { people, page, send, act } = await site()
    const key = await page('Mine', people.legal)
    const sent = await send(key, people.legal)
    const refused = await act(sent.key, 'approve', people.legal)
    expect(refused.status).toBe(403)
    expect((await refused.json()).message).toContain('someone else has to approve it')
  })

  test('sending back needs a reason, and goes where the stage says', async () => {
    const { people, page, send, act } = await site()
    const key = await page('Cookies')
    const sent = await send(key)
    await act(sent.key, 'approve', people.legal)
    await act(sent.key, 'approve', people.editor)

    expect((await act(sent.key, 'send-back', people.brand)).status).toBe(400)
    // Brand sends back to Legal: Legal runs again, and so does everything after it.
    const back = (await (
      await act(sent.key, 'send-back', people.brand, { comment: 'the logo is wrong' })
    ).json()) as View
    expect(back.state).toBe('waiting')
    expect(states(back)).toMatchObject({
      legal: 'waiting',
      brand: 'discarded',
      editorial: 'discarded',
    })

    // Legal sends back to the editor: the request ends.
    const ended = (await (
      await act(sent.key, 'send-back', people.legal, { comment: 'start again' })
    ).json()) as View
    expect(ended.state).toBe('sent-back')
    expect(ended.history.filter((h) => h.kind === 'sent-back').map((h) => h.comment)).toEqual([
      'the logo is wrong',
      'start again',
    ])
  })

  test('saving a waiting page withdraws it; an administrator’s edit does not', async () => {
    const { people, page, send } = await site()
    const key = await page('Terms')
    await send(key)
    const save = (by: Harness, text: string) =>
      by.put(`${V1}/document/${key}`, {
        template: null,
        values: [{ alias: 'body', culture: null, segment: null, value: text }],
        variants: [{ culture: null, segment: null, name: 'Terms' }],
      })
    expect((await save(people.admin, 'fixed a typo')).status).toBe(200)
    let tab = await people.writer.json<{ request?: View }>(`${API}/page/${key}`)
    expect(tab.request?.history.map((h) => h.kind)).toEqual(['sent', 'edited'])

    expect((await save(people.writer, 'changed it')).status).toBe(200)
    tab = await people.writer.json<{ request?: View; past: View[] }>(`${API}/page/${key}`)
    expect(tab.request).toBeUndefined()
  })

  test('a locked page refuses an edit while it waits', async () => {
    const { people, page, send } = await site(
      WORKFLOW_TOML().replace('on-edit = "withdraw"', 'on-edit = "lock"'),
    )
    const key = await page('Locked')
    await send(key)
    const refused = await people.writer.put(`${V1}/document/${key}`, {
      template: null,
      values: [{ alias: 'body', culture: null, segment: null, value: 'no' }],
      variants: [{ culture: null, segment: null, name: 'Locked' }],
    })
    expect(refused.status).toBe(400)
    expect((await refused.json()).detail).toContain('waiting for approval')
  })

  test('taking a page down goes through the workflow too', async () => {
    const { people, page, send, act, published } = await site()
    const key = await page('Old policy')
    let request = await send(key)
    for (const who of [people.legal, people.brand, people.editor, people.admin])
      await act(request.key, 'approve', who)
    expect(await published(key)).toBe('Published')
    expect(
      (await people.editor.put(`${V1}/document/${key}/unpublish`, { cultures: null })).status,
    ).toBe(400)
    request = await send(key, people.writer, 'unpublish')
    for (const who of [people.legal, people.brand, people.editor, people.admin])
      await act(request.key, 'approve', who)
    expect(await published(key)).not.toBe('Published')
  })

  test('the designer saves a workflow; requests in flight restart under the new one', async () => {
    const { people, page, send, act } = await site()
    const key = await page('Restart me')
    const sent = await send(key)
    await act(sent.key, 'approve', people.legal)

    const current = await people.admin.json<{
      items: Array<Record<string, unknown>>
      editable: boolean
    }>(`${API}/workflows`)
    expect(current.editable).toBe(true)
    const workflow = current.items[0] as Record<string, unknown> & {
      stages: Array<Record<string, unknown>>
    }
    // Drop the brand stage: legal goes straight to editorial.
    const changed = {
      ...workflow,
      stages: workflow.stages
        .filter((s) => s.alias !== 'brand')
        .map((s) => (s.alias === 'legal' ? { ...s, next: ['editorial'] } : s)),
    }
    const preview = await people.admin.post(`${API}/workflows/policy-sign-off/preview`, {
      workflow: changed,
    })
    expect((await preview.json()).affected).toEqual([
      { key: sent.key, page: 'Restart me', outcome: 'restart' },
    ])
    expect(
      (await people.writer.put(`${API}/workflows/policy-sign-off`, { workflow: changed })).status,
    ).toBe(403)
    const saved = await people.admin.put(`${API}/workflows/policy-sign-off`, { workflow: changed })
    expect(saved.status, await saved.clone().text()).toBe(200)

    const tab = await people.writer.json<{ request: View }>(`${API}/page/${key}`)
    expect(tab.request.stages.map((s) => s.alias)).toEqual(['legal', 'editorial', 'final'])
    expect(states(tab.request)).toMatchObject({ legal: 'waiting', editorial: 'pending' })
    expect(tab.request.history.map((h) => h.kind)).toContain('restarted')

    // A loop is refused before anything is written.
    const looped = {
      ...changed,
      stages: changed.stages.map((s) => (s.alias === 'final' ? { ...s, next: ['legal'] } : s)),
    }
    const refused = await people.admin.put(`${API}/workflows/policy-sign-off`, { workflow: looped })
    expect(refused.status).toBe(400)
  })

  test('what waits for me, and what is in flight', async () => {
    const { people, page, send } = await site()
    await send(await page('One'))
    await send(await page('Two'))
    const mine = await people.legal.json<{ items: View[] }>(`${API}/waiting`)
    expect(mine.items).toHaveLength(2)
    expect((await people.brand.json<{ items: View[] }>(`${API}/waiting`)).items).toEqual([])
    expect((await people.admin.json<{ items: View[] }>(`${API}/in-flight`)).items).toHaveLength(2)
  })

  test('asking about a page needs Read and Update on it, inside one’s start nodes (088)', async () => {
    const { people, page } = await site()
    const theirs = await page('Theirs')
    const mine = await page('Mine')
    const group = async (alias: string, startNode: string | null, verbs: string[]) => {
      const created = await people.admin.post(`${V1}/user-group`, {
        name: alias,
        alias,
        sections: ['Umb.Section.Content', 'Crombolo.Section.Workflow'],
        languages: [],
        hasAccessToAllLanguages: true,
        documentRootAccess: startNode === null,
        documentStartNode: startNode ? { id: startNode } : null,
        mediaRootAccess: false,
        mediaStartNode: null,
        elementRootAccess: false,
        elementStartNode: null,
        fallbackPermissions: verbs,
        permissions: [],
      })
      expect(created.status).toBe(201)
      const person = await signInAsGroup(people.admin, alias)
      open.push(person)
      return person
    }
    const elsewhere = await group('elsewhere', mine, ['Umb.Document.Read', 'Umb.Document.Update'])
    const readers = await group('readers', null, ['Umb.Document.Read'])

    for (const action of ['publish', 'unpublish'])
      expect((await elsewhere.post(`${API}/page/${theirs}/send`, { action })).status, action).toBe(
        403,
      )
    expect((await elsewhere.call(`${API}/page/${theirs}`)).status).toBe(403)
    expect((await readers.post(`${API}/page/${theirs}/send`, { action: 'publish' })).status).toBe(
      403,
    )
    expect((await readers.call(`${API}/page/${theirs}`)).status).toBe(200)
    // Nothing was recorded
    expect(
      (await people.admin.json<{ request?: View }>(`${API}/page/${theirs}`)).request,
    ).toBeUndefined()

    // Inside its start node, the same group may ask
    expect((await elsewhere.call(`${API}/page/${mine}`)).status).toBe(200)
    expect((await elsewhere.post(`${API}/page/${mine}/send`, { action: 'publish' })).status).toBe(
      200,
    )
  })
})

/** Legal alone, nothing else set: a workflow that does not allow a time. */
const ONE_STAGE_PLAIN = `[workflow]
alias = "plain"
name = "Plain sign-off"
applies-to = { branches = [], content-types = ["policy"] }
publishers-may-skip = false

[[stage]]
alias = "legal"
approvers = ["legal"]
`

describe(`each workflow's settings (${dialectUnderTest})`, () => {
  /** Legal alone, then final: the smallest graph each setting can be seen on. */
  const ONE_STAGE = (settings: Record<string, string>, legal: Record<string, string> = {}) => {
    const lines = Object.entries(settings).map(([k, v]) => `${k} = ${v}`)
    const stage = Object.entries(legal).map(([k, v]) => `${k} = ${v}`)
    return `[workflow]
alias = "policy-sign-off"
name = "Policy sign-off"
applies-to = { branches = [], content-types = ["policy"] }
${lines.join('\n')}

[[stage]]
alias = "legal"
approvers = ["legal"]
${stage.join('\n')}
`
  }

  test('publishers may skip, when the workflow lets them', async () => {
    const { people, page } = await site(ONE_STAGE({ 'publishers-may-skip': 'true' }))
    const key = await page('Skippable')
    expect(
      (await people.editor.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status,
    ).toBe(200)
  })

  test('a stage needing two waits for a second, different, approver', async () => {
    const { people, page, send, act, published } = await site(
      ONE_STAGE({ 'publishers-may-skip': 'false' }, { required: '2' }),
    )
    const second = await signInAsGroup(people.admin, 'legal', 'legal2@example.com')
    open.push(second)
    const key = await page('Twice')
    const sent = await send(key)
    const once = (await (await act(sent.key, 'approve', people.legal)).json()) as View
    expect(once.stages[0]).toMatchObject({ state: 'waiting', approvals: 1, needed: 2 })
    expect((await act(sent.key, 'approve', people.legal)).status).toBe(403)
    await act(sent.key, 'approve', second)
    expect(await published(key)).toBe('Published')
  })

  test('automatic: a stage the sender belongs to counts them as approving', async () => {
    const { people, page, send, published } = await site(
      ONE_STAGE({ 'publishers-may-skip': 'false', 'self-approval': '"automatic"' }),
    )
    const key = await page('Auto', people.legal)
    const sent = await send(key, people.legal)
    expect(sent.state).toBe('approved')
    expect(sent.history.map((h) => h.kind)).toEqual(['sent', 'approved', 'published'])
    expect(await published(key)).toBe('Published')
  })

  test('comments always: an approval needs one too', async () => {
    const { people, page, send, act } = await site(
      ONE_STAGE({ 'publishers-may-skip': 'false', comments: '"always"' }),
    )
    const sent = await send(await page('Say why'))
    expect((await act(sent.key, 'approve', people.legal)).status).toBe(400)
    expect((await act(sent.key, 'approve', people.legal, { comment: 'fine' })).status).toBe(200)
  })

  test('approve-latest: an edit goes into the request, and the latest is what publishes', async () => {
    const { people, page, send, act } = await site(
      ONE_STAGE({ 'publishers-may-skip': 'false', 'on-edit': '"approve-latest"' }),
    )
    const key = await page('Latest')
    const sent = await send(key)
    await people.writer.put(`${V1}/document/${key}`, {
      template: null,
      values: [{ alias: 'body', culture: null, segment: null, value: 'the latest words' }],
      variants: [{ culture: null, segment: null, name: 'Latest' }],
    })
    await act(sent.key, 'approve', people.legal)
    const live = await people.admin.json<{ values: Array<{ alias: string; value: unknown }> }>(
      `${V1}/document/${key}/published`,
    )
    expect(live.values.find((v) => v.alias === 'body')?.value).toBe('the latest words')
  })

  test('lock-after-first-approval: editable until someone approves', async () => {
    const { people, page, send, act } = await site(`${ONE_STAGE(
      { 'publishers-may-skip': 'false', 'on-edit': '"lock-after-first-approval"' },
      { next: '["final"]' },
    )}
[[stage]]
alias = "final"
approvers = ["admin"]
`)
    const key = await page('Lockable')
    const sent = await send(key)
    const save = (text: string) =>
      people.writer.put(`${V1}/document/${key}`, {
        template: null,
        values: [{ alias: 'body', culture: null, segment: null, value: text }],
        variants: [{ culture: null, segment: null, name: 'Lockable' }],
      })
    expect((await save('still editable')).status).toBe(200)
    await act(sent.key, 'approve', people.legal)
    expect((await save('too late')).status).toBe(400)
  })

  test('on-change keep and withdraw', async () => {
    for (const rule of ['keep', 'withdraw'] as const) {
      const { people, page, send } = await site(
        ONE_STAGE({ 'publishers-may-skip': 'false', 'on-change': `"${rule}"` }),
      )
      const key = await page(`On change ${rule}`)
      await send(key)
      const { items } = await people.admin.json<{ items: Array<Record<string, unknown>> }>(
        `${API}/workflows`,
      )
      const saved = await people.admin.put(`${API}/workflows/policy-sign-off`, {
        workflow: { ...items[0], comments: 'always' },
      })
      expect(saved.status).toBe(200)
      const tab = await people.writer.json<{ request?: View }>(`${API}/page/${key}`)
      if (rule === 'keep') expect(tab.request?.state).toBe('waiting')
      else expect(tab.request).toBeUndefined()
    }
    // Two sites, booted one after the other: more than the default allows on a busy Postgres.
  }, 20_000)

  test('a branch is covered by the workflow naming it, nearest first; new pages are gated too', async () => {
    const { people, page } = await site(ONE_STAGE({ 'publishers-may-skip': 'false' }))
    // Narrow the workflow from the type to one branch.
    const root = await page('Policies', people.admin)
    const { items } = await people.admin.json<{ items: Array<Record<string, unknown>> }>(
      `${API}/workflows`,
    )
    const saved = await people.admin.put(`${API}/workflows/policy-sign-off`, {
      workflow: { ...items[0], appliesTo: { branches: [root], contentTypes: [] } },
    })
    expect(saved.status, await saved.clone().text()).toBe(200)
    const outside = await page('Elsewhere', people.admin)
    expect(
      (await people.editor.put(`${V1}/document/${outside}/publish`, { publishSchedules: [] }))
        .status,
    ).toBe(200)
    const typeKey = (await new ContentTypeRepository(people.admin.server.db).byAlias('policy'))?.key
    const inside = await people.editor.post(`${V1}/document/create-and-publish`, {
      documentType: { id: typeKey },
      template: null,
      parent: { id: root },
      values: [],
      variants: [{ culture: null, segment: null, name: 'Child' }],
    })
    expect(inside.status).toBe(400)
    expect((await inside.json()).detail).toContain('needs approval through "Policy sign-off"')
  })
})

describe(`scheduled publishing through approval (${dialectUnderTest})`, () => {
  /** Legal alone, a request may carry a time; other settings as given. */
  const TIMED = (settings: Record<string, string> = {}) => {
    const lines = Object.entries({
      'publishers-may-skip': 'false',
      scheduling: 'true',
      ...settings,
    }).map(([k, v]) => `${k} = ${v}`)
    return `[workflow]
alias = "timed"
name = "Timed sign-off"
applies-to = { branches = [], content-types = ["policy"] }
${lines.join('\n')}

[[stage]]
alias = "legal"
approvers = ["legal"]
`
  }
  const inAnHour = () => new Date(Date.now() + 3600_000)
  const later = (date: Date, ms = 1000) => new Date(date.getTime() + ms)

  async function timedSite(settings: Record<string, string> = {}) {
    const s = await site(TIMED(settings))
    const sendAt = (
      key: string,
      schedule: unknown,
      action = 'publish',
      cultures: string[] | null = null,
    ) => s.people.writer.post(`${API}/page/${key}/send`, { action, schedule, cultures })
    const tab = (key: string) =>
      s.people.writer.json<{ request?: View; past: View[] }>(`${API}/page/${key}`)
    const run = (now: Date) => s.people.admin.server.jobs.runScheduledPublishing(now)
    const save = (by: Harness, key: string, text: string, name = 'Timed') =>
      by.put(`${V1}/document/${key}`, {
        template: null,
        values: [{ alias: 'body', culture: null, segment: null, value: text }],
        variants: [{ culture: null, segment: null, name }],
      })
    return { ...s, sendAt, tab, run, save }
  }

  test('a time is refused when the workflow does not allow one, or it makes no sense', async () => {
    const plain = await site(ONE_STAGE_PLAIN)
    const key = await plain.page('No times')
    const refused = await plain.people.writer.post(`${API}/page/${key}/send`, {
      action: 'publish',
      schedule: [{ culture: null, publishTime: inAnHour().toISOString() }],
    })
    expect(refused.status).toBe(400)
    expect((await refused.json()).message).toContain('does not let a request say when')

    const { page, sendAt } = await timedSite({ unpublish: 'true' })
    const page2 = await page('Bad times')
    const message = async (response: Response) => {
      expect(response.status).toBe(400)
      return (await response.json()).message as string
    }
    const hour = inAnHour()
    expect(
      await message(
        await sendAt(page2, [{ culture: null, publishTime: new Date(Date.now() - 1000) }]),
      ),
    ).toContain('in the future')
    expect(
      await message(
        await sendAt(page2, [
          { culture: null, publishTime: hour, unpublishTime: new Date(hour.getTime() - 60_000) },
        ]),
      ),
    ).toContain('taken down after it is published')
    expect(
      await message(await sendAt(page2, [{ culture: null, publishTime: hour }], 'unpublish')),
    ).toContain('only say when to take it down')
    expect(await message(await sendAt(page2, [{ culture: 'en-US', publishTime: hour }]))).toContain(
      'not one of the languages',
    )
    expect(await message(await sendAt(page2, [{ culture: null, publishTime: 'soon' }]))).toContain(
      'in the future',
    )
  }, 20_000)

  test('approval schedules it; the job publishes at the time, not before', async () => {
    const { people, page, sendAt, act, published, tab, run } = await timedSite()
    const key = await page('Launch')
    const at = inAnHour()
    const sent = await sendAt(key, [{ culture: null, publishTime: at.toISOString() }])
    expect(sent.status, await sent.clone().text()).toBe(200)
    const view = (await sent.json()) as View
    expect(view.schedule).toEqual([
      { culture: null, publishTime: at.toISOString(), unpublishTime: null },
    ])
    expect(view.history[0]?.comment).toContain('to be published at')

    const decided = (await (await act(view.key, 'approve', people.legal)).json()) as View
    expect(decided.state).toBe('scheduled')
    expect(decided.history.map((h) => h.kind)).toEqual(['sent', 'approved', 'scheduled'])
    expect(await published(key)).not.toBe('Published')
    // Approvers see it in flight, with the time; a scheduled request is not waiting on them.
    const flight = await people.legal.json<{ items: View[] }>(`${API}/in-flight`)
    expect(flight.items.map((i) => i.state)).toEqual(['scheduled'])
    expect((await people.legal.json<{ items: View[] }>(`${API}/waiting`)).items).toEqual([])

    expect((await run(new Date(at.getTime() - 60_000))).published).toEqual([])
    expect((await tab(key)).request?.state).toBe('scheduled')
    expect((await run(later(at))).published).toEqual([key])
    expect(await published(key)).toBe('Published')
    const done = await tab(key)
    expect(done.request).toBeUndefined()
    expect(done.past[0]?.state).toBe('approved')
    expect(done.past[0]?.history.map((h) => h.kind)).toEqual([
      'sent',
      'approved',
      'scheduled',
      'published',
    ])
  })

  test('a time that passed before approval publishes at once, and says so', async () => {
    const { people, page, sendAt, act, published } = await timedSite()
    const key = await page('Late')
    const sent = (await (
      await sendAt(key, [{ culture: null, publishTime: new Date(Date.now() + 1200) }])
    ).json()) as View
    await Bun.sleep(1300)
    const done = (await (await act(sent.key, 'approve', people.legal)).json()) as View
    expect(done.state).toBe('approved')
    expect(done.history.at(-1)).toMatchObject({
      kind: 'published',
      comment: 'the requested time had passed when it was approved',
    })
    expect(await published(key)).toBe('Published')
  })

  test('a publish time with a take-down time: the take-down stays scheduled once it is live', async () => {
    const { people, page, sendAt, act, published, tab, run } = await timedSite()
    const key = await page('Campaign')
    const at = inAnHour()
    const down = later(at, 3600_000)
    const sent = (await (
      await sendAt(key, [{ culture: null, publishTime: at, unpublishTime: down }])
    ).json()) as View
    await act(sent.key, 'approve', people.legal)
    await run(later(at))
    expect(await published(key)).toBe('Published')
    expect((await tab(key)).past[0]?.state).toBe('approved')
    expect((await run(later(down))).unpublished).toEqual([key])
    expect(await published(key)).not.toBe('Published')
  })

  test('a request to take the page down at a time', async () => {
    const { people, page, sendAt, act, published, run } = await timedSite({ unpublish: 'true' })
    const key = await page('Retire')
    const first = (await (await sendAt(key, null)).json()) as View
    await act(first.key, 'approve', people.legal)
    expect(await published(key)).toBe('Published')
    const at = inAnHour()
    const sent = (await (
      await sendAt(key, [{ culture: null, unpublishTime: at }], 'unpublish')
    ).json()) as View
    const decided = (await (await act(sent.key, 'approve', people.legal)).json()) as View
    expect(decided.state).toBe('scheduled')
    expect(await published(key)).toBe('Published')
    expect((await run(later(at))).unpublished).toEqual([key])
    expect(await published(key)).not.toBe('Published')
  })

  test('withdraw: saving a scheduled page ends the request and its schedule', async () => {
    const { people, page, sendAt, act, published, tab, run, save } = await timedSite()
    const key = await page('Edited')
    const at = inAnHour()
    const sent = (await (await sendAt(key, [{ culture: null, publishTime: at }])).json()) as View
    await act(sent.key, 'approve', people.legal)
    // An administrator's edit goes into the request.
    expect((await save(people.admin, key, 'tidied')).status).toBe(200)
    expect((await tab(key)).request?.history.at(-1)?.kind).toBe('edited')
    expect((await save(people.writer, key, 'unapproved words')).status).toBe(200)
    const after = await tab(key)
    expect(after.request).toBeUndefined()
    expect(after.past[0]?.state).toBe('withdrawn')
    expect((await run(later(at))).published).toEqual([])
    expect(await published(key)).not.toBe('Published')
  })

  test('lock: a scheduled page cannot be changed until its time', async () => {
    const { people, page, sendAt, act, save } = await timedSite({ 'on-edit': '"lock"' })
    const key = await page('Locked in')
    const sent = (await (
      await sendAt(key, [{ culture: null, publishTime: inAnHour() }])
    ).json()) as View
    await act(sent.key, 'approve', people.legal)
    const refused = await save(people.writer, key, 'no')
    expect(refused.status).toBe(400)
    expect((await refused.json()).detail).toContain('approved and will be published at')
  })

  test('approve-latest: an edit while scheduled is what goes out', async () => {
    const { people, page, sendAt, act, run, save } = await timedSite({
      'on-edit': '"approve-latest"',
    })
    const key = await page('Latest')
    const at = inAnHour()
    const sent = (await (await sendAt(key, [{ culture: null, publishTime: at }])).json()) as View
    await act(sent.key, 'approve', people.legal)
    expect((await save(people.writer, key, 'the final words')).status).toBe(200)
    await run(later(at))
    const live = await people.admin.json<{ values: Array<{ alias: string; value: unknown }> }>(
      `${V1}/document/${key}/published`,
    )
    expect(live.values.find((v) => v.alias === 'body')?.value).toBe('the final words')
  })

  test('withdrawing a scheduled request clears its schedule; sending again takes a new time', async () => {
    const { people, page, sendAt, act, published, run } = await timedSite()
    const key = await page('Moved')
    const at = inAnHour()
    const sent = (await (await sendAt(key, [{ culture: null, publishTime: at }])).json()) as View
    await act(sent.key, 'approve', people.legal)
    const again = await sendAt(key, [{ culture: null, publishTime: later(at, 60_000) }])
    expect(again.status).toBe(409)
    expect((await again.json()).message).toContain('Withdraw that request')
    expect((await act(sent.key, 'withdraw', people.writer)).status).toBe(200)
    expect((await run(later(at))).published).toEqual([])
    expect(await published(key)).not.toBe('Published')
    expect((await sendAt(key, [{ culture: null, publishTime: later(at, 60_000) }])).status).toBe(
      200,
    )
  })

  test('a direct publish by someone who may skip the workflow supersedes it', async () => {
    const { people, page, sendAt, act, tab } = await timedSite({ 'publishers-may-skip': 'true' })
    const key = await page('Overtaken')
    const sent = (await (
      await sendAt(key, [{ culture: null, publishTime: inAnHour() }])
    ).json()) as View
    await act(sent.key, 'approve', people.legal)
    expect(
      (await people.editor.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status,
    ).toBe(200)
    const after = await tab(key)
    expect(after.request).toBeUndefined()
    expect(after.past[0]?.state).toBe('superseded')
    expect(after.past[0]?.history.at(-1)?.comment).toContain('published it directly')
  })

  test('a page that cannot be published at its time goes back to its editor', async () => {
    const { people, page, sendAt, act, tab, run } = await timedSite({
      'publishers-may-skip': 'true',
    })
    const parent = await page('Parent', people.admin)
    expect(
      (await people.admin.put(`${V1}/document/${parent}/publish`, { publishSchedules: [] })).status,
    ).toBe(200)
    const typeKey = (await new ContentTypeRepository(people.admin.server.db).byAlias('policy'))?.key
    const created = await people.writer.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: null,
      parent: { id: parent },
      values: [],
      variants: [{ culture: null, segment: null, name: 'Child' }],
    })
    expect(created.status).toBe(201)
    const child = created.headers.get('umb-generated-resource') as string
    const at = inAnHour()
    const sent = (await (await sendAt(child, [{ culture: null, publishTime: at }])).json()) as View
    await act(sent.key, 'approve', people.legal)
    expect(
      (await people.admin.put(`${V1}/document/${parent}/unpublish`, { cultures: null })).status,
    ).toBe(200)
    expect((await run(later(at))).failed.map((f) => f.key)).toEqual([child])
    const after = await tab(child)
    expect(after.past[0]?.state).toBe('sent-back')
    expect(after.past[0]?.history.at(-1)?.comment).toContain('could not be published')
  })

  test('a scheduled page moved to the recycle bin: the request ends', async () => {
    const { people, page, sendAt, act, run } = await timedSite()
    const key = await page('Binned')
    const sent = (await (
      await sendAt(key, [{ culture: null, publishTime: inAnHour() }])
    ).json()) as View
    await act(sent.key, 'approve', people.legal)
    expect((await people.admin.put(`${V1}/document/${key}/move-to-recycle-bin`, {})).status).toBe(
      200,
    )
    await run(new Date())
    const history = await people.admin.json<{ items: View[] }>(`${API}/history`)
    const ended = history.items.find((i) => i.key === sent.key)
    expect(ended?.state).toBe('withdrawn')
    expect(ended?.history.at(-1)?.comment).toBe('the page was moved to the recycle bin')
  })

  test('a schedule removed some other way (an import, the command line) ends the request', async () => {
    const { people, page, sendAt, act } = await timedSite()
    const key = await page('Cleared')
    const sent = (await (
      await sendAt(key, [{ culture: null, publishTime: inAnHour() }])
    ).json()) as View
    await act(sent.key, 'approve', people.legal)
    await new DocumentRepository(people.admin.server.db).setSchedule(key, [
      { culture: null, publishTime: null, unpublishTime: null },
    ])
    await people.admin.server.jobs.runScheduledPublishing(new Date())
    const history = await people.admin.json<{ items: View[] }>(`${API}/history`)
    const ended = history.items.find((i) => i.key === sent.key)
    expect(ended?.state).toBe('withdrawn')
    expect(ended?.history.at(-1)?.comment).toBe('the schedule was removed')
  })

  test('a workflow change leaves a scheduled request alone', async () => {
    const { people, page, sendAt, act, tab } = await timedSite({ 'on-change': '"withdraw"' })
    const key = await page('Steady')
    const sent = (await (
      await sendAt(key, [{ culture: null, publishTime: inAnHour() }])
    ).json()) as View
    await act(sent.key, 'approve', people.legal)
    const { items } = await people.admin.json<{ items: Array<Record<string, unknown>> }>(
      `${API}/workflows`,
    )
    const preview = await people.admin.post(`${API}/workflows/timed/preview`, {
      workflow: { ...items[0], comments: 'always' },
    })
    expect((await preview.json()).affected ?? []).toEqual([])
    const saved = await people.admin.put(`${API}/workflows/timed`, {
      workflow: { ...items[0], comments: 'always' },
    })
    expect(saved.status).toBe(200)
    expect((await tab(key)).request?.state).toBe('scheduled')
  })
})

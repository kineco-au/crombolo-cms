/**
 * Story 298: site code writes pages through `site().content`, as the API user the
 * config's `content.actAs` names, and handles content events from `events`, each
 * run as a site job.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { route } from '@crombolo/common'
import type { Result } from '@crombolo/core'
import {
  AuditLog,
  DbDate,
  defineSiteTables,
  JobRepository,
  type TablesDatabase,
} from '@crombolo/data'
import type { SiteContentEvent, SiteServices } from '@crombolo/render'
import { type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

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

const CLIENT = { id: 'crombolo-back-office-site-code', secret: 'a-site-code-secret-1' }

const LISTING = `[content-type]
alias = "listing"
name = "Listing"
allow-at-root = true
allow-children = ["listing"]
components = ["listing"]
default-component = "listing"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
mandatory = true

[[property]]
alias = "price"
name = "Price"
type = "textstring"
`

const tables = defineSiteTables([
  {
    name: 'listing-index',
    release: '1.0.0',
    up: (s) => s.createTable('listing_index', { key: s.text().primaryKey(), title: s.text() }),
  },
])
type Tables = TablesDatabase<typeof tables>

type Written = Result<{ key: string }, 400 | 403 | 404 | 422>
const answer = (result: Written) =>
  result.isOk()
    ? Response.json({ ok: true, key: result.value.key })
    : Response.json(
        { ok: false, status: result.status, message: result.message, errors: result.errors },
        { status: result.status },
      )

/** A site whose code creates, publishes and indexes listings. */
async function site(
  options: { actAs?: boolean; events?: Record<string, unknown>; workflow?: boolean } = {},
) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'site-content-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'listing.toml'), LISTING)
  if (options.workflow) {
    mkdirSync(join(root, 'schema', 'workflows'), { recursive: true })
    writeFileSync(
      join(root, 'schema', 'workflows', 'gated.toml'),
      `[workflow]\nalias = "gated"\nname = "Gated"\napplies-to = { branches = [], content-types = ["listing"] }\npublishers-may-skip = false\n\n[[stage]]\nalias = "review"\napprovers = ["admin"]\n`,
    )
  }
  writeFileSync(
    join(root, 'components', 'listing.tsx'),
    'export default function Listing({ model }) { return <h1>{model.name}</h1> }\n',
  )
  const listings = {
    async publish(form: FormData, { site }: { site: () => SiteServices }) {
      return answer(await site().content.publish(String(form.get('key'))))
    },
  }
  const routes = [
    route('/listings', {
      async POST(request, { site }) {
        const body = (await request.json()) as { name: string; values: Record<string, unknown> }
        return answer(
          await (site() as SiteServices).content.create({
            parent: null,
            contentType: 'listing',
            name: body.name,
            values: body.values,
          }),
        )
      },
    }),
    route('/listings/:key', {
      async GET(_request, { site, params }) {
        const found = await (site() as SiteServices).content.get(params.key as string)
        return found.isOk()
          ? Response.json(found.value)
          : new Response(null, { status: found.status })
      },
    }),
  ]
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      apiClient: CLIENT,
      ...(options.actAs === false ? {} : { content: { actAs: CLIENT.id } }),
      database: { tables },
      actions: { listings } as never,
      routes: routes as never,
      ...(options.events ? { events: options.events as never } : {}),
    },
  })
  open.push(h)
  h.server.jobs.stop()
  const create = (name: string, values: Record<string, unknown>) =>
    h.call('/listings', {
      method: 'POST',
      body: JSON.stringify({ name, values }),
      headers: { 'content-type': 'application/json' },
    })
  const publish = (key: string) =>
    h.server.fetch(
      new Request(`${ORIGIN}/crombolo/actions/listings.publish`, {
        method: 'POST',
        body: new URLSearchParams({ key }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
      }),
    )
  /** The outbox, then deliveries, then the site's jobs, as the background loop runs them. */
  const settle = async () => {
    await h.server.jobs.runEvents()
    await h.server.jobs.runWebhooks()
    await h.server.backgroundJobs.runDue()
  }
  return { h, create, publish, settle }
}

describe('site().content', () => {
  test('a route creates a draft and an action publishes it, both audited as the API user', async () => {
    const { h, create, publish } = await site()
    const made = await create('Harbour view', { title: 'Harbour view', price: '450000' })
    expect(made.status, await made.clone().text()).toBe(200)
    const { key } = (await made.json()) as { key: string }

    const read = (await (await h.call(`/listings/${key}`)).json()) as Record<string, unknown>
    expect(read).toMatchObject({
      key,
      contentType: 'listing',
      name: 'Harbour view',
      values: { title: 'Harbour view', price: '450000' },
      published: false,
    })

    const published = await publish(key)
    expect(published.status, await published.clone().text()).toBe(200)
    const doc = await h.json<{ variants: Array<{ state: string }> }>(`${V1}/document/${key}`)
    expect(doc.variants[0]?.state).toBe('Published')

    const audit = (await new AuditLog(h.server.db).query({}, { skip: 0, take: 50 })).items.filter(
      (entry) => entry.entityKey === key,
    )
    const details = audit.map((entry) => `${entry.userName}: ${entry.detail}`)
    expect(details).toContain('API client: Through route POST /listings')
    expect(details).toContain('API client: Through action listings.publish')
  })

  test('invalid values answer unprocessableContent with the fields', async () => {
    const { create, publish } = await site()
    const unknown = await create('Odd', { title: 'Odd', colour: 'red' })
    expect(unknown.status).toBe(422)
    expect(
      ((await unknown.json()) as { errors: { field: string }[] }).errors.map((e) => e.field),
    ).toEqual(['colour'])
    // A draft may be incomplete, as in the back office; publishing it is checked.
    const draft = await create('No title', { price: '1' })
    expect(draft.status).toBe(200)
    const { key } = (await draft.json()) as { key: string }
    const missing = await publish(key)
    expect(missing.status).toBe(422)
    expect(
      ((await missing.json()) as { errors: { field: string }[] }).errors.map((e) => e.field),
    ).toContain('title')
  })

  test('a write outside the API user’s start node answers forbidden', async () => {
    const { h, create } = await site()
    const elsewhere = (await (await create('Elsewhere', { title: 'Elsewhere' })).json()) as {
      key: string
    }
    const home = (await (await create('Home', { title: 'Home' })).json()) as { key: string }
    // The API user is narrowed to Home after the boot; it is read again for each write.
    const users = await h.json<{ items: Array<{ id: string; userName: string }> }>(
      `${V1}/user?take=100`,
    )
    const apiUser = users.items.find((u) => u.userName === CLIENT.id) as { id: string }
    const detail = await h.json<{ userGroupIds: Array<{ id: string }> }>(`${V1}/user/${apiUser.id}`)
    // Story 339: a user works where their groups do, so a group narrows it.
    const first = await h.json<{ fallbackPermissions: string[]; sections: string[] }>(
      `${V1}/user-group/${detail.userGroupIds[0]?.id}`,
    )
    const narrow = await h.post(`${V1}/user-group`, {
      name: 'Home only',
      alias: 'homeOnly',
      sections: first.sections,
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: false,
      documentStartNode: { id: home.key },
      mediaRootAccess: true,
      mediaStartNode: null,
      elementRootAccess: true,
      elementStartNode: null,
      fallbackPermissions: first.fallbackPermissions,
      permissions: [],
    })
    expect(narrow.status, await narrow.clone().text()).toBe(201)
    const updated = await h.put(`${V1}/user/${apiUser.id}`, {
      ...detail,
      email: 'site-code@example.com',
      userName: 'site-code@example.com',
      userGroupIds: [{ id: narrow.headers.get('umb-generated-resource') }],
    })
    expect(updated.status, await updated.text()).toBeLessThan(300)
    expect((await h.call(`/listings/${elsewhere.key}`)).status).toBe(404)
    const refused = await h.server.fetch(
      new Request(`${ORIGIN}/crombolo/actions/listings.publish`, {
        method: 'POST',
        body: new URLSearchParams({ key: elsewhere.key }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
      }),
    )
    expect(refused.status).toBe(403)
  })

  test('without actAs, each write answers forbidden, saying why', async () => {
    const { create } = await site({ actAs: false })
    const refused = await create('Nope', { title: 'Nope' })
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { message: string }).message).toContain('content.actAs')
  })

  test('a publish an approval workflow gates answers that it needs approval', async () => {
    const { create, publish } = await site({ workflow: true })
    const { key } = (await (await create('Gated', { title: 'Gated' })).json()) as { key: string }
    const held = await publish(key)
    expect(held.status).toBe(400)
    expect(((await held.json()) as { message: string }).message).toContain('needs approval')
  })
})

describe('the config’s events', () => {
  test('a ContentPublish handler writes to the site’s tables, and runs again after a failure', async () => {
    let calls = 0
    let indexed = 0
    const seen: SiteContentEvent[] = []
    const { h, create, publish, settle } = await site({
      events: {
        'Umbraco.ContentPublish': async (event: SiteContentEvent, { db }: { db: Tables }) => {
          calls++
          seen.push(event)
          if (calls === 1) throw new Error('not yet')
          await db
            .insertInto('listing_index')
            .values({ key: event.key, title: 'indexed' })
            .execute()
          indexed = (await db.selectFrom('listing_index').selectAll().execute()).length
        },
      },
    })
    const { key } = (await (await create('Indexed', { title: 'Indexed' })).json()) as {
      key: string
    }
    expect((await publish(key)).status).toBe(200)
    await settle()
    expect(calls).toBe(1)
    const jobs = await new JobRepository(h.server.db).list({ owner: 'site' })
    const job = jobs.items.find((j) => j.name === 'crombolo:event') as { id: string; state: string }
    expect(job.state).toBe('queued')
    // Retried on the jobs' back-off: brought forward rather than waited for.
    await h.server.db.q
      .updateTable('job')
      .set({ next_attempt_at: DbDate.toDb(new Date(Date.now() - 1000)) })
      .where('id', '=', job.id)
      .execute()
    await h.server.backgroundJobs.runDue()
    expect(calls).toBe(2)
    expect(seen[0]).toMatchObject({
      alias: 'Umbraco.ContentPublish',
      key,
      contentType: 'listing',
      actor: { kind: 'user', name: 'API client' },
    })
    expect(indexed).toBe(1)
  })

  test('a handler that updates its own page is not called again for that change', async () => {
    let calls = 0
    const { create, settle } = await site({
      events: {
        'Umbraco.ContentSaved': async (
          event: SiteContentEvent,
          { site }: { site: SiteServices },
        ) => {
          calls++
          const updated = await site.content.update(event.key, { values: { price: 'checked' } })
          if (!updated.isOk()) throw new Error(updated.message)
        },
      },
    })
    expect((await create('Checked', { title: 'Checked' })).status).toBe(200)
    await settle()
    await settle()
    expect(calls).toBe(1)
  })
})

describe('the boot', () => {
  test('refuses an unknown event name, and an actAs that names no API user', async () => {
    const root = mkdtempSync(join(process.cwd(), 'output', 'site-content-boot-'))
    dirs.push(root)
    await expect(
      signedInServer({
        config: { siteDir: root, events: { 'Umbraco.Nothing': () => {} } as never },
      }),
    ).rejects.toThrow('not an event this site raises')
    await expect(
      signedInServer({ config: { siteDir: root, content: { actAs: 'nobody' } } }),
    ).rejects.toThrow('no API user')
  })
})

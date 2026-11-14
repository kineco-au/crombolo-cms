/**
 * Story 346: an extension granted or turned on while the site runs starts at
 * once, with no restart: its process, its routes, its jobs, its event handlers
 * and its tables. Turning it off stops its process; removing it unmounts it;
 * another node on the same database follows.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { route, type SiteRoute } from '@crombolo/common'
import type { ServerHandle } from '@crombolo/server'
import { siteDeclaring } from './support/bundles.ts'
import {
  createPage,
  type TreeSite,
  treeOps,
  treeSite,
  writeTreeSchema,
} from './support/content-tree.ts'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, bootServer, type Harness, ORIGIN, V1 } from './support/harness.ts'

const sites: TreeSite[] = []
const servers: ServerHandle[] = []
afterEach(async () => {
  while (servers.length > 0)
    await servers
      .pop()
      ?.close()
      .catch(() => {})
  while (sites.length > 0) await sites.pop()?.close()
})

const LIVE = `import { defineBundleTables, route } from '@crombolo/extension'

export function live() {
  return {
    id: 'live',
    section: 'settings',
    capabilities: ['log'],
    tables: defineBundleTables('live', [
      {
        name: 'notes',
        release: '1.0.0',
        up: (s) => s.createTable('note', { id: s.uuid().primaryKey(), text: s.text() }),
      },
    ]),
    jobs: {
      async note(payload, { bundle }) {
        await bundle.database.insertInto('note').values({ id: crypto.randomUUID(), text: payload.text }).execute()
      },
    },
    events: {
      'Umbraco.ContentPublish': () => ({ ok: true }),
    },
    routes: [
      route('/live/pid', { GET: () => Response.json({ pid: Deno.pid }) }),
      route('later', {
        POST: async (_r, { bundle }) => Response.json({ id: await bundle.jobs.enqueue('note', { text: 'from a job' }) }),
      }, { audience: 'backoffice' }),
      route('notes', {
        GET: async (_r, { bundle }) =>
          Response.json((await bundle.database.selectFrom('note').select('text').execute()).map((row) => row.text)),
      }, { audience: 'backoffice' }),
    ],
  }
}
`

const PERMISSIONS = ['data.tables', 'events.content', 'routes.public']

/** A site with @acme/live installed and nothing granting it, with one page type to publish. */
function liveSite(code = LIVE): string {
  return writeTreeSchema(
    siteDeclaring('extension-live', {
      '@acme/live': {
        json: {
          exports: './index.js',
          crombolo: {
            id: 'live',
            name: 'Live',
            server: 'live',
            migrations: 'compatible',
            permissions: {
              'data.tables': 'Keeps its notes',
              'events.content': 'Is told when a page is published',
              'routes.public': 'Answers on the site',
            },
          },
        },
        files: { 'index.js': code },
      },
    }),
  )
}

async function boot(root: string, config: Record<string, unknown> = {}, keepDatabase = false) {
  const site = await treeSite({ root, keepDatabase, config: { siteDir: root, ...config } })
  sites.push(site)
  return site
}

const pidOf = async (node: ServerHandle) => {
  const response = await node.fetch(new Request(`${ORIGIN}/live/pid`))
  return {
    status: response.status,
    pid: response.status === 200 ? ((await response.json()) as { pid: number }).pid : undefined,
  }
}

const grant = (h: Harness) =>
  h.post(`${BACKOFFICE}/crombolo/api/bundles/grant`, { id: 'live', grant: PERMISSIONS })

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Waits for something another node does when it hears, polling it now and then. */
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read()
  for (let i = 0; i < 60 && !done(value); i++) {
    await Bun.sleep(250)
    value = await read()
  }
  return value
}

describe(`an extension granted while the site runs (${dialectUnderTest})`, () => {
  test('starts at once: its route answers, its job runs and its event handler fires', async () => {
    const site = await boot(liveSite())
    const { h } = site
    expect((await pidOf(h.server)).status).toBe(404)

    const granted = await grant(h)
    expect(granted.status, await granted.clone().text()).toBe(200)
    const answer = (await granted.json()) as Record<string, unknown>
    expect(answer).toMatchObject({ ok: true, on: true })
    expect(answer.couldNotStart).toBeUndefined()
    expect(answer.restartPending).toBeUndefined()

    const started = await pidOf(h.server)
    expect(started.status).toBe(200)
    expect(alive(started.pid as number)).toBe(true)

    // Its job, on its own tables, made as it started.
    const queued = await h.post(`${BACKOFFICE}/crombolo/api/bundle/live/later`, {})
    expect(queued.status, await queued.clone().text()).toBe(200)
    await h.server.backgroundJobs.runDue()
    expect(await h.json<string[]>(`${BACKOFFICE}/crombolo/api/bundle/live/notes`)).toEqual([
      'from a job',
    ])

    // Its event handler, on the delivery queue.
    await treeOps(site).publish(await createPage(site, 'Home'))
    const delivered = await eventually(
      async () => {
        await h.server.jobs.runWebhooks()
        return h.json<{ items: Array<{ url: string; isSuccessStatusCode: boolean }> }>(
          `${V1}/webhook/logs?skip=0&take=10`,
        )
      },
      (logs) => logs.items.length > 0,
    )
    expect(delivered.items.map((item) => [item.url, item.isSuccessStatusCode])).toEqual([
      ['bundle:live', true],
    ])
  }, 90_000)

  test('turned off, its process stops and its route says so; on again, it starts', async () => {
    const site = await boot(liveSite())
    const { h } = site
    expect((await grant(h)).status).toBe(200)
    const first = (await pidOf(h.server)).pid as number

    const off = await h.post(`${BACKOFFICE}/crombolo/api/bundles/disable`, { id: 'live' })
    expect(await off.json()).toMatchObject({ ok: true, on: false })
    expect(alive(first)).toBe(false)
    const turnedOff = await h.server.fetch(new Request(`${ORIGIN}/live/pid`))
    expect(turnedOff.status).toBe(503)
    expect(((await turnedOff.json()) as { title: string }).title).toBe('Turned off')

    const on = await h.post(`${BACKOFFICE}/crombolo/api/bundles/enable`, { id: 'live' })
    const answer = (await on.json()) as Record<string, unknown>
    expect(answer).toMatchObject({ ok: true, on: true })
    expect(answer.restartPending).toBeUndefined()
    const again = await pidOf(h.server)
    expect(again.status).toBe(200)
    expect(again.pid).not.toBe(first)
  }, 90_000)

  test('turned on when it was off at boot, it starts', async () => {
    const root = liveSite()
    const sqliteFile = join(root, 'site.sqlite')
    const before = await boot(root, { sqliteFile })
    expect((await grant(before.h)).status).toBe(200)
    expect(
      (await before.h.post(`${BACKOFFICE}/crombolo/api/bundles/disable`, { id: 'live' })).status,
    ).toBe(200)
    sites.splice(sites.indexOf(before), 1)
    await before.h.db.close()

    const { h } = await boot(root, { sqliteFile }, true)
    expect((await pidOf(h.server)).status).toBe(404)
    const on = await h.post(`${BACKOFFICE}/crombolo/api/bundles/enable`, { id: 'live' })
    expect(await on.json()).toMatchObject({ ok: true, on: true })
    expect((await pidOf(h.server)).status).toBe(200)
  }, 90_000)

  test('removed, it is stopped and unmounted', async () => {
    const { h } = await boot(liveSite())
    expect((await grant(h)).status).toBe(200)
    const pid = (await pidOf(h.server)).pid as number
    const removed = await h.post(`${BACKOFFICE}/crombolo/api/bundles/uninstall`, {
      name: '@acme/live',
    })
    expect(removed.status, await removed.clone().text()).toBe(200)
    expect(((await removed.json()) as { restartPending?: boolean }).restartPending).toBeUndefined()
    expect(alive(pid)).toBe(false)
    expect((await pidOf(h.server)).status).toBe(404)
    expect((await h.call(`${BACKOFFICE}/crombolo/api/bundle/live/notes`)).status).toBe(404)
  }, 90_000)

  test('a route that clashes with one already there refuses the start, naming both', async () => {
    const mine = route('/live/pid', { GET: () => Response.json({ mine: true }) }) as SiteRoute
    const { h } = await boot(liveSite(), { routes: [mine] })
    const granted = await grant(h)
    expect(granted.status).toBe(200)
    const answer = (await granted.json()) as { ok: boolean; couldNotStart?: string }
    expect(answer.ok).toBe(true)
    expect(answer.couldNotStart).toContain('the bundle live and the site both claim the route')
    expect(await (await h.server.fetch(new Request(`${ORIGIN}/live/pid`))).json()).toEqual({
      mine: true,
    })
    const listed = (await (
      await h.call(`${BACKOFFICE}/crombolo/api/bundles/installed`)
    ).json()) as {
      items: { id: string; couldNotStart?: string }[]
    }
    expect(listed.items.find((item) => item.id === 'live')?.couldNotStart).toContain('both claim')
  }, 90_000)

  test('one that cannot start says why, keeps its grant, and the site keeps running', async () => {
    const { h } = await boot(liveSite(`throw new Error('broken while it loads')\n`))
    const granted = await grant(h)
    const answer = (await granted.json()) as { ok: boolean; on: boolean; couldNotStart?: string }
    expect(answer).toMatchObject({ ok: true, on: true })
    expect(answer.couldNotStart).toContain('broken while it loads')
    expect(h.server.bundleGrants.isOn('live')).toBe(true)
    expect((await h.call('/health')).status).toBeLessThan(500)
  }, 90_000)
})

describe(`two nodes on one database (${dialectUnderTest})`, () => {
  test('the other node starts it when it hears, and stops it when it is turned off', async () => {
    const root = liveSite()
    const sqliteFile = join(root, 'site.sqlite')
    const { h } = await boot(root, { sqliteFile, nodeId: 'node-a' })
    const b = await bootServer({
      keepDatabase: true,
      config: {
        siteDir: root,
        sqliteFile,
        nodeId: 'node-b',
        schemaDir: join(root, 'schema'),
        componentsDir: join(root, 'components'),
        componentsCacheDir: join(root, '.crombolo-b'),
      },
    })
    servers.push(b)
    expect((await pidOf(b)).status).toBe(404)

    expect((await grant(h)).status).toBe(200)
    await b.poll()
    const there = await eventually(
      () => pidOf(b),
      (answer) => answer.status === 200,
    )
    expect(there.status).toBe(200)
    expect(there.pid).not.toBe((await pidOf(h.server)).pid)

    expect(
      (await h.post(`${BACKOFFICE}/crombolo/api/bundles/disable`, { id: 'live' })).status,
    ).toBe(200)
    await b.poll()
    const stopped = await eventually(
      async () => alive(there.pid as number),
      (running) => !running,
    )
    expect(stopped).toBe(false)
  }, 120_000)
})

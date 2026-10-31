/**
 * Story 219: server actions. A module of them listed in the config; a form
 * posting to one without JavaScript and returned to with its result; the same
 * action answering a JSON caller; an island given one as a prop.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isOk, isOutcome, reviveActions } from '@crombolo/common'
import { ComponentRepository, ContentTypeRepository, DocumentRepository } from '@crombolo/data'
import { IslandPropsError, renderScope, serializeProps } from '@crombolo/render'
import {
  actionRegistry,
  createServer,
  isServerOnly,
  loadConfig,
  returnPath,
} from '@crombolo/server'
import { type Harness, ORIGIN, signedInServer } from './support/harness.ts'

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
components = ["page"]
default-component = "page"
`

const ACTIONS = `import { Outcome, ok } from '@crombolo/common'
import { redirect } from '@crombolo/crombolo/navigation'

export async function save(formData) {
  const name = String(formData.get('name') ?? '')
  if (formData.has('__return') || formData.has('__antiforgery')) throw new Error('not taken out')
  if (name === 'away') redirect('/elsewhere')
  if (name === '') return Outcome.unprocessableContent([{ field: 'name', message: 'Say who you are.' }], 'Not yet.')
  return ok({ hello: name })
}

export function remove() {
  return ok('removed')
}
`

/** A form posting to `notes.save`, a button to `notes.remove`, and what came back. */
const VIEW = `import { actionState } from '@crombolo/crombolo'
import * as notes from '#actions/notes.ts'

export default function Page() {
  const state = actionState(notes.save)
  return (
    <main>
      <p id="state">{JSON.stringify(state ?? null)}</p>
      <form action={notes.save}>
        <input name="name" />
        <button formAction={notes.remove}>Remove</button>
      </form>
    </main>
  )
}
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'actions-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  mkdirSync(join(root, 'actions'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'actions-site',
      type: 'module',
      imports: { '#actions/*': './actions/*' },
    }),
  )
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  writeFileSync(join(root, 'actions', 'notes.ts'), ACTIONS)
  const notes = await import(join(root, 'actions', 'notes.ts'))
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      // The views' copy sits in the site, so `#actions/*` resolves from its package.json.
      componentsCacheDir: join(root, '.crombolo'),
      actions: { notes },
    },
  })
  open.push(h)
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const doc = await docs.create({
    key: crypto.randomUUID(),
    contentTypeKey: (await new ContentTypeRepository(db).byAlias('page'))?.key as string,
    componentKey: (await new ComponentRepository(db).byAlias('page'))?.key as string,
    parentKey: null,
    variants: [{ culture: null, segment: null, name: 'Home' }],
    values: [],
  })
  await docs.publish(doc.key, null)
  h.server.cache.invalidate()
  await h.server.cache.fresh()
  const post = (id: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
    h.server.fetch(
      new Request(`${ORIGIN}/crombolo/actions/${id}`, {
        method: 'POST',
        body: new URLSearchParams(fields),
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        redirect: 'manual',
      }),
    )
  const visit = async (cookie?: string) => {
    const response = await h.server.fetch(
      new Request(`${ORIGIN}/`, { headers: cookie ? { cookie } : {} }),
    )
    const html = await response.text()
    const state = /<p id="state">([^<]*)<\/p>/.exec(html)?.[1]?.replaceAll('&quot;', '"')
    return { response, html, state: state ? JSON.parse(state) : undefined }
  }
  return { h, notes, post, visit }
}

const flashOf = (response: Response) =>
  /crombolo-action=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0]

describe('listing actions', () => {
  test('each export of a module is one, and what cannot be one is refused by name', () => {
    const save = () => undefined
    const { registry, problems } = actionRegistry({
      notes: { save, label: 'Notes' },
      'a.b': { other: () => undefined },
      again: { save },
    })
    expect(registry.ids).toEqual(['notes.save'])
    expect(registry.idOf(save)).toBe('notes.save')
    expect(registry.idOf(() => undefined)).toBeUndefined()
    expect(problems.join('\n')).toContain('"notes.label" is not a function')
    expect(problems.join('\n')).toContain('"a.b" has a dot in its key')
    expect(problems.join('\n')).toContain('listed as two actions, "notes.save" and "again.save"')
  })

  test('a site with one that cannot be is not booted', async () => {
    const refused = await createServer(
      loadConfig({ actions: { notes: { label: 'Notes' } } }),
    ).catch((error: Error) => error)
    expect((refused as Error).message).toContain("The site's actions cannot be mounted")
  })

  test('a form returns only to a path on this site', () => {
    expect(returnPath('/about?x=1')).toBe('/about?x=1')
    expect(returnPath('//evil.example/')).toBe('/')
    expect(returnPath('/\\evil.example')).toBe('/')
    expect(returnPath('https://evil.example/')).toBe('/')
    expect(returnPath(null)).toBe('/')
  })
})

describe('a form posting to an action', () => {
  test('renders as a post to it, with where to return, and a button to another', async () => {
    const { visit } = await site()
    const { html, state } = await visit()
    expect(state).toBeNull()
    expect(html).toMatch(/<form action="\/crombolo\/actions\/notes\.save" method="post"/)
    expect(html).toContain('<input type="hidden" name="__return" value="/"')
    expect(html).toMatch(/formaction="\/crombolo\/actions\/notes\.remove"/)
  })

  test('is answered 303 back, and the page reads the result once, privately', async () => {
    const { post, visit } = await site()
    const done = await post('notes.save', { name: 'Ada', __return: '/' })
    expect(done.status).toBe(303)
    expect(done.headers.get('location')).toBe('/')
    const cookie = flashOf(done) as string
    expect(cookie).toBeTruthy()
    const back = await visit(cookie)
    expect(back.state).toEqual({ ok: true, value: { hello: 'Ada' } })
    expect(back.response.headers.get('cache-control')).toContain('private')
    expect(back.response.headers.get('set-cookie')).toContain('crombolo-action=;')
  })

  test('an outcome returns the errors and what was typed; redirect() sends it on', async () => {
    const { post, visit } = await site()
    const refused = await post('notes.save', { name: '', password: 'hunter2', __return: '/' })
    expect(refused.status).toBe(303)
    const back = await visit(flashOf(refused))
    expect(back.state).toMatchObject({
      ok: false,
      status: 422,
      message: 'Not yet.',
      errors: [{ field: 'name', message: 'Say who you are.' }],
      values: { name: '' },
    })
    expect(back.state.values.password).toBeUndefined()
    const away = await post('notes.save', { name: 'away', __return: '/' })
    expect(away.status).toBe(303)
    expect(away.headers.get('location')).toBe('/elsewhere')
    const off = await post('notes.save', { name: 'Ada', __return: '//evil.example/' })
    expect(off.headers.get('location')).toBe('/')
  })

  test('answers a JSON caller with the result itself', async () => {
    const { post } = await site()
    const json = { accept: 'application/json' }
    const done = await post('notes.save', { name: 'Ada' }, json)
    expect(await done.json()).toEqual({ ok: true, value: { hello: 'Ada' } })
    const refused = await post('notes.save', { name: '' }, json)
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ ok: false, status: 422, message: 'Not yet.' })
    const away = await post('notes.save', { name: 'away' }, json)
    expect(await away.json()).toEqual({ ok: true, redirect: '/elsewhere' })
    expect((await post('notes.nothing', {})).status).toBe(404)
  })

  test('an unlisted function fails the render, naming the fix', async () => {
    const unlisted = () => undefined
    const render = () =>
      renderScope({} as never, () => serializeProps({ act: unlisted }, 'notes-island'), {
        actions: { idOf: () => undefined },
      })
    expect(render).toThrow(IslandPropsError)
  })
})

describe('an action given to an island', () => {
  test('is not imported by browser code: client modules are given it instead', () => {
    expect(isServerOnly('#actions/notes.ts')).toBe(true)
    expect(isServerOnly('@crombolo/common')).toBe(false)
  })

  test('travels as its id, and any other function is still refused', () => {
    const save = () => undefined
    const json = renderScope({} as never, () => serializeProps({ save, n: 1 }, 'notes'), {
      actions: { idOf: (fn) => (fn === save ? 'notes.save' : undefined) },
    })
    expect(JSON.parse(json)).toEqual({ save: { $action: 'notes.save' }, n: 1 })
    expect(() =>
      renderScope({} as never, () => serializeProps({ other: () => 1 }, 'notes'), {
        actions: { idOf: () => undefined },
      }),
    ).toThrow("only data, or one of the site's server actions")
  })

  test('is called from the browser: a Result back, and a redirect navigates', async () => {
    const sent: Request[] = []
    const answers: Response[] = [
      Response.json({ ok: true, value: 3 }),
      Response.json({ ok: false, status: 422, message: 'No.', errors: [] }, { status: 422 }),
      Response.json({ ok: true, redirect: '/thanks' }),
    ]
    const navigated: string[] = []
    const realFetch = globalThis.fetch
    const realLocation = (globalThis as { location?: unknown }).location
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(new URL(String(input), 'http://site.test'), init))
      return answers.shift() as Response
    }) as typeof fetch
    ;(globalThis as { location?: unknown }).location = {
      assign: (to: string) => navigated.push(to),
    }
    try {
      const { save } = reviveActions(
        { save: { $action: 'notes.save' } },
        () => 'token',
      ) as unknown as {
        save: (input: Record<string, string>) => Promise<unknown>
      }
      const first = await save({ name: 'Ada' })
      expect(isOk(first as never) && (first as { value: unknown }).value).toBe(3)
      const second = await save({ name: '' })
      expect(isOutcome(second) && second.status).toBe(422)
      await save({ name: 'away' })
      expect(navigated).toEqual(['/thanks'])
      expect(new URL(sent[0]?.url as string).pathname).toBe('/crombolo/actions/notes.save')
      expect(sent[0]?.headers.get('accept')).toBe('application/json')
      expect(sent[0]?.headers.get('crombolo-antiforgery')).toBe('token')
      expect((await sent[0]?.formData())?.get('name')).toBe('Ada')
    } finally {
      globalThis.fetch = realFetch
      ;(globalThis as { location?: unknown }).location = realLocation
    }
  })
})

describe('where actions answer', () => {
  test('never on an api node', async () => {
    const save = () => undefined
    const server = await createServer(
      loadConfig({ role: 'api', actions: { notes: { save } } }),
    ).catch((error: Error) => error)
    if (server instanceof Error) return
    try {
      const response = await server.fetch(
        new Request(`${ORIGIN}/crombolo/actions/notes.save`, {
          method: 'POST',
          body: new FormData(),
        }),
      )
      expect(response.status).toBe(404)
    } finally {
      await server.db.close()
    }
  })
})

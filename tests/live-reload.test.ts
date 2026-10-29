/**
 * Story 214: the development loop. The event stream and how it collects
 * changes, the background type check, the script and where it is injected, and
 * the component stack and code around a template error. Then on a real site:
 * a save under components/, a schema change and a publish each reload open
 * pages, and with live reload off nothing is added.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import {
  componentStackOf,
  enableComponentStack,
  jsx,
  LIVE_EVENTS_PATH,
  LIVE_RELOAD_SCRIPT,
  LIVE_RELOAD_SCRIPT_PATH,
  LIVE_RELOAD_TAG,
  renderToString,
  withLiveReload,
} from '@crombolo/render'
import {
  createLiveReload,
  createTypeWatch,
  genericStatusPage,
  type ServerHandle,
  typesOf,
} from '@crombolo/server'
import { bootServer, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

interface Event {
  event: string
  data: Record<string, unknown>
}

/** Reads a `text/event-stream` answer, event by event. */
function listen(response: Response) {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  const seen: Event[] = []
  let buffered = ''
  let from = 0
  // One read at a time, kept across a timeout, so no chunk is dropped.
  let pending: ReturnType<typeof reader.read> | undefined
  const read = async (ms: number) => {
    pending ??= reader.read()
    const chunk = await Promise.race([pending, Bun.sleep(ms).then(() => undefined)])
    if (!chunk) return
    pending = undefined
    if (chunk.done) return
    buffered += decoder.decode(chunk.value, { stream: true })
    let end = buffered.indexOf('\n\n')
    while (end >= 0) {
      const lines = buffered.slice(0, end).split('\n')
      buffered = buffered.slice(end + 2)
      end = buffered.indexOf('\n\n')
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7)
      const data = lines.find((line) => line.startsWith('data: '))?.slice(6)
      if (event && data) seen.push({ event, data: JSON.parse(data) })
    }
  }
  return {
    seen,
    /** The next event after those already taken that matches, within `ms`. */
    async next(event: string, ms = 5_000, matches = (_: Event) => true): Promise<Event> {
      const deadline = Date.now() + ms
      for (;;) {
        const at = seen.findIndex((e, i) => i >= from && e.event === event && matches(e))
        if (at >= 0) {
          from = at + 1
          return seen[at] as Event
        }
        const left = deadline - Date.now()
        if (left <= 0) throw new Error(`No ${event} event; saw ${JSON.stringify(seen)}`)
        await read(left)
      }
    },
    /** Whether an event arrives within `ms`. */
    async quiet(event: string, ms: number): Promise<boolean> {
      const before = seen.filter((e) => e.event === event).length
      const deadline = Date.now() + ms
      while (Date.now() < deadline) await read(deadline - Date.now())
      return seen.filter((e) => e.event === event).length === before
    },
    close: () => reader.cancel().catch(() => {}),
  }
}

describe('the event stream', () => {
  test('says which process it is, and the type findings so far, to each page that connects', async () => {
    const live = createLiveReload({ bootId: 'boot-1' })
    live.types({ count: 2, first: { file: 'components/a.tsx', line: 3, message: 'nope' } })
    const response = live.stream(new Request(`${ORIGIN}${LIVE_EVENTS_PATH}`))
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const events = listen(response)
    expect((await events.next('hello')).data).toEqual({ boot: 'boot-1' })
    expect((await events.next('types')).data).toEqual({
      count: 2,
      first: { file: 'components/a.tsx', line: 3, message: 'nope' },
    })
    expect(live.listeners()).toBe(1)
    await events.close()
    live.close()
  })

  test('a burst of changes is one reload naming each, and a later change another', async () => {
    const live = createLiveReload({ collectMs: 50 })
    const events = listen(live.stream(new Request(`${ORIGIN}${LIVE_EVENTS_PATH}`)))
    await events.next('hello')
    live.changed('views')
    live.changed('content')
    live.changed('views')
    expect((await events.next('reload')).data).toEqual({ reasons: ['views', 'content'] })
    expect(await events.quiet('reload', 150)).toBe(true)
    live.changed('schema')
    expect((await events.next('reload')).data).toEqual({ reasons: ['schema'] })
    live.types({ count: 0 })
    expect((await events.next('types')).data).toEqual({ count: 0 })
    await events.close()
    live.close()
  })

  test('a page that leaves stops listening', async () => {
    const live = createLiveReload()
    const leaving = new AbortController()
    const events = listen(live.stream(new Request(`${ORIGIN}/`, { signal: leaving.signal })))
    await events.next('hello')
    leaving.abort()
    expect(live.listeners()).toBe(0)
    live.close()
  })
})

describe('the background type check', () => {
  const line = (file: string, row: number, message: string) =>
    `${file}(${row},5): error TS2322: ${message}`

  test("summarises tsc's lines as a count and the first error", () => {
    expect(
      typesOf([
        line('components/card.tsx', 12, "Type 'number' is not assignable to type 'string'."),
        '  The expected type comes from property title.',
        line('components/page.tsx', 4, 'Cannot find name x.'),
      ]),
    ).toEqual({
      count: 2,
      first: {
        file: 'components/card.tsx',
        line: 12,
        message: "Type 'number' is not assignable to type 'string'.",
      },
    })
    expect(typesOf([])).toEqual({ count: 0 })
  })

  test('a newer change stops the check running, and the same findings are not told twice', async () => {
    const signals: AbortSignal[] = []
    const answers = [
      [line('components/a.tsx', 1, 'first')],
      [line('components/a.tsx', 2, 'second')],
    ]
    const told: unknown[] = []
    const watch = createTypeWatch({
      check: async (signal) => {
        signals.push(signal)
        const problems = answers[Math.min(signals.length - 1, answers.length - 1)] as string[]
        await Bun.sleep(30)
        return { checked: true, problems }
      },
      onFindings: (findings) => told.push(findings.types),
    })
    const first = watch.schedule()
    const second = watch.schedule()
    await Promise.all([first, second])
    expect(signals[0]?.aborted).toBe(true)
    expect(told).toEqual([
      { count: 1, first: { file: 'components/a.tsx', line: 2, message: 'second' } },
    ])
    await watch.schedule()
    expect(told).toHaveLength(1)
  })

  test('a site without the compiler is told nothing', async () => {
    const told: unknown[] = []
    const watch = createTypeWatch({
      check: async () => ({ checked: false, problems: [] }),
      onFindings: (findings) => told.push(findings),
    })
    await watch.schedule()
    expect(told).toEqual([])
  })
})

describe('the script', () => {
  test('goes before </body>, or at the end of a page without one', () => {
    expect(withLiveReload('<html><body><p>hi</p></body></html>')).toBe(
      `<html><body><p>hi</p>${LIVE_RELOAD_TAG}</body></html>`,
    )
    expect(withLiveReload('<p>hi</p>')).toBe(`<p>hi</p>${LIVE_RELOAD_TAG}`)
    expect(LIVE_RELOAD_TAG).toContain(`src="${LIVE_RELOAD_SCRIPT_PATH}"`)
  })

  test('listens on the stream and reloads on a change or a new process, with no inline code', () => {
    expect(LIVE_RELOAD_SCRIPT).toContain(`new EventSource('${LIVE_EVENTS_PATH}')`)
    expect(LIVE_RELOAD_SCRIPT).toContain("addEventListener('reload'")
    expect(LIVE_RELOAD_SCRIPT).toContain('boot !== id')
    expect(LIVE_RELOAD_SCRIPT).not.toContain('innerHTML')
  })
})

describe('the component stack', () => {
  enableComponentStack()

  test('names the components rendering when one throws, outermost first', () => {
    const Card = (): never => {
      throw new Error('the card broke')
    }
    const List = () => jsx('ul', { children: jsx(Card, {}) })
    const Page = () => jsx('main', { children: jsx(List, {}) })
    let caught: unknown
    try {
      renderToString(jsx(Page, {}))
    } catch (error) {
      caught = error
    }
    expect(componentStackOf(caught)).toEqual(['Page', 'List', 'Card'])
  })

  test('follows an async component past its await', async () => {
    async function Inner(): Promise<never> {
      await Bun.sleep(1)
      throw new Error('late')
    }
    async function Outer() {
      await Bun.sleep(1)
      return jsx('div', { children: jsx(Inner, {}) })
    }
    const error = await Promise.resolve(renderToString(jsx(Outer, {}))).catch((e: unknown) => e)
    expect(componentStackOf(error)).toEqual(['Outer', 'Inner'])
  })
})

describe('the error page', () => {
  test('shows the code around the line, marked, and the component stack', () => {
    const html = genericStatusPage({
      status: 500,
      name: 'serverError',
      errors: [],
      reference: 'ABC123',
      details: {
        message: 'the card broke',
        location: 'components/page.tsx:3',
        code: {
          line: 3,
          lines: [
            { number: 2, text: 'function Card({ name }) {' },
            { number: 3, text: "  if (name === 'Broken') throw new Error('x')" },
            { number: 4, text: '}' },
          ],
        },
        components: ['page', 'Card'],
        stack: 'Error: the card broke',
      },
    })
    expect(html).toContain(
      '<span class="at">&gt; 3 |   if (name === &#39;Broken&#39;) throw new Error(&#39;x&#39;)</span>',
    )
    expect(html).toContain('<span>  2 | function Card({ name }) {</span>')
    expect(html).toContain('While rendering <code>page › Card</code>')
  })

  test('without details, a reference and nothing of the code', () => {
    const html = genericStatusPage({
      status: 500,
      name: 'serverError',
      errors: [],
      reference: 'R1',
    })
    expect(html).toContain('R1')
    expect(html).not.toContain('class="code"')
    expect(html).not.toContain('While rendering')
  })
})

const TYPE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"
`
const VIEW = `function Card({ name }) {
  if (name === 'Broken') throw new Error('the card broke')
  return <p>{name}</p>
}
export default function Page({ model }) {
  return <html><body><Card name={model.name} /></body></html>
}
`

describe('on a real site', () => {
  let h: Harness
  let root: string
  let sqliteFile: string
  const servers: ServerHandle[] = []
  const visit = (server: ServerHandle, path: string) =>
    server.fetch(new Request(`${ORIGIN}${path}`))
  let config: Record<string, unknown>
  let typeKey: string
  let componentKey: string
  let home: string | null = null
  const page = async (name: string) => {
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: home ? { id: home } : null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    if (created.status !== 201) throw new Error(`create ${created.status}: ${await created.text()}`)
    return created.headers.get('umb-generated-resource') as string
  }
  const publish = (key: string) => h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })

  beforeAll(async () => {
    root = mkdtempSync(join(process.cwd(), 'output', 'live-reload-'))
    sqliteFile = join(root, 'site.sqlite')
    mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
    mkdirSync(join(root, 'components'), { recursive: true })
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), TYPE)
    writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
    config = {
      siteDir: root,
      sqliteFile,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
    }
    h = await signedInServer({
      config: { ...config, liveReload: true, errors: { showDetails: true } },
    })
    typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
    home = await page('Home')
    await publish(home)
    await publish(await page('Broken'))
  })

  afterAll(async () => {
    for (const server of servers) await server.close()
    await h?.db.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  })

  test('pages carry the script, which is served, and the stream says hello', async () => {
    const home = await visit(h.server, '/')
    expect(await home.text()).toContain(`${LIVE_RELOAD_TAG}</body>`)
    const script = await visit(h.server, LIVE_RELOAD_SCRIPT_PATH)
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await script.text()).toBe(LIVE_RELOAD_SCRIPT)
    const leaving = new AbortController()
    const events = listen(
      (await h.server.fetch(
        new Request(`${ORIGIN}${LIVE_EVENTS_PATH}`, { signal: leaving.signal }),
      )) as Response,
    )
    expect((await events.next('hello')).data.boot).toEqual(expect.any(String))
    leaving.abort()
  })

  test('a template error shows the code around its line and the components rendering', async () => {
    const broken = await visit(h.server, '/broken/')
    expect(broken.status).toBe(500)
    const html = await broken.text()
    expect(html).toContain(
      '<span class="at">&gt; 2 |   if (name === &#39;Broken&#39;) throw new Error(&#39;the card broke&#39;)</span>',
    )
    expect(html).toContain('While rendering <code>page › Card</code>')
    expect(html).toContain(LIVE_RELOAD_TAG)
  })

  test('a save under components/, a schema change and a publish each reload open pages', async () => {
    const leaving = new AbortController()
    const events = listen(
      (await h.server.fetch(
        new Request(`${ORIGIN}${LIVE_EVENTS_PATH}`, { signal: leaving.signal }),
      )) as Response,
    )
    await events.next('hello')

    // A real site may also reload for content a moment after boot, so each
    // change waits for the reload that names it.
    const reloadFor = (reason: string, ms = 10_000) =>
      events.next('reload', ms, (e) => (e.data.reasons as string[]).includes(reason))

    writeFileSync(join(root, 'components', 'extra.tsx'), 'export const Extra = () => <b>new</b>\n')
    await reloadFor('views')

    writeFileSync(
      join(root, 'schema', 'content-types', 'note.toml'),
      '[content-type]\nalias = "note"\nname = "Note"\n',
    )
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.1.0"\n')
    await reloadFor('schema')

    await publish(await page('Later'))
    await reloadFor('content', 5_000)
    leaving.abort()
  })

  test('with live reload off, pages carry nothing and the stream is not there', async () => {
    const off = await bootServer({
      keepDatabase: true,
      config: { ...config, liveReload: false, errors: { showDetails: false } },
    })
    servers.push(off)
    const home = await visit(off, '/')
    expect(await home.text()).not.toContain(LIVE_RELOAD_SCRIPT_PATH)
    expect((await visit(off, LIVE_EVENTS_PATH)).status).toBe(404)
    expect((await visit(off, LIVE_RELOAD_SCRIPT_PATH)).status).toBe(404)
    const broken = await (await visit(off, '/broken/')).text()
    expect(broken).not.toContain('class="code"')
    expect(broken).not.toContain('While rendering')
  })
})

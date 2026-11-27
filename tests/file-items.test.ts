/**
 * Story 450: a File in the content tree, served at its name exactly. Its body is
 * text or an upload kept under `files/`; it answers after `public/` and before
 * the generated files, routes and pages; it is cached, protected, previewed,
 * held in a workspace and in the Delivery API as content is.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  bodyProblem,
  FILE_KINDS as EDITOR_KINDS,
  editorFor,
  nameProblem,
  replaceNote,
  wellFormedJson,
  wellFormedXml,
} from '@crombolo/backoffice-host/file-kinds'
import { ok, route } from '@crombolo/common'
import {
  FILE_CONTENT_TYPE_KEY,
  FILE_KINDS,
  fileIconFor,
  fileUploadOf,
  SYSTEM_CONTENT_TYPE_KEYS,
} from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  type NodeRow,
} from '@crombolo/data'
import { file } from '@crombolo/render'
import {
  type CromboloConfig,
  loadConfig,
  MediaFileStore,
  removeUnnamedFileObjects,
  unansweredFiles,
} from '@crombolo/server'
import { exportBundle } from '@crombolo/transfer'
import {
  FILE_TYPE_KEY,
  fileLinkInsert,
  fileLinkSnippet,
  withNamedImport,
} from '../packages/backoffice-host/plugin/view-parts.js'
import { carriedFilesIn } from '../packages/server/src/change-transfer.ts'
import { fileLinksIn } from '../packages/server/src/file-items.ts'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0) await open.pop()?.db.close()
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
allow-children = ["page"]
`
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])
const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`

async function site(
  options: { routes?: ReturnType<typeof route>[]; config?: Partial<CromboloConfig> } = {},
) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'file-items-'))
  dirs.push(root)
  const write = (path: string, body: string | Uint8Array) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  write('schema/schema.toml', '[schema]\nversion = "1.0.0"\n')
  write('schema/content-types/page.toml', PAGE_TOML)
  write('components/page.tsx', 'export default () => <h1>The page</h1>\n')
  write('public/humans.txt', 'from public\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      componentsCacheDir: join(root, '.crombolo'),
      publicDir: join(root, 'public'),
      mediaDir: join(root, 'media'),
      deliveryApi: { enabled: true, apiKey: 'key', publicAccess: false },
      routes: options.routes ?? [],
      ...options.config,
    },
  })
  open.push(h)
  const db = h.server.db
  const pageType = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const component = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const visit = (path: string, init: RequestInit = {}) =>
    h.server.fetch(new Request(`${ORIGIN}${path}`, init))
  const publish = async (key: string, headers: Record<string, string> = {}) => {
    const published = await h.call(`${V1}/document/${key}/publish`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ publishSchedules: [] }),
    })
    expect(published.status, await published.clone().text()).toBe(200)
  }
  const page = async (name: string, parent: string | null = null) => {
    const made = await h.post(`${V1}/document`, {
      documentType: { id: pageType },
      template: { id: component },
      parent: parent ? { id: parent } : null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(made.status, await made.clone().text()).toBe(201)
    const key = made.headers.get('umb-generated-resource') as string
    await publish(key)
    return key
  }
  /** A File made, answering the create's response; published unless told not to. */
  const make = async (
    name: string,
    body: unknown,
    {
      parent = null,
      publish: published = true,
    }: { parent?: string | null; publish?: boolean } = {},
  ) => {
    const made = await h.post(`${V1}/document`, {
      documentType: { id: FILE_CONTENT_TYPE_KEY },
      template: null,
      parent: parent ? { id: parent } : null,
      values:
        body === undefined ? [] : [{ alias: 'body', culture: null, segment: null, value: body }],
      variants: [{ culture: null, segment: null, name }],
    })
    const key = made.headers.get('umb-generated-resource') as string | null
    if (made.status === 201 && published && key) await publish(key)
    return { response: made, key: key as string }
  }
  const save = async (key: string, name: string, body: unknown) =>
    h.put(`${V1}/document/${key}`, {
      template: null,
      values: [{ alias: 'body', culture: null, segment: null, value: body }],
      variants: [{ culture: null, segment: null, name }],
    })
  const upload = async (name: string, bytes: Uint8Array) => {
    const id = crypto.randomUUID()
    const form = new FormData()
    form.set('Id', id)
    form.set('File', new File([bytes as Uint8Array<ArrayBuffer>], name))
    expect((await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })).status).toBe(201)
    return { temporaryFileId: id }
  }
  return { h, root, write, visit, page, make, save, publish, upload }
}

const problemOf = async (response: Response) => {
  const body = (await response.json()) as { detail?: string; errors?: unknown }
  return `${body.detail ?? ''} ${JSON.stringify(body.errors ?? {})}`
}

describe('a File item', () => {
  test('with a text body is served at its name exactly, as text, with nosniff', async () => {
    const { make, visit, h } = await site()
    const { response, key } = await make('llms.txt', '# A site\n\nFor agents.\n')
    expect(response.status, await response.clone().text()).toBe(201)
    const served = await visit('/llms.txt')
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(served.headers.get('content-security-policy')).toBeNull()
    expect(await served.text()).toBe('# A site\n\nFor agents.\n')
    // Its name is kept as typed, never made a slug.
    const item = await h.json<{ variants: Array<{ name: string }> }>(`${V1}/document/${key}`)
    expect(item.variants[0]?.name).toBe('llms.txt')
    expect((await visit('/llms-txt')).status).toBe(404)
    // Pickers and links reach it at its address.
    const urls = await h.json<Array<{ urlInfos: Array<{ url: string }> }>>(
      `${V1}/document/urls?id=${key}`,
    )
    expect(urls[0]?.urlInfos[0]?.url).toBe('/llms.txt')
  })

  test('under a page and inside a folder File answers at its full path; the folder answers nothing', async () => {
    const { make, page, visit } = await site()
    const home = await page('Home')
    const about = await page('About', home)
    await make('notes.txt', 'under about', { parent: about })
    const docs = await make('docs', undefined)
    expect(docs.response.status, await docs.response.clone().text()).toBe(201)
    const guideItem = await make('agents.md', '# For agents', { parent: docs.key })
    expect(guideItem.response.status, await guideItem.response.clone().text()).toBe(201)
    expect(await (await visit('/about/notes.txt')).text()).toBe('under about')
    const guide = await visit('/docs/agents.md')
    expect(guide.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await guide.text()).toBe('# For agents')
    expect((await visit('/docs')).status).toBe(404)
    // A File at the root is never the home page, and never in a menu.
    expect(await (await visit('/')).text()).toContain('The page')
  })

  test('HTML, SVG and XML are served sandboxed', async () => {
    const { make, visit } = await site()
    await make('verify.html', '<p>verified</p><script>alert(1)</script>')
    await make('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>')
    await make('feed.xml', '<feed/>')
    for (const [path, type] of [
      ['/verify.html', 'text/html; charset=utf-8'],
      ['/logo.svg', 'image/svg+xml'],
      ['/feed.xml', 'application/xml'],
    ] as const) {
      const served = await visit(path)
      expect(served.headers.get('content-type')).toBe(type)
      expect(served.headers.get('content-security-policy')).toBe('sandbox')
      expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    }
  })
})

describe('the Create menu', () => {
  test('offers File at the root and under any page, and only File under a File', async () => {
    const { h } = await site()
    const pageType = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const ids = (body: { items: Array<{ id: string }> }) => body.items.map((item) => item.id)
    const root = await h.json<{ items: Array<{ id: string }> }>(
      `${V1}/document-type/allowed-at-root?take=100`,
    )
    expect(ids(root)).toContain(FILE_CONTENT_TYPE_KEY)
    expect(ids(root)).toContain(pageType)
    // The page type lists no children, and File is offered anyway.
    const under = await h.json<{ items: Array<{ id: string }> }>(
      `${V1}/document-type/${pageType}/allowed-children?take=100`,
    )
    expect(ids(under)).toEqual([pageType, FILE_CONTENT_TYPE_KEY])
    const inFile = await h.json<{ items: Array<{ id: string }> }>(
      `${V1}/document-type/${FILE_CONTENT_TYPE_KEY}/allowed-children?take=100`,
    )
    expect(ids(inFile)).toEqual([FILE_CONTENT_TYPE_KEY])
    // Documents only: media types are as they were.
    const media = await h.json<{ items: Array<{ id: string }> }>(
      `${V1}/media-type/allowed-at-root?take=100`,
    )
    expect(ids(media)).not.toContain(FILE_CONTENT_TYPE_KEY)
  })

  test('a page is refused inside a File, and a File shows its extension icon', async () => {
    const { h, make } = await site()
    const pageType = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const docs = await make('docs', undefined)
    const refused = await h.post(`${V1}/document`, {
      documentType: { id: pageType },
      template: null,
      parent: { id: docs.key },
      values: [],
      variants: [{ culture: null, segment: null, name: 'Inside' }],
    })
    expect(refused.status).toBe(400)
    expect(await problemOf(refused)).toContain('Only a File can go inside a File')
    await make('logo.png', undefined, { parent: docs.key, publish: false })
    await make('data.json', '{}', { parent: docs.key })
    const roots = await h.json<{ items: Array<{ id: string; documentType: { icon: string } }> }>(
      `${V1}/tree/document/root?take=100`,
    )
    expect(roots.items.find((item) => item.id === docs.key)?.documentType.icon).toBe('icon-folder')
    const children = await h.json<{
      items: Array<{ variants: Array<{ name: string }>; documentType: { icon: string } }>
    }>(`${V1}/tree/document/children?parentId=${docs.key}&take=100`)
    const icons = Object.fromEntries(
      children.items.map((item) => [item.variants[0]?.name, item.documentType.icon]),
    )
    expect(icons['data.json']).toBe('icon-code')
  })
})

describe('names and bodies', () => {
  test('an extension off the list is refused naming the list, and two items at one address naming both', async () => {
    const { make, page } = await site()
    const off = await make('run.exe', 'x')
    expect(off.response.status).toBe(400)
    const said = await problemOf(off.response)
    expect(said).toContain('.exe')
    expect(said).toContain('.txt, .md, .json')
    const home = await page('Home')
    await page('Notes', home)
    await make('notes', undefined, { parent: home, publish: false }).then(async (clash) => {
      expect(clash.response.status).toBe(400)
      const text = await problemOf(clash.response)
      expect(text).toContain('"notes"')
      expect(text).toContain('"Notes"')
    })
    await make('a.txt', 'one')
    const twice = await make('A.txt', 'two')
    expect(twice.response.status).toBe(400)
    expect(await problemOf(twice.response)).toContain('"a.txt"')
  })

  test('JSON, .webmanifest, XML and SVG that are not well-formed are refused naming the line and column', async () => {
    const { make } = await site()
    for (const [name, body] of [
      ['data.json', '{\n  "a": 1,\n}'],
      ['site.webmanifest', '{"name": }'],
      ['feed.xml', '<feed>\n  <entry></feed>'],
      ['logo.svg', '<svg><g></svg>'],
    ] as const) {
      const refused = await make(name, body)
      expect(refused.response.status, name).toBe(400)
      const said = await problemOf(refused.response)
      expect(said, name).toMatch(/line \d+, column \d+/)
    }
    expect((await make('data.json', '{"a": [1, 2]}')).response.status).toBe(201)
  })

  test('a text body for an image is refused, and renaming between kinds asks for a new body', async () => {
    const { make, save } = await site()
    const refused = await make('logo.png', 'not an image')
    expect(refused.response.status).toBe(400)
    expect(await problemOf(refused.response)).toContain('uploaded file')
    const notes = await make('notes.txt', 'text')
    const renamed = await save(notes.key, 'notes.png', 'text')
    expect(renamed.status).toBe(400)
    expect(await problemOf(renamed)).toContain('Replace the body')
  })
})

describe('an upload', () => {
  test('is kept under files/, served with its type at its address and the file route, never at /media/', async () => {
    const { make, upload, visit, h } = await site()
    const sent = await upload('logo.png', PNG)
    const made = await make('logo.png', sent)
    expect(made.response.status, await made.response.clone().text()).toBe(201)
    const served = await visit('/logo.png')
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG)

    const item = await h.json<{ values: Array<{ alias: string; value: unknown }> }>(
      `${V1}/document/${made.key}`,
    )
    const stored = fileUploadOf(item.values.find((v) => v.alias === 'body')?.value)
    expect(stored?.src).toMatch(new RegExp(`^files/${made.key}/\\d+/logo\\.png$`))
    expect(stored?.size).toBe(PNG.length)
    // Never at `/media/`, and never a store's public address.
    expect((await visit(`/media/${stored?.src}`)).status).toBe(404)
    const files = new MediaFileStore(h.server.config.mediaDir)
    expect(files.key(`/media/${stored?.src}`)).toBeUndefined()
    expect(files.publicUrl(`/media/${stored?.src}`)).toBeUndefined()

    const bytes = await visit(
      `/umbraco/delivery/api/v2/file?path=${encodeURIComponent('/logo.png')}`,
      {
        headers: { 'api-key': 'key' },
      },
    )
    expect(bytes.status).toBe(200)
    expect(bytes.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(PNG)
    expect(
      (await visit(`/umbraco/delivery/api/v2/file?path=${encodeURIComponent('/logo.png')}`)).status,
    ).toBe(401)
  })

  test('each version keeps its own, and one no version names goes', async () => {
    const { make, upload, save, h, visit, publish } = await site()
    const made = await make('logo.png', await upload('logo.png', PNG))
    const first = fileUploadOf(
      (await h.json<{ values: Array<{ value: unknown }> }>(`${V1}/document/${made.key}`)).values[0]
        ?.value,
    )
    const next = new Uint8Array([...PNG, 9, 9])
    expect((await save(made.key, 'logo.png', await upload('logo.png', next))).status).toBe(200)
    await publish(made.key)
    const second = fileUploadOf(
      (await h.json<{ values: Array<{ value: unknown }> }>(`${V1}/document/${made.key}`)).values[0]
        ?.value,
    )
    expect(second?.src).not.toBe(first?.src)
    expect(new Uint8Array(await (await visit('/logo.png')).arrayBuffer())).toEqual(next)
    const store = new MediaFileStore(h.server.config.mediaDir).store
    expect(await store.get(first?.src as string)).toBeTruthy()
    // Both versions name theirs, so nothing goes.
    expect(await removeUnnamedFileObjects(h.server.db, store)).toBe(0)
    await store.put('files/00000000-0000-0000-0000-000000000000/1/orphan.png', PNG)
    expect(await removeUnnamedFileObjects(h.server.db, store)).toBe(1)
  })

  test('moves between sites as a blob: in a bundle, and in a change', async () => {
    const { make, upload, h } = await site()
    const made = await make('logo.png', await upload('logo.png', PNG))
    const node = (await new DocumentRepository(h.server.db).nodes.byKey(made.key)) as NodeRow
    const exported = await exportBundle(h.server.db, {
      roots: [node],
      asGiven: [node.key],
      descendants: true,
      snapshot: 'published',
      blueprints: false,
      withBlobs: true,
      siteName: 'Test',
      nodeId: 'test',
    })
    const src = exported.blobKeys[0] as string
    expect(src).toMatch(new RegExp(`^files/${made.key}/`))
    expect(exported.set.manifest.blobs.map((b) => b.node)).toContain(made.key)
    expect([
      ...carriedFilesIn({
        values: [
          {
            alias: 'body',
            culture: null,
            segment: null,
            value: { src, name: 'logo.png', size: 12, contentType: 'image/png' },
          },
        ],
      }),
    ]).toEqual([src])
  })

  test('over 10 MB is refused', async () => {
    const { make, upload } = await site()
    const big = await upload('big.pdf', new Uint8Array(10 * 1024 * 1024 + 1))
    const refused = await make('big.pdf', big)
    expect(refused.response.status).toBe(400)
    expect(await problemOf(refused.response)).toContain('at most 10 MB')
  }, 20_000)
})

describe('who answers', () => {
  test('public/ wins over a File, and saving one says so', async () => {
    const { make, visit } = await site()
    const made = await make('humans.txt', 'from the tree')
    expect(made.response.status).toBe(201)
    const warned = made.response.headers.get('umb-notifications') ?? ''
    expect(warned).toContain('public/humans.txt')
    expect(await (await visit('/humans.txt')).text()).toBe('from public\n')
  })

  test('a File named robots.txt replaces the generated one, and a File wins over a route and a page', async () => {
    const { make, page, visit } = await site({
      routes: [route('/hello.txt', { GET: () => ok('the route') })],
    })
    expect(await (await visit('/robots.txt')).text()).not.toBe('User-agent: *\nAllow: /\n')
    await make('robots.txt', 'User-agent: *\nAllow: /\n')
    expect(await (await visit('/robots.txt')).text()).toBe('User-agent: *\nAllow: /\n')
    expect(await (await visit('/hello.txt')).text()).toContain('the route')
    await make('hello.txt', 'the File')
    expect(await (await visit('/hello.txt')).text()).toBe('the File')
    await page('Home')
    await make('about', undefined)
    expect((await visit('/about')).status).toBe(404)
  })

  test('a File the CMS answers in place of is warned of', async () => {
    const { make } = await site()
    const media = await make('media', undefined)
    const inside = await make('x.txt', 'never', { parent: media.key })
    expect(inside.response.headers.get('umb-notifications') ?? '').toContain(
      'the CMS answers there',
    )
  })
})

describe("the File's editor", () => {
  test('is told where it answers, and that agents read the guide; an upload is shown from its draft', async () => {
    const base = loadConfig({})
    const { make, upload, h } = await site({
      config: { remote: { ...base.remote, agentsGuide: 'https://example.com/agents-guide.md' } },
    })
    const guide = await make('agents-guide.md', '# Work here like this')
    const said = await h.json<{ address: string; agentsGuide: boolean; winner: string | null }>(
      `${BACKOFFICE}/crombolo/api/file-item/${guide.key}`,
    )
    expect(said).toEqual({ address: '/agents-guide.md', agentsGuide: true, winner: null })
    const other = await make('humans.txt', 'x')
    const shadowed = await h.json<{ agentsGuide: boolean; winner: string | null }>(
      `${BACKOFFICE}/crombolo/api/file-item/${other.key}`,
    )
    expect(shadowed.agentsGuide).toBe(false)
    expect(shadowed.winner).toContain('public/humans.txt')
    const logo = await make('logo.png', await upload('logo.png', PNG), { publish: false })
    const body = await h.call(`${BACKOFFICE}/crombolo/api/file-item/${logo.key}/body`)
    expect(body.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await body.arrayBuffer())).toEqual(PNG)
    const visitor = await h.server.fetch(
      new Request(`${ORIGIN}${BACKOFFICE}/crombolo/api/file-item/${logo.key}/body`),
    )
    expect(visitor.status).toBe(401)
  })
})

describe('a File never answered', () => {
  test('is named with what wins, and a view linking a path no File answers is found', () => {
    const files = [
      { name: 'humans.txt', url: '/humans.txt' },
      { name: 'x.txt', url: '/media/x.txt' },
      { name: 'docs', url: '/docs' },
      { name: 'llms.txt', url: '//example.com/llms.txt' },
    ] as unknown as Parameters<typeof unansweredFiles>[0]
    expect(
      unansweredFiles(files, {
        backOfficePath: '/umbraco',
        isPublic: (path) => path === '/humans.txt',
      }),
    ).toEqual([
      {
        name: 'humans.txt',
        path: '/humans.txt',
        winner: "the site's public file public/humans.txt answers there first",
      },
      { name: 'x.txt', path: '/media/x.txt', winner: 'the CMS answers there itself' },
    ])
    const root = mkdtempSync(join(process.cwd(), 'output', 'file-links-'))
    dirs.push(root)
    mkdirSync(join(root, 'shared'), { recursive: true })
    writeFileSync(
      join(root, 'shared', 'footer.tsx'),
      "export default () => <a href={file('/llms.txt')}>llms</a>\n",
    )
    writeFileSync(join(root, 'page.tsx'), 'export default () => <p>none</p>\n')
    expect([...fileLinksIn(root)]).toEqual([['/llms.txt', ['shared/footer.tsx']]])
  })
})

describe('as content', () => {
  test('is cached as a page: an ETag, a 304, and the new body once published', async () => {
    const { make, save, publish, visit } = await site()
    const made = await make('llms.txt', 'first')
    const served = await visit('/llms.txt')
    const etag = served.headers.get('etag') as string
    expect(etag).toBeTruthy()
    expect((await visit('/llms.txt', { headers: { 'if-none-match': etag } })).status).toBe(304)
    expect((await save(made.key, 'llms.txt', 'second')).status).toBe(200)
    // Saved, not published: visitors still see the first.
    expect(await (await visit('/llms.txt')).text()).toBe('first')
    await publish(made.key)
    const again = await visit('/llms.txt')
    expect(await again.text()).toBe('second')
    expect(again.headers.get('etag')).not.toBe(etag)
  })

  test('previews its draft raw, to an editor', async () => {
    const { make, save, h } = await site()
    const made = await make('llms.txt', 'published')
    await save(made.key, 'llms.txt', 'draft')
    const asEditor = (path: string) =>
      h.server.fetch(
        new Request(`${ORIGIN}${path}`, {
          headers: { cookie: `${h.cookie()}; UMB_PREVIEW=preview` },
        }),
      )
    const byKey = await asEditor(`/${made.key}`)
    expect(byKey.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(byKey.headers.get('cache-control')).toContain('no-store')
    expect(await byKey.text()).toBe('draft')
    expect(await (await asEditor('/llms.txt')).text()).toBe('draft')
  })

  test('is behind Public Access', async () => {
    const { make, page, h, visit } = await site()
    const home = await page('Home')
    const login = await page('Login', home)
    const secret = await make('secret.txt', 'members only')
    const group = await h.post(`${V1}/member-group`, { name: 'Subscribers' })
    expect(group.status).toBe(201)
    const protectedFile = await h.post(`${V1}/document/${secret.key}/public-access`, {
      memberUserNames: [],
      memberGroupNames: ['Subscribers'],
      loginDocument: { id: login },
      errorDocument: { id: login },
    })
    expect(protectedFile.status).toBe(201)
    const served = await visit('/secret.txt')
    expect(await served.text()).not.toContain('members only')
  })

  test('is held in a workspace until it is merged', async () => {
    const { make, h, visit } = await site()
    const made = await make('llms.txt', 'shared')
    const opened = await h.post(WORKSPACES, { name: 'Spring' })
    expect(opened.status).toBe(201)
    const { key: workspace } = (await opened.json()) as { key: string }
    const saved = await h.call(`${V1}/document/${made.key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'crombolo-workspace': workspace },
      body: JSON.stringify({
        template: null,
        values: [{ alias: 'body', culture: null, segment: null, value: 'in the workspace' }],
        variants: [{ culture: null, segment: null, name: 'llms.txt' }],
      }),
    })
    expect(saved.status, await saved.clone().text()).toBe(200)
    expect(await (await visit('/llms.txt')).text()).toBe('shared')
    const refused = await h.call(`${V1}/document/${made.key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'crombolo-workspace': workspace },
      body: JSON.stringify({
        template: null,
        values: [{ alias: 'body', culture: null, segment: null, value: 'x' }],
        variants: [{ culture: null, segment: null, name: 'llms.exe' }],
      }),
    })
    expect(refused.status).toBe(400)
  })

  test('the Delivery API lists Files with their address, type and size', async () => {
    const { make, visit } = await site()
    await make('llms.txt', 'four')
    const listed = await visit('/umbraco/delivery/api/v2/content?filter=contentType:fileItem', {
      headers: { 'api-key': 'key' },
    })
    expect(listed.status).toBe(200)
    const body = (await listed.json()) as {
      items: Array<{ name: string; properties: { body: Record<string, unknown> } }>
    }
    const item = body.items.find((i) => i.name === 'llms.txt')
    expect(item?.properties.body).toEqual({
      path: '/llms.txt',
      contentType: 'text/plain; charset=utf-8',
      size: 4,
      url: '/umbraco/delivery/api/v2/file?path=%2Fllms.txt',
    })
    const bytes = await visit(item?.properties.body.url as string, {
      headers: { 'api-key': 'key' },
    })
    expect(await bytes.text()).toBe('four')
  })
})

describe('a view links to a File by path', () => {
  test('file() answers its address while a File is published there, and keeps the path otherwise', async () => {
    const { make, visit } = await site()
    await make('llms.txt', 'x')
    // The resolver reads the snapshot served now, so a request builds it first.
    await visit('/llms.txt')
    expect(file('/llms.txt')).toBe('/llms.txt')
    expect(file('/LLMS.TXT')).toBe('/llms.txt')
    expect(file('/missing.txt')).toBe('/missing.txt')
  })

  test('the Insert entry writes the link and imports file', () => {
    const link = fileLinkInsert(fileLinkSnippet('/docs/agents.md'))
    expect(link?.tag).toBe("<a href={file('/docs/agents.md')}>agents.md</a>")
    expect(fileLinkInsert('something else')).toBeUndefined()
    expect(
      withNamedImport(
        "import type { PageProps } from '@crombolo/crombolo'\n\nexport default 1\n",
        'file',
        '@crombolo/crombolo',
      ),
    ).toBe(
      "import type { PageProps } from '@crombolo/crombolo'\nimport { file } from '@crombolo/crombolo'\n\nexport default 1\n",
    )
    expect(
      withNamedImport("import { asset } from '@crombolo/crombolo'\n", 'file', '@crombolo/crombolo'),
    ).toBe("import { asset, file } from '@crombolo/crombolo'\n")
    expect(FILE_TYPE_KEY).toBe(FILE_CONTENT_TYPE_KEY)
  })
})

describe('the editor', () => {
  test('each extension chooses its editor, and the table matches the server', () => {
    expect(
      Object.fromEntries(
        [
          'a.md',
          'a.txt',
          'a.json',
          'a.webmanifest',
          'a.xml',
          'a.html',
          'a.svg',
          'a.csv',
          'a.pdf',
          'a.png',
          'docs',
          'a.exe',
        ].map((name) => [name, editorFor(name)]),
      ),
    ).toEqual({
      'a.md': 'markdown',
      'a.txt': 'text',
      'a.json': 'json',
      'a.webmanifest': 'json',
      'a.xml': 'xml',
      'a.html': 'html',
      'a.svg': 'svg',
      'a.csv': 'csv',
      'a.pdf': 'upload',
      'a.png': 'upload',
      docs: 'folder',
      'a.exe': 'unknown',
    })
    expect(
      EDITOR_KINDS.map((k) => [k.extension, k.contentType, k.editor, k.text, k.check ?? null]),
    ).toEqual(
      FILE_KINDS.map((k) => [k.extension, k.contentType, k.editor, k.text, k.check ?? null]),
    )
    expect(fileIconFor('docs')).toBe('icon-folder')
    expect(fileIconFor('a.png')).toBe('icon-picture')
    expect(SYSTEM_CONTENT_TYPE_KEYS.File).toBe(FILE_CONTENT_TYPE_KEY)
  })

  test('a rename to the other kind asks for a new body', () => {
    expect(replaceNote('notes.png', 'some text')).toContain('Replace it with an upload')
    expect(replaceNote('notes.txt', { src: 'files/x/1/logo.png', name: 'logo.png' })).toContain(
      'Replace it',
    )
    expect(replaceNote('notes.txt', 'text')).toBeUndefined()
    expect(replaceNote('logo.png', { src: 'files/x/1/logo.png', name: 'logo.png' })).toBeUndefined()
  })

  test('names and bodies are checked as the server checks them', () => {
    expect(nameProblem('llms.txt')).toBeUndefined()
    expect(nameProblem('a/b.txt')).toContain('/ ? #')
    expect(nameProblem('.env.txt')).toContain('dot')
    expect(nameProblem('security.txt', '.well-known')).toBeUndefined()
    expect(nameProblem('.well-known')).toBeUndefined()
    expect(wellFormedJson('{"a": [1, {"b": null}], "c": "\\u00e9"}')).toBeUndefined()
    expect(wellFormedJson('{\n  "a": tru\n}')).toMatchObject({ line: 2, column: 8 })
    expect(
      wellFormedXml('<?xml version="1.0"?>\n<a b="1"><!-- c --><![CDATA[<x>]]>&amp;</a>'),
    ).toBeUndefined()
    expect(wellFormedXml('<a>\n<b></a>')).toMatchObject({ line: 2, column: 4 })
    expect(wellFormedXml('<a/><b/>')?.message).toContain('second root')
    expect(wellFormedXml('<a x=1/>')?.message).toContain('in quotes')
    expect(bodyProblem('docs', 'text')?.message).toContain('folder')
    expect(bodyProblem('logo.png', undefined)?.message).toContain('needs an uploaded file')
  })
})

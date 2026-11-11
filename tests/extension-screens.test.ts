/**
 * Story 323: an extension's screens are described by its server half and drawn
 * by the back office, so none of its code runs in the page. The tree is held to
 * the catalogue on the server, the element draws it as text, and every call
 * reaches the extension with the grant and the person exactly as a route does.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  collectManifests,
  describedScreen,
  extensionOf,
  readBundlePackage,
  SCREEN_ELEMENT,
  screenEntryProblems,
} from '@crombolo/backoffice-host'
import { normaliseScreenResult, safeScreenHref, screenProblems } from '@crombolo/server'
import {
  actionBody,
  fieldProblems,
  hintsFor,
  linkTarget,
  screenUrl,
  sentValues,
  visibleFields,
} from '../packages/backoffice-host/plugin/extension-screen-model.js'
import { siteDeclaring } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const HOSTILE = '<script>alert(1)</script><img src=x onerror="alert(1)">'

describe('the tree, held to the catalogue on the server', () => {
  test('keeps every node of the catalogue, and drops what is not in it, naming it', () => {
    const { result, dropped } = normaliseScreenResult({
      screen: {
        type: 'screen',
        title: 'Redirects',
        toolbar: [
          { type: 'search', action: 'find' },
          { type: 'html', html: '<b>x</b>' },
        ],
        body: [
          { type: 'notice', text: 'Saved' },
          { type: 'html', html: HOSTILE },
          { type: 'iframe', src: 'https://evil.example' },
          { type: 'progress', value: 150 },
          { type: 'tabs', tabs: [{ id: 'a', label: 'A', body: [{ type: 'tabs', tabs: [] }] }] },
        ],
      },
      state: { page: 2 },
      notice: 'Done',
    })
    expect(result.screen.body.map((node) => node.type)).toEqual(['notice', 'progress', 'tabs'])
    expect(result.screen.toolbar?.map((item) => item.type)).toEqual(['search'])
    expect(result.screen.body[1]).toEqual({ type: 'progress', value: 100 })
    expect(
      (result.screen.body[2] as unknown as { tabs: { body: unknown[] }[] }).tabs[0]?.body,
    ).toEqual([])
    expect(result.state).toEqual({ page: 2 })
    expect(result.notice).toBe('Done')
    expect(dropped.sort()).toEqual(['html', 'iframe', 'tabs inside tabs'])
  })

  test('a bare screen is an answer, and anything else is an empty one', () => {
    expect(normaliseScreenResult({ type: 'screen', title: 'T', body: [] }).result).toEqual({
      screen: { type: 'screen', title: 'T', body: [] },
    })
    expect(normaliseScreenResult('nonsense').result.screen).toEqual({
      type: 'screen',
      title: '',
      body: [],
    })
  })

  test('every displayed string is a string, and an object in its place is nothing', () => {
    const { result } = normaliseScreenResult({
      type: 'screen',
      title: { toString: () => HOSTILE },
      body: [
        { type: 'notice', text: 42 },
        { type: 'problem', text: ['a'] },
      ],
    })
    expect(result.screen.title).toBe('')
    expect(result.screen.body).toEqual([
      { type: 'notice', text: '42' },
      { type: 'problem', text: '' },
    ])
  })

  test('a link goes to http, https or a path here; javascript:, data: and another host do not', () => {
    for (const href of [
      'https://acme.example/a',
      'http://acme.example',
      '/old-page',
      'section/content',
    ])
      expect(safeScreenHref(href)).toBe(href)
    for (const href of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<script>',
      '//evil.example',
      '/\\evil.example',
      'vbscript:x',
      42,
    ])
      expect(safeScreenHref(href)).toBeUndefined()
    const { result } = normaliseScreenResult({
      type: 'screen',
      title: 'T',
      body: [
        {
          type: 'table',
          columns: ['To'],
          rows: [
            {
              key: 'k',
              cells: [
                { type: 'link', text: 'go', href: 'javascript:alert(1)' },
                { type: 'link', text: 'ok', href: '/page' },
              ],
            },
          ],
        },
      ],
    })
    expect(
      (result.screen.body[0] as unknown as { rows: { cells: unknown[] }[] }).rows[0]?.cells,
    ).toEqual([
      { type: 'text', text: 'go' },
      { type: 'link', text: 'ok', href: '/page' },
    ])
  })

  test('a secret is never sent to the browser, whatever the extension put in it', () => {
    const { result } = normaliseScreenResult({
      type: 'screen',
      title: 'Entra',
      body: [
        {
          type: 'form',
          fields: [
            { kind: 'text', name: 'tenant', label: 'Tenant' },
            { kind: 'secret', name: 'secret', label: 'Client secret' },
            { kind: 'script', name: 'x', label: 'X' },
          ],
          values: { tenant: 'acme', secret: 'leaked' },
          actions: [{ type: 'button', label: 'Save', action: 'save', submit: true }],
        },
      ],
    })
    const form = result.screen.body[0] as unknown as { fields: { name: string }[]; values: object }
    expect(form.fields.map((f) => f.name)).toEqual(['tenant', 'secret'])
    expect(form.values).toEqual({ tenant: 'acme' })
  })
})

describe('in the manifest, schema 6', () => {
  const field = (entry: object, over: object = {}) => ({
    server: 'panel',
    extensions: [{ type: 'dashboard', alias: 'Acme.Dashboard.Panel', ...entry }],
    ...over,
  })

  test('an entry names a screen, or a module, never both', () => {
    expect(screenEntryProblems(field({ screen: 'main' }), 6)).toEqual([])
    expect(screenEntryProblems(field({ screen: 'main', element: 'x.js' }), 6)).toEqual([
      'Acme.Dashboard.Panel names a screen and a module: it is drawn from one or the other',
    ])
  })

  test('a screen needs schema 6, a server half, and an id', () => {
    expect(screenEntryProblems(field({ screen: 'main' }), 5)).toEqual([
      'Acme.Dashboard.Panel names a screen, which needs "crombolo.schemaVersion": 6',
    ])
    expect(screenEntryProblems(field({ screen: 'main' }, { server: undefined }), 6)).toEqual([
      'Acme.Dashboard.Panel names a screen, and the package has no server half to describe it',
    ])
    expect(screenEntryProblems(field({ screen: '../x' }), 6)).toHaveLength(1)
  })

  test('an entry naming a screen is drawn by the back office’s own element, told which', () => {
    expect(
      describedScreen({ type: 'dashboard', screen: 'main', meta: { label: 'P' } }, 'panel'),
    ).toEqual({
      type: 'dashboard',
      element: SCREEN_ELEMENT,
      meta: { label: 'P', cromboloScreen: { bundle: 'panel', screen: 'main' } },
    })
    const other = { type: 'dashboard', element: 'src/backoffice/x.js' }
    expect(describedScreen(other, 'panel')).toBe(other)
  })

  test('the bundle’s screens are checked at boot: ids, and functions', () => {
    expect(
      screenProblems({ main: { view: () => ({ type: 'screen', title: '', body: [] }) } }),
    ).toEqual([])
    expect(
      screenProblems({
        'Bad Id': { view: () => ({ type: 'screen', title: '', body: [] }) },
        main: { view: 'x', actions: { save: 1 } } as never,
      }),
    ).toEqual([
      '"Bad Id" is not a screen id: lower case letters, digits and dashes',
      '"main" has no view function',
      '"main"\'s action "save" is not a function',
    ])
  })
})

describe('what the back office decides without asking the extension', () => {
  const fields = [
    { kind: 'choice', name: 'matchKind', label: 'Match', options: [] },
    {
      kind: 'text',
      name: 'pattern',
      label: 'From',
      required: true,
      pattern: '/.*',
      hints: [{ when: { field: 'matchKind', equals: 'regex' }, text: 'Captures are $1 to $9.' }],
    },
    {
      kind: 'page',
      name: 'page',
      label: 'Page',
      visibleWhen: { field: 'targetKind', equals: 'document' },
      required: true,
    },
    { kind: 'number', name: 'status', label: 'Status', min: 301, max: 308 },
    { kind: 'secret', name: 'secret', label: 'Secret' },
  ]

  test('which fields show, and which hints apply', () => {
    expect(
      visibleFields(fields, { targetKind: 'url' }).map((f: { name: string }) => f.name),
    ).toEqual(['matchKind', 'pattern', 'status', 'secret'])
    expect(visibleFields(fields, { targetKind: 'document' })).toHaveLength(5)
    expect(hintsFor(fields[1], { matchKind: 'regex' })).toEqual(['Captures are $1 to $9.'])
    expect(hintsFor(fields[1], { matchKind: 'exact' })).toEqual([])
  })

  test('a form is checked before it is sent, and a hidden field is not', () => {
    expect(fieldProblems(fields, { targetKind: 'url', pattern: '' })).toEqual({
      pattern: 'From is required.',
    })
    expect(fieldProblems(fields, { pattern: 'no-slash', status: 200 })).toEqual({
      pattern: 'From is not in the form it takes.',
      status: 'Status is at least 301.',
    })
    expect(fieldProblems(fields, { pattern: '/a', targetKind: 'document' })).toEqual({
      page: 'Page is required.',
    })
  })

  test('what an action sends: its input, the form’s visible values, and the state; an untouched secret not', () => {
    const values = { pattern: '/a', page: 'k', targetKind: 'url', secret: '' }
    const sent = sentValues(fields, values, new Set())
    expect(sent).toEqual({ pattern: '/a' })
    expect(sentValues(fields, values, new Set(['secret']))).toEqual({ pattern: '/a', secret: '' })
    expect(
      actionBody({ action: 'save', submit: true, input: { key: 'k' } }, { page: 1 }, sent),
    ).toEqual({
      action: 'save',
      input: { key: 'k', values: { pattern: '/a' } },
      state: { page: 1 },
    })
    expect(actionBody({ action: 'remove' }, undefined, sent)).toEqual({
      action: 'remove',
      input: {},
      state: {},
    })
  })

  test('where a link may go, and where a screen answers', () => {
    expect(linkTarget('section/content', '/umbraco/')).toBe('/umbraco/section/content')
    expect(linkTarget('javascript:alert(1)', '/umbraco/')).toBeUndefined()
    expect(linkTarget('//evil.example', '/umbraco/')).toBeUndefined()
    expect(screenUrl('/umbraco/', 'redirects', 'rules')).toBe(
      '/umbraco/crombolo/api/bundle/redirects/_screen/rules',
    )
  })

  test('the element sets every string as text: it never renders markup', async () => {
    const source = await Bun.file(
      join(import.meta.dir, '../packages/backoffice-host/plugin/extension-screen.js'),
    ).text()
    expect(source).not.toMatch(/unsafeHTML|unsafeSVG|innerHTML|insertAdjacentHTML|\.innerText\s*=/)
  })
})

/** An extension whose screens try what a screen may, and what it may not. */
const PANEL = `import { button, cell, empty, field, form, notice, progress, row, screen, search, tab, table, tabs } from '@crombolo/extension'

export function panel() {
  return {
    id: 'panel',
    section: 'settings',
    capabilities: ['redirects'],
    screens: {
      main: {
        view: ({ principal, state }) => ({
          screen: screen('For ' + principal.name, [
            table(['From'], [row('a', [cell.text('/old')], [button('Remove', 'remove', { input: { key: 'a' }, confirm: 'Remove it?' })])]),
            form([field.text('pattern', 'From', { required: true }), field.secret('token', 'Token')], { pattern: '/old', token: 'leaked' }, [button('Save', 'save', { submit: true })]),
            tabs([tab('one', 'One', [progress({ value: 40 }), notice('In a tab')])]),
            empty('Nothing else'),
          ], { toolbar: [search('find')] }),
          state: { opened: (state.opened ?? 0) + 1 },
        }),
        actions: {
          save: ({ input, state }) => ({ screen: screen('Saved', [notice(String(input.values?.pattern))]), state, notice: 'Saved, opened ' + state.opened }),
          find: ({ input }) => screen('Found', [notice(String(input.query))]),
          remove: ({ input }) => screen('Removed ' + input.key, []),
          write: async ({ bundle }) => {
            await bundle.redirects.save({ matchKind: 'exact', pattern: '/x', targetKind: 'path', target: '/y', statusCode: 301 })
            return screen('Wrote', [])
          },
          read: async ({ bundle }) => screen('Rules: ' + typeof (await bundle.redirects.list()), []),
          hostile: () => ({
            type: 'screen',
            title: '<script>alert(1)</script>',
            body: [
              { type: 'html', html: '<img src=x onerror=alert(1)>' },
              { type: 'table', columns: ['<b onclick="x()">c</b>'], rows: [{ key: 'k', cells: [{ type: 'link', text: 'go', href: 'javascript:alert(1)' }] }] },
            ],
          }),
          boom: () => {
            throw new Error('it broke')
          },
        },
      },
    },
  }
}
`

async function panelSite() {
  const dir = siteDeclaring('extension-screens', {
    '@acme/panel': {
      json: {
        exports: './index.js',
        crombolo: {
          id: 'panel',
          name: 'Panel',
          server: 'panel',
          permissions: { 'redirects.read': 'Lists the rules' },
          extensions: [
            {
              type: 'dashboard',
              alias: 'Acme.Dashboard.Panel',
              name: 'Panel',
              screen: 'main',
              meta: { label: 'Panel', pathname: 'panel' },
            },
          ],
        },
      },
      files: { 'index.js': PANEL },
    },
  })
  const h = await signedInServer({
    config: {
      siteDir: dir,
      componentsDir: join(dir, 'components'),
      extensions: { panel: { grant: ['redirects.read'], timeoutMs: 5000 } },
    },
  })
  open.push(h)
  const call = async (body: object, client: Harness = h) => {
    const response = await client.post(`${BACKOFFICE}/crombolo/api/bundle/panel/_screen/main`, body)
    return {
      status: response.status,
      body: (await response.json().catch(() => undefined)) as never,
    }
  }
  return { h, dir, call }
}

type Answer = {
  screen: { title: string; body: { type: string; [key: string]: unknown }[]; toolbar?: unknown[] }
  state?: Record<string, unknown>
  notice?: string
  problem?: string
}

describe('a described screen, through its own process', () => {
  test('is listed by the package, and drawn by the back office’s element with nothing of its own', async () => {
    const { h, dir } = await panelSite()
    const read = readBundlePackage(join(dir, 'node_modules/@acme/panel'))
    expect(read.problems).toEqual([])
    const extension = extensionOf(read.bundle as never)
    const manifests = collectManifests(
      {
        pluginDir: '/nowhere',
        vendorDir: '/nowhere',
        pluginPath: '/umbraco/crombolo-plugin',
        assetsPath: '/umbraco/assets',
      } as never,
      extension ? [extension] : [],
    )
    const entry = manifests.all
      .flatMap((manifest) => manifest.extensions ?? [])
      .find((candidate) => (candidate as { alias?: string }).alias === 'Acme.Dashboard.Panel')
    expect(entry).toMatchObject({
      element: '/umbraco/crombolo-plugin/extension-screen.js',
      meta: { cromboloScreen: { bundle: 'panel', screen: 'main' } },
    })
    const served = JSON.stringify(await (await h.call(`${V1}/manifest/manifest`)).json())
    expect(served).toContain('extension-screen.js')
    expect(served).not.toContain('/bundles/@acme/panel')
  })

  test('its view is given the person, and its state comes back with the next call', async () => {
    const { call } = await panelSite()
    const first = await call({})
    expect(first.status).toBe(200)
    const answer = first.body as Answer
    expect(answer.screen.title).toBe('For Administrator')
    expect(answer.screen.body.map((node) => node.type)).toEqual(['table', 'form', 'tabs', 'empty'])
    expect(answer.screen.toolbar).toEqual([{ type: 'search', action: 'find' }])
    // The secret it filled in never reaches the browser.
    expect(answer.screen.body[1]?.values).toEqual({ pattern: '/old' })
    expect(answer.state).toEqual({ opened: 1 })
    const again = (await call({ state: answer.state })).body as Answer
    expect(again.state).toEqual({ opened: 2 })
  })

  test('an action is given its input, the form’s values and the state, and answers a notice', async () => {
    const { call } = await panelSite()
    const saved = (
      await call({ action: 'save', input: { values: { pattern: '/new' } }, state: { opened: 3 } })
    ).body as Answer
    expect(saved.screen.title).toBe('Saved')
    expect(saved.screen.body).toEqual([{ type: 'notice', text: '/new' }])
    expect(saved.notice).toBe('Saved, opened 3')
    const found = (await call({ action: 'find', input: { query: 'old' } })).body as Answer
    expect(found.screen.body).toEqual([{ type: 'notice', text: 'old' }])
  })

  test('reaches the site only as its grant allows: a refused capability is a problem, not a failure', async () => {
    const { call } = await panelSite()
    const read = (await call({ action: 'read' })).body as Answer
    expect(read.screen.title).toBe('Rules: object')
    const write = await call({ action: 'write' })
    expect(write.status).toBe(200)
    expect((write.body as Answer).problem).toMatch(/redirects\.write/)
  })

  test('what it answers outside the catalogue is dropped, and what it says is only text', async () => {
    const { call } = await panelSite()
    const answer = (await call({ action: 'hostile' })).body as Answer
    expect(answer.screen.title).toBe('<script>alert(1)</script>')
    expect(answer.screen.body).toEqual([
      {
        type: 'table',
        columns: ['<b onclick="x()">c</b>'],
        rows: [{ key: 'k', cells: [{ type: 'text', text: 'go' }] }],
      },
    ])
  })

  test('one that throws says why; an unknown screen or action is not found; only POST', async () => {
    const { h, call } = await panelSite()
    expect((await call({ action: 'boom' })).body as unknown).toEqual({ problem: 'it broke' })
    expect((await call({ action: 'nothing' })).status).toBe(404)
    expect((await h.post(`${BACKOFFICE}/crombolo/api/bundle/panel/_screen/other`, {})).status).toBe(
      404,
    )
    expect((await h.call(`${BACKOFFICE}/crombolo/api/bundle/panel/_screen/main`)).status).toBe(405)
  })

  test('is gated on its section, as its routes are', async () => {
    const { h, call } = await panelSite()
    const writer = await signInAsGroup(h, 'writer')
    expect((await call({}, writer)).status).toBe(403)
  })
})

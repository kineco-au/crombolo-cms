/**
 * Story 431: the site's own back-office sections. Each is a grant of its own, with
 * places and menus of screens the site's back-office code draws, built for the browser
 * and served from that build; and routes below it, given `site()` as the signed-in
 * user, whose queries know who is asking. An extension declares a section the same way,
 * its screens described.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  extensionOf,
  readBundlePackage,
  sectionManifests,
  sectionProblems,
} from '@crombolo/backoffice-host'
import { route } from '@crombolo/common'
import { isOk, ok } from '@crombolo/core'
import { defineSiteTables, type TablesDatabase } from '@crombolo/data'
import type { QueryCaller, SiteServices } from '@crombolo/render'
import { declaredAreas } from '../packages/backoffice-host/plugin/group-editor-words.js'
import {
  declaredSection,
  locate,
  panelAreas,
  screenManifest,
  screenPath,
} from '../packages/backoffice-host/plugin/site-section-model.js'
import {
  matchSiteBackOfficeRoute,
  type SiteBackOfficeConfig,
  type SiteSection,
  sectionClashes,
  siteBackOfficeProblems,
} from '../packages/server/src/site-backoffice.ts'
import { createSiteBackOfficeBuild } from '../packages/server/src/site-backoffice-build.ts'
import { fixtureDir, siteDeclaring } from './support/bundles.ts'
import { dialectUnderTest } from './support/db.ts'
import {
  BACKOFFICE,
  bootServer,
  type Harness,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const SCREEN = `import { LitElement, html } from '@umbraco-cms/backoffice/external/lit'
import { words } from './words.ts'
export default class Review extends LitElement {
  render() { return html\`<p>\${words}</p>\` }
}
customElements.define('site-review', Review)
`

/** A site holding its back-office code: two screens and a module they share. */
function siteWithScreens(extra: Record<string, string> = {}): string {
  const dir = siteDeclaring('site-backoffice', {})
  for (const [path, text] of Object.entries({
    'backoffice/review.ts': SCREEN,
    'backoffice/all.ts': SCREEN.replace('site-review', 'site-all'),
    'backoffice/words.ts': "export const words: string = 'Awaiting review'\n",
    ...extra,
  })) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const observations = (routes: SiteSection['routes'] = []) =>
  ({
    sections: [
      {
        alias: 'observations',
        label: 'Observations',
        places: [
          {
            alias: 'records',
            label: 'Records',
            menu: [
              { alias: 'review', label: 'Awaiting review', module: './backoffice/review.ts' },
              { alias: 'all', label: 'All', module: './backoffice/all.ts' },
            ],
          },
          {
            alias: 'species',
            label: 'Species',
            menu: [{ alias: 'list', label: 'Species', module: './backoffice/all.ts' }],
          },
        ],
        routes,
      },
    ],
  }) satisfies SiteBackOfficeConfig

describe('the config', () => {
  test('a section, its places and screens are checked, every problem named', () => {
    const dir = siteWithScreens()
    expect(siteBackOfficeProblems(observations(), dir)).toEqual([])
    const bad: SiteBackOfficeConfig = {
      sections: [
        {
          alias: 'content',
          label: '',
          places: [
            {
              alias: 'Records',
              label: 'Records',
              menu: [
                { alias: 'a', label: 'A', module: './backoffice/missing.ts' },
                { alias: 'a', label: 'A again', module: '../elsewhere.ts' },
                { alias: 'b', label: 'B', module: 'backoffice/review.css' },
              ],
            },
          ],
          routes: [route('/absolute', { GET: () => new Response() })],
        },
      ],
    }
    const problems = siteBackOfficeProblems(bad, dir).join('\n')
    for (const said of [
      "takes the address of one of the back office's own sections",
      'has no label',
      'place "Records": the alias is not one',
      'its module ./backoffice/missing.ts is not there',
      'screen "a" is declared twice',
      'its module backoffice/review.css is not a .ts, .tsx or .js file',
      "a back-office route's path is relative to its section's",
    ])
      expect(problems).toContain(said)
  })

  test('a section an extension claims too is named, by both', () => {
    expect(
      sectionClashes(observations(), [
        {
          name: 'the extension @acme/obs',
          sections: [{ alias: 'Acme.Section.Obs', path: 'observations' }],
        },
      ]),
    ).toEqual([
      'the site and the extension @acme/obs both claim the section at section/observations.',
    ])
  })

  test('a route is found below its section, with its parameters', () => {
    const config = observations([route('records/:id', { GET: () => new Response() })])
    expect(matchSiteBackOfficeRoute(config, 'observations/records/7')).toMatchObject({
      grant: 'Site.Section.observations',
      params: { id: '7' },
    })
    expect(matchSiteBackOfficeRoute(config, 'observations/nothing')?.route).toBeUndefined()
    expect(matchSiteBackOfficeRoute(config, 'elsewhere/records/7')).toBeUndefined()
  })
})

/** A package the site depends on, holding a panel's module, as a wrapper around the site's config would. */
function withHostPackage(dir: string): void {
  const pkg = join(dir, 'node_modules', '@acme', 'host')
  mkdirSync(join(pkg, 'backoffice'), { recursive: true })
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: '@acme/host', version: '1.0.0', type: 'module' }),
  )
  writeFileSync(
    join(pkg, 'backoffice', 'drawer.ts'),
    "class Drawer extends HTMLElement {}\ncustomElements.define('acme-drawer', Drawer)\nexport default Drawer\n",
  )
}

describe('the site’s panels (story 437)', () => {
  test('are checked: an alias of their own, and a module in the site or a package it depends on', () => {
    const dir = siteWithScreens()
    withHostPackage(dir)
    expect(
      siteBackOfficeProblems(
        {
          ...observations(),
          panels: [
            { alias: 'help', label: 'Help', module: '@acme/host/backoffice/drawer.ts' },
            { alias: 'notes', label: 'Notes', module: './backoffice/review.ts' },
          ],
        },
        dir,
      ),
    ).toEqual([])
    const problems = siteBackOfficeProblems(
      {
        ...observations(),
        panels: [
          { alias: 'observations', label: 'Same', module: './backoffice/review.ts' },
          { alias: 'gone', label: 'Gone', module: '@acme/nowhere/drawer.ts' },
          { alias: 'abs', label: 'Abs', module: '/etc/drawer.ts' },
        ],
      },
      dir,
    ).join('\n')
    for (const said of [
      'has the alias of another section or panel',
      'its module @acme/nowhere/drawer.ts is in no package the site depends on',
      'its module /etc/drawer.ts is neither a path in the site starting with ./ nor a package',
    ])
      expect(problems).toContain(said)
  })

  test('a panel from a package is built and loaded as a side panel, behind a grant of its own', async () => {
    const dir = siteWithScreens()
    withHostPackage(dir)
    const config: SiteBackOfficeConfig = {
      panels: [
        {
          alias: 'help',
          label: 'Help',
          icon: 'icon-help',
          module: '@acme/host/backoffice/drawer.ts',
        },
      ],
    }
    const build = createSiteBackOfficeBuild(dir, config, () => {})
    const built = (await build.ready()) as string
    expect(
      await Bun.file(
        join(built, 'node_modules', '@acme', 'host', 'backoffice', 'drawer.js'),
      ).text(),
    ).toContain('"acme-drawer"')
    expect((await build.manifest())?.extensions).toEqual([
      {
        type: 'sidePanel',
        alias: 'Site.Panel.help',
        name: 'Help',
        element: '/crombolo-plugin/site/node_modules/@acme/host/backoffice/drawer.js',
        meta: {
          label: 'Help',
          icon: 'icon-help',
          defaultWidth: 360,
          toggle: true,
          cromboloGrant: { alias: 'Site.Panel.help', label: 'Help' },
        },
        conditions: [{ alias: 'Umb.Condition.SectionUserPermission', match: 'Site.Panel.help' }],
      },
    ])
    expect(panelAreas((await build.manifest())?.extensions as never)).toEqual([
      { section: 'Site.Panel.help', label: 'Help', line: 'A panel beside every section.' },
    ])
  })

  test('story 438: an entry point runs as the back office starts; a panel for everyone needs no grant', async () => {
    const dir = siteWithScreens({
      'backoffice/start.ts': 'export const onInit = () => {}\n',
    })
    const config: SiteBackOfficeConfig = {
      entryPoints: ['./backoffice/start.ts'],
      panels: [{ alias: 'help', label: 'Help', module: './backoffice/review.ts', everyone: true }],
    }
    expect(siteBackOfficeProblems(config, dir)).toEqual([])
    expect(
      siteBackOfficeProblems({ entryPoints: ['./backoffice/missing.ts'] }, dir).join(),
    ).toContain('The back-office entry point: its module ./backoffice/missing.ts is not there')
    const build = createSiteBackOfficeBuild(dir, config, () => {})
    const extensions = ((await build.manifest())?.extensions ?? []) as Array<
      Record<string, unknown>
    >
    expect(extensions[0]).toEqual({
      type: 'backofficeEntryPoint',
      alias: 'Site.EntryPoint.1',
      name: "The site's ./backoffice/start.ts",
      js: '/crombolo-plugin/site/backoffice/start.js',
    })
    const panel = extensions[1] as { conditions?: unknown; meta: Record<string, unknown> }
    expect(panel.conditions).toBeUndefined()
    expect(panel.meta.cromboloGrant).toBeUndefined()
    expect(panelAreas(extensions as never)).toEqual([])
    expect(matchSiteBackOfficeRoute(config, 'help')?.grant).toBeUndefined()
  })

  test('a panel’s route answers only those who hold its grant', () => {
    const config: SiteBackOfficeConfig = {
      panels: [
        {
          alias: 'help',
          label: 'Help',
          module: './backoffice/review.ts',
          routes: [route('answers/:id', { GET: () => new Response() })],
        },
      ],
    }
    expect(matchSiteBackOfficeRoute(config, 'help/answers/4')).toMatchObject({
      grant: 'Site.Panel.help',
      params: { id: '4' },
    })
  })
})

describe('the build', () => {
  test('each screen and what it imports is built for the browser, the back office’s modules left as imports', async () => {
    const dir = siteWithScreens()
    const build = createSiteBackOfficeBuild(dir, observations(), () => {})
    const built = await build.ready()
    expect(built).toBe(join(dir, '.crombolo', 'site', 'backoffice'))
    const review = await Bun.file(join(built as string, 'backoffice', 'review.js')).text()
    expect(review).toContain('"site-review"')
    expect(review).toContain('@umbraco-cms/backoffice/external/lit')
    // What both screens import is bundled once, beside them.
    const chunks = [...new Bun.Glob('chunks/*.js').scanSync(built as string)]
    expect(chunks).toHaveLength(1)
    expect(await Bun.file(join(built as string, chunks[0] as string)).text()).toContain(
      'Awaiting review',
    )
    const manifest = await build.manifest()
    expect(manifest?.extensions).toEqual(
      sectionManifests({
        alias: 'Site.Section.observations',
        pathname: 'observations',
        label: 'Observations',
        places: [
          {
            alias: 'records',
            label: 'Records',
            menu: [
              {
                alias: 'review',
                label: 'Awaiting review',
                element: '/crombolo-plugin/site/backoffice/review.js',
              },
              { alias: 'all', label: 'All', element: '/crombolo-plugin/site/backoffice/all.js' },
            ],
          },
          {
            alias: 'species',
            label: 'Species',
            menu: [
              {
                alias: 'list',
                label: 'Species',
                element: '/crombolo-plugin/site/backoffice/all.js',
              },
            ],
          },
        ],
      }),
    )
  })

  test('code that asks with the browser’s own dialogs is not built, and its sections are left out, saying why', async () => {
    const dir = siteWithScreens({
      'backoffice/words.ts': "if (confirm('Sure?')) alert('Yes')\nexport const words = 'x'\n",
    })
    const said: string[] = []
    const build = createSiteBackOfficeBuild(dir, observations(), (_message, properties) =>
      said.push(String(properties.reason)),
    )
    expect(await build.manifest()).toBeUndefined()
    expect(build.failed()).toContain('backoffice/words.ts uses alert, confirm')
    expect(said).toHaveLength(1)
    expect(existsSync(join(dir, '.crombolo', 'site', 'backoffice'))).toBe(false)
  })
})

describe('the back office', () => {
  test('a declared section is found from its manifest, its place and screen from the address', () => {
    const [section] = sectionManifests({
      alias: 'Site.Section.observations',
      pathname: 'observations',
      label: 'Observations',
      places: [
        { alias: 'records', label: 'Records', menu: [{ alias: 'review', label: 'Review' }] },
        {
          alias: 'species',
          label: 'Species',
          menu: [
            { alias: 'list', label: 'List' },
            { alias: 'new', label: 'New', screen: { bundle: 'acme', screen: 'new' } },
          ],
        },
      ],
    })
    const found = declaredSection(section as never)
    expect(declaredSection({ alias: 'Umb.Section.Content', meta: { pathname: 'content' } })).toBe(
      undefined,
    )
    const sections = [found as NonNullable<typeof found>]
    expect(locate('section/observations', sections)).toMatchObject({
      place: { alias: 'records' },
      screen: { alias: 'review' },
    })
    expect(locate('section/observations/species/new', sections)).toMatchObject({
      place: { alias: 'species' },
      screen: { alias: 'new' },
    })
    expect(locate('section/observations/species/gone', sections)?.screen?.alias).toBe('list')
    expect(locate('section/content', sections)).toBeUndefined()
    const species = sections[0]?.places[1] as never
    expect(screenPath(sections[0] as never, species)).toBe('section/observations/species/list')
    const screen = (sections[0]?.places[1]?.menu[1] ?? {}) as never
    expect(screenManifest(sections[0] as never, screen)).toMatchObject({
      alias: 'Site.Section.observations.new',
      meta: { cromboloScreen: { bundle: 'acme', screen: 'new' } },
    })
    expect(declaredAreas(sections)).toEqual([
      { section: 'Site.Section.observations', label: 'Observations', line: 'Records, Species.' },
    ])
  })
})

describe('an extension’s section', () => {
  const field = (sections: unknown, server: string | null = 'acme') => ({
    bundleType: 'extension',
    id: 'acme-obs',
    schemaVersion: 6,
    permissions: {},
    ...(server ? { server } : {}),
    sections,
  })

  test('is checked, and its screens need a server half to describe them', () => {
    expect(
      sectionProblems(
        field([
          {
            alias: 'Acme.Section.Obs',
            path: 'obs',
            label: 'Obs',
            places: [{ alias: 'a', label: 'A', menu: [{ alias: 'x', label: 'X', screen: 'x' }] }],
          },
        ]),
      ),
    ).toEqual([])
    const problems = sectionProblems(
      field(
        [
          { alias: 'Site.Section.obs', path: 'Obs', label: '', places: [] },
          {
            alias: 'Acme.Section.Two',
            path: 'two',
            label: 'Two',
            places: [{ alias: 'a', label: 'A', menu: [{ alias: 'x', label: 'X' }] }],
          },
        ],
        null,
      ),
    ).join('\n')
    for (const said of [
      'needs an alias of its own',
      'needs a path',
      'has no label',
      'has no places',
      'a menu entry without an alias, a label and the screen it shows',
      'no server half to describe their screens',
    ])
      expect(problems).toContain(said)
  })

  test('is loaded as a section whose screens the back office draws from their descriptions', () => {
    const dir = siteDeclaring('extension-section', {
      '@acme/obs': {
        json: {
          exports: './src/server/index.js',
          crombolo: field([
            {
              alias: 'Acme.Section.Obs',
              path: 'obs',
              label: 'Obs',
              places: [{ alias: 'a', label: 'A', menu: [{ alias: 'x', label: 'X', screen: 'x' }] }],
            },
          ]),
        },
        files: { 'src/server/index.js': 'export const acme = () => ({})\n' },
      },
    })
    const { bundle, problems } = readBundlePackage(fixtureDir(dir, '@acme/obs'))
    expect(problems).toEqual([])
    const section = extensionOf(bundle as never)?.manifest.extensions.find(
      (entry) => (entry as { type: string }).type === 'section',
    )
    expect(section).toMatchObject({
      alias: 'Acme.Section.Obs',
      meta: {
        pathname: 'obs',
        cromboloPlaces: [
          {
            alias: 'a',
            menu: [
              {
                alias: 'x',
                element: '/crombolo-plugin/extension-screen.js',
                screen: { bundle: 'acme-obs', screen: 'x' },
              },
            ],
          },
        ],
      },
    })
  })
})

const tables = defineSiteTables([
  {
    name: 'records',
    release: '1.0.0',
    up: (s) => s.createTable('records', { id: s.integer().primaryKey(), note: s.text() }),
  },
])
type Db = TablesDatabase<typeof tables>

/** One query for pages and staff alike, which tells them apart. */
const records = {
  async who(_db: Db, caller: QueryCaller) {
    const user = await caller.user()
    const member = await caller.member()
    return ok({
      user: user?.email ?? null,
      groups: user?.groups ?? [],
      member: member?.key ?? null,
    })
  },
}

const SECTION_API = `${BACKOFFICE}/crombolo/api/site/observations`

/** Someone in a group given the site's section, and Members. */
async function staffOf(h: Harness): Promise<Harness> {
  const created = await h.post(`${V1}/user-group`, {
    name: 'Moderators',
    alias: 'moderators',
    sections: ['Site.Section.observations', 'Umb.Section.Members'],
    languages: [],
    hasAccessToAllLanguages: true,
    documentRootAccess: false,
    documentStartNode: null,
    mediaRootAccess: false,
    mediaStartNode: null,
    elementRootAccess: false,
    elementStartNode: null,
    fallbackPermissions: [],
    permissions: [],
  })
  expect(created.status, await created.clone().text()).toBe(201)
  return signInAsGroup(h, 'moderators')
}

describe(`on a real server (${dialectUnderTest})`, () => {
  const server = async (config: Record<string, unknown> = {}) => {
    const dir = siteWithScreens()
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        database: { tables },
        queries: { records },
        backoffice: observations([
          route('who', {
            async GET(_request, { site, principal }) {
              const services = site() as SiteServices
              const asked = await services.queries.records?.who?.()
              const members = await services.members.list({})
              return Response.json({
                principal: (principal as { email: string }).email,
                asked: asked && isOk(asked) ? asked.value : null,
                members: isOk(members) ? 'read' : members.status,
              })
            },
          }),
          route('fails', {
            GET() {
              throw new Error('the records are missing')
            },
          }),
        ]),
        routes: [
          route('/who', {
            async GET(_request, { site }) {
              const asked = await (site() as SiteServices).queries.records?.who?.()
              return Response.json(asked && isOk(asked) ? asked.value : null)
            },
          }),
        ],
        ...config,
      },
    })
    open.push(h)
    return h
  }

  test('a route runs as the signed-in user, and its queries know them; a page’s know nobody', async () => {
    const h = await server()
    const staff = await staffOf(h)
    const answer = await staff.call(`${SECTION_API}/who`)
    expect(answer.status, await answer.clone().text()).toBe(200)
    expect(await answer.json()).toEqual({
      principal: 'moderators@example.com',
      asked: { user: 'moderators@example.com', groups: ['moderators'], member: null },
      members: 'read',
    })
    expect(await (await h.call('/who')).json()).toEqual({ user: null, groups: [], member: null })

    // A throw is a problem with a reference, logged under it.
    const failed = await staff.call(`${SECTION_API}/fails`)
    expect(failed.status).toBe(500)
    expect(((await failed.json()) as { reference?: string }).reference).toMatch(/^[0-9A-F]{10}$/)
  })

  test('nobody without the section reaches a route, and nobody signed out', async () => {
    const h = await server()
    expect((await h.server.fetch(new Request(`http://localhost${SECTION_API}/who`))).status).toBe(
      401,
    )
    const writer = await signInAsGroup(h, 'writer')
    expect((await writer.call(`${SECTION_API}/who`)).status).toBe(403)
    expect((await h.call(`${SECTION_API}/who`)).status).toBe(403)
  })

  test('the section is in the manifest, its code served from its build, and Access offers it', async () => {
    const h = await server()
    const manifests = JSON.stringify(await h.json(`${V1}/manifest/manifest`))
    expect(manifests).toContain('"Site.Section.observations"')
    expect(manifests).toContain(`${BACKOFFICE}/crombolo/site/backoffice/review.js`)
    const code = await h.call(`${BACKOFFICE}/crombolo/site/backoffice/review.js`)
    expect(code.status).toBe(200)
    expect(await code.text()).toContain('"site-review"')
    expect((await h.call(`${BACKOFFICE}/crombolo/site/../package.json`)).status).not.toBe(200)
    expect((await h.call(`${BACKOFFICE}/crombolo/site/backoffice/words.ts`)).status).toBe(404)
  })

  test('a section an extension claims too, or a module that is not there, refuses the boot by name', async () => {
    const dir = siteWithScreens()
    await expect(
      signedInServer({
        config: {
          siteDir: dir,
          componentsDir: join(dir, 'components'),
          backoffice: {
            sections: [
              {
                alias: 'observations',
                label: 'Observations',
                places: [
                  {
                    alias: 'records',
                    label: 'Records',
                    menu: [{ alias: 'gone', label: 'Gone', module: './backoffice/gone.ts' }],
                  },
                ],
              },
            ],
          },
        },
      }),
    ).rejects.toThrow('its module ./backoffice/gone.ts is not there')
  })

  test('a web node serves none of it', async () => {
    const dir = siteWithScreens()
    const config = {
      siteDir: dir,
      componentsDir: join(dir, 'components'),
      sqliteFile: join(dir, 'site.sqlite'),
      backoffice: observations([route('who', { GET: () => new Response('here') })]),
    }
    // The api node migrates; the web node beside it does not.
    await (await bootServer({ config })).db.close()
    const web = await bootServer({ config: { ...config, role: 'web' }, keepDatabase: true })
    try {
      // Signed out, an api node answers 401: a web node has no such address at all.
      expect((await web.fetch(new Request(`http://localhost${SECTION_API}/who`))).status).toBe(404)
    } finally {
      await web.db.close()
    }
  })
})

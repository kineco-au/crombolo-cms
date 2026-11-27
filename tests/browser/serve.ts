/**
 * Boots crombolo for the browser suite on a throwaway copy of apps/site: its
 * schema and views, a fresh SQLite file, a known admin password.
 */
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { packageInRoot, prepareRoot, recordExtension } from '@crombolo/backoffice-host'
import { DEFAULT_DATA_TYPES, UserGroupRepository } from '@crombolo/data'
import { createServer, loadConfig, VERSION } from '@crombolo/server'
import { signIn, V1 } from '../support/harness.ts'
import {
  BLOCK_ONLY_ELEMENT_TYPE,
  BROWSER_ADMIN,
  CLOSED_SITE_HOME,
  MEMBER_DIRECTORY,
  MEMBERS_CONTENT_SITE,
} from './fixtures.ts'

const repo = join(import.meta.dir, '../..')
mkdirSync(join(repo, 'output'), { recursive: true })

/**
 * Sweeps the sites earlier runs left behind.
 *
 * `stop` below removes this run's copy, but only on SIGTERM and SIGINT — a
 * SIGKILL, a crash, or Playwright giving up on the web server leaves one. Each is
 * a few megabytes, mostly SQLite WAL, and they accumulate silently because
 * `output/` is gitignored: 273 of them, 1.1 GB, had collected before anyone
 * looked. On a CI runner the same leak is disk pressure during the run.
 */
for (const entry of readdirSync(join(repo, 'output'), { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('browser-site-'))
    rmSync(join(repo, 'output', entry.name), { recursive: true, force: true })
}

const root = mkdtempSync(join(repo, 'output', 'browser-site-'))
cpSync(join(repo, 'apps/site/schema'), join(root, 'schema'), { recursive: true })
cpSync(join(repo, 'apps/site/components'), join(root, 'components'), { recursive: true })

// The demo's real contact form, for the page editor's form picker regression.
mkdirSync(join(root, 'schema', 'forms'), { recursive: true })
cpSync(
  join(repo, 'sites/harbourstone/schema/forms/contact.toml'),
  join(root, 'schema/forms/harbourstone-contact.toml'),
)
writeFileSync(
  join(root, 'schema/content-types/contact-form-test.toml'),
  `[content-type]
alias = "contactFormTest"
name = "Contact form test"
allow-at-root = true

[[tab]]
name = "Form"

[[tab.property]]
alias = "enquiryForm"
name = "Form"
type = "formPicker"
`,
)

// A content type with a property for every built-in data type, for the
// editor-coverage tests, and a view that renders a crop of its image picker.
const editors = DEFAULT_DATA_TYPES.filter((d) => d.editorAlias !== 'Umbraco.ListView')
writeFileSync(
  join(root, 'schema', 'content-types', 'every-editor.toml'),
  `[content-type]\nalias = "everyEditor"\nname = "Every editor"\nallow-at-root = true\ncomponents = ["everyEditor"]\ndefault-component = "everyEditor"\n${editors
    .map((d) => `\n[[property]]\nalias = "${d.alias}"\nname = "${d.name}"\ntype = "${d.alias}"\n`)
    .join('')}`,
)
writeFileSync(
  join(root, 'components', 'everyEditor.tsx'),
  `export default async function EveryEditor({ model }) {
  const hero = await model.value('imageMediaPicker')
  return <main><h1>{model.name}</h1><img class="hero" src={hero?.cropUrl({ width: 40, height: 40 })} /></main>
}
`,
)

// A page that varies by culture, for the two-language tests
writeFileSync(
  join(root, 'schema', 'content-types', 'variant-page.toml'),
  `[content-type]
alias = "variantPage"
name = "Variant page"
allow-at-root = true
components = ["variantPage"]
default-component = "variantPage"
varies-by-culture = true

[[property]]
alias = "title"
name = "Title"
type = "textstring"
varies-by-culture = true
`,
)
writeFileSync(
  join(root, 'components', 'variantPage.tsx'),
  `export default function VariantPage({ model, culture }) {
  return <main><h1>{model.name}</h1><p class="title">{model.text('title', { fallback: 'language' })}</p><i>{culture}</i></main>
}
`,
)

// An e-mail template, for the forms designer's "E-mail design" picker
mkdirSync(join(root, 'components', 'emails'), { recursive: true })
writeFileSync(
  join(root, 'components', 'emails', 'receipt.tsx'),
  `import type { EmailProps } from '@crombolo/crombolo'
export default function Receipt({ form }: EmailProps) {
  return <p>{form.name}</p>
}
`,
)

// An element type that is not allowed in the Library, for the workspace hint.
// Written here rather than borrowed from the site: the backoffice rewrites the
// site's own schema whenever someone flips that toggle, and did — the type this
// test used to lean on has carried `allow-in-library` since it was committed.
writeFileSync(
  join(root, 'schema', 'content-types', 'block-only.toml'),
  `[content-type]
key = "${BLOCK_ONLY_ELEMENT_TYPE}"
alias = "blockOnly"
name = "Block only"
is-element = true

[[property]]
alias = "text"
name = "Text"
type = "textstring"
`,
)

// A page with a block list of that element type, for the block alias test (story 253)
writeFileSync(
  join(root, 'schema', 'data-types', 'aliased-blocks.toml'),
  `[data-type]
alias = "aliasedBlocks"
name = "Aliased blocks"
editor = "Umbraco.BlockList"
editor-ui = "Umb.PropertyEditorUi.BlockList"

[[data-type.block]]
element = "blockOnly"
`,
)
writeFileSync(
  join(root, 'schema', 'content-types', 'aliased-blocks-page.toml'),
  `[content-type]
alias = "aliasedBlocksPage"
name = "Aliased blocks page"
allow-at-root = true

[[property]]
alias = "blocks"
name = "Blocks"
type = "aliasedBlocks"
`,
)

// A bundle with a side panel and its header toggle, for the side-panel test
// (story 182). The panel counts clicks, so a test can tell its state survived.
// Each fixture extension in a root of its own, recorded, as an install puts it (story 326).
prepareRoot(root, 'test-side-panel')
recordExtension(root, 'test-side-panel', { name: 'test-side-panel', version: '1.0.0' })
const sidePanel = packageInRoot(root, 'test-side-panel', 'test-side-panel')
mkdirSync(sidePanel, { recursive: true })
writeFileSync(
  join(root, 'package.json'),
  JSON.stringify({
    name: 'browser-site',
    private: true,
    dependencies: {
      // The shipped Redirects, linked from the workspace as a developer's is (stories 326, 329).
      '@crombolo/simple-redirects': 'workspace:*',
    },
  }),
)
mkdirSync(join(sidePanel, 'src', 'server'), { recursive: true })
writeFileSync(
  join(sidePanel, 'package.json'),
  JSON.stringify({
    name: 'test-side-panel',
    version: '1.0.0',
    type: 'module',
    exports: './src/server/index.js',
    peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
    crombolo: {
      bundleType: 'extension',
      id: 'test-side-panel',
      server: 'testSidePanel',
      schemaVersion: 6,
      // Its server half may reach this origin; the back office may not (stories 313, 431).
      permissions: {
        'http.outbound': { reason: 'Reads its notes', origins: ['https://notes.crombolo.test'] },
      },
      extensions: [
        {
          type: 'sidePanel',
          alias: 'Test.SidePanel.Notes',
          name: 'Notes',
          screen: 'notes',
          meta: { label: 'Notes', icon: 'icon-notepad', defaultWidth: 360, toggle: true },
        },
      ],
    },
  }),
)
// A screen it describes (story 431): a button that counts its clicks in the screen's state.
writeFileSync(
  join(sidePanel, 'src', 'server', 'index.js'),
  `import { button, screen } from '@crombolo/extension'

const draw = (count) => screen('Notes', [button('Clicked ' + count, 'count', { input: { count } })])

export function testSidePanel() {
  return {
    id: 'test-side-panel',
    section: 'content',
    capabilities: [],
    screens: {
      notes: {
        view: ({ state }) => ({ screen: draw(state.count ?? 0), state: { count: state.count ?? 0 } }),
        actions: {
          count: ({ state }) => ({ screen: draw(state.count + 1), state: { count: state.count + 1 } }),
        },
      },
    },
  }
}
`,
)

// An extension whose Settings dashboard is a screen it describes (story 323): a
// table of rules with a confirmed Delete, and a form whose fields depend on a choice.
prepareRoot(root, 'test-screens')
recordExtension(root, 'test-screens', { name: 'test-screens', version: '1.0.0' })
const screens = packageInRoot(root, 'test-screens', 'test-screens')
mkdirSync(join(screens, 'src', 'server'), { recursive: true })
writeFileSync(
  join(screens, 'package.json'),
  JSON.stringify({
    name: 'test-screens',
    version: '1.0.0',
    type: 'module',
    exports: './src/server/index.js',
    peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
    crombolo: {
      bundleType: 'extension',
      id: 'test-screens',
      server: 'testScreens',
      schemaVersion: 6,
      permissions: {},
      extensions: [
        {
          type: 'dashboard',
          alias: 'Test.Dashboard.Screens',
          name: 'Test screens',
          screen: 'main',
          meta: { label: 'Test screens', pathname: 'test-screens' },
          conditions: [{ alias: 'Umb.Condition.SectionAlias', match: 'Umb.Section.Settings' }],
        },
      ],
    },
  }),
)
writeFileSync(
  join(screens, 'src', 'server', 'index.js'),
  `import { button, cell, field, form, row, screen, table } from '@crombolo/extension'

const draw = (rules) =>
  screen('Test screens', [
    table(['Rule'], rules.map((rule) => row(rule, [cell.code(rule)], [button('Delete', 'remove', { input: { rule }, confirm: 'Delete ' + rule + '?', look: 'danger' })]))),
    form(
      [
        field.choice('kind', 'Kind', [{ value: 'path', label: 'A path' }, { value: 'url', label: 'Another site' }]),
        field.text('rule', 'Rule', { required: true, visibleWhen: { field: 'kind', equals: 'path' } }),
        field.text('url', 'Address', { visibleWhen: { field: 'kind', equals: 'url' } }),
      ],
      { kind: 'path' },
      [button('Add', 'add', { submit: true, look: 'primary' })],
    ),
  ])

export function testScreens() {
  return {
    id: 'test-screens',
    section: 'settings',
    capabilities: [],
    screens: {
      main: {
        view: ({ state }) => ({ screen: draw(state.rules ?? ['/first']), state: { rules: state.rules ?? ['/first'] } }),
        actions: {
          add: ({ input, state }) => {
            const rules = [...state.rules, input.values.rule]
            return { screen: draw(rules), state: { rules }, notice: 'Added ' + input.values.rule }
          },
          remove: ({ input, state }) => {
            const rules = state.rules.filter((rule) => rule !== input.rule)
            return { screen: draw(rules), state: { rules }, notice: 'Deleted ' + input.rule }
          },
        },
      },
    },
  }
}
`,
)

// A section of the site's own (story 431): two places, the first with two screens its
// back-office code draws, one counting clicks so a test can tell its state is kept.
mkdirSync(join(root, 'backoffice'), { recursive: true })
writeFileSync(
  join(root, 'backoffice', 'review.ts'),
  `const words: string = 'Awaiting review'
class Review extends HTMLElement {
  count = 0
  connectedCallback() {
    if (this.button) return
    const heading = document.createElement('h1')
    heading.textContent = words
    this.button = document.createElement('button')
    this.button.textContent = 'Reviewed 0'
    this.button.addEventListener('click', () => {
      this.count += 1
      this.button.textContent = 'Reviewed ' + this.count
    })
    this.append(heading, this.button)
  }
  button?: HTMLButtonElement
}
customElements.define('site-review', Review)
export default Review
`,
)
// Code of the site's own as the back office starts (story 438): it says it ran.
writeFileSync(
  join(root, 'backoffice', 'start.ts'),
  "export const onInit = () => {\n  document.documentElement.dataset.siteStarted = 'yes'\n}\n",
)
// A panel of the site's own (story 437), beside every section for whoever holds its grant.
writeFileSync(
  join(root, 'backoffice', 'help.ts'),
  `class Help extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<h2>Help for staff</h2>'
  }
}
customElements.define('site-help', Help)
export default Help
`,
)
writeFileSync(
  join(root, 'backoffice', 'list.ts'),
  `class List extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<h1>Every record</h1>'
  }
}
customElements.define('site-list', List)
export default List
`,
)

// Links the site "e-mails", for the invitation and password-reset tests to follow
const LINKS = join(repo, 'output', 'browser-links.jsonl')
writeFileSync(LINKS, '')

const port = Number(Bun.env.CROMBOLO_BROWSER_PORT ?? 3210)
const server = await createServer(
  loadConfig(
    {
      port,
      sqliteFile: join(root, 'site.sqlite'),
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      adminLogin: BROWSER_ADMIN.login,
      adminPassword: BROWSER_ADMIN.password,
      development: true,
      // Development would otherwise send `no-cache` for every vendored asset, so
      // the browser would re-fetch all ~6,500 modules of the client on each of the
      // forty-odd sign-ins this suite performs. That is enough to exhaust Chromium
      // on a CI runner: it starts refusing requests with ERR_INSUFFICIENT_RESOURCES,
      // the module graph fails to link, and every test after it fails for a reason
      // that has nothing to do with the test. This process vendors once and never
      // re-vendors, so the hashed path is safe to cache.
      immutableAssets: true,
      allowPasswordReset: true,
      // Story 384: the workspace switch, at the head of Content; Shared is as before until one is chosen.
      workspaces: true,
      // Story 445: members this client creates are kept by it; members-managed.browser.ts makes it.
      // Story 444: the second site below says who acted; members-elsewhere.browser.ts makes its account.
      members: { managedBy: [MEMBER_DIRECTORY.id], actorsFrom: [MEMBERS_CONTENT_SITE.id] },
      // Seals the site's own signing key, which Trusted signers lists (story 316).
      secretKey: 'browser-suite-secret-key-that-is-long-enough-0123',
      backoffice: {
        panels: [
          { alias: 'help', label: 'Help', icon: 'icon-help', module: './backoffice/help.ts' },
        ],
        entryPoints: ['./backoffice/start.ts'],
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
                  { alias: 'all', label: 'All records', module: './backoffice/list.ts' },
                ],
              },
              {
                alias: 'species',
                label: 'Species',
                menu: [{ alias: 'list', label: 'Species', module: './backoffice/list.ts' }],
              },
            ],
          },
        ],
      },
      // The site's code grants what each asks for, so it runs (story 310).
      extensions: {
        'test-side-panel': {
          grant: ['http.outbound'],
          origins: ['https://notes.crombolo.test'],
        },
        'test-screens': { grant: [] },
        redirects: { grant: ['redirects.read', 'redirects.write', 'content.read'] },
      },
      sendUserLink: async (message) => {
        appendFileSync(
          LINKS,
          `${JSON.stringify({ email: message.to.email, kind: message.kind, link: message.link })}\n`,
        )
      },
    },
    root,
  ),
)
// Administrators are given the site's section, as a group is in Users (story 431).
{
  const groups = new UserGroupRepository(server.db)
  const admin = await groups.byAlias('admin')
  if (admin)
    await groups.save({
      ...admin,
      sections: [...new Set([...admin.sections, 'Site.Section.observations', 'Site.Panel.help'])],
    })
}
Bun.serve(server.serveOptions)
console.log(`browser suite server on http://localhost:${port} (site ${root})`)

// Story 444: a second site, content made here and members held by the suite's server.
const contentRoot = mkdtempSync(join(repo, 'output', 'browser-site-'))
cpSync(join(repo, 'apps/site/schema'), join(contentRoot, 'schema'), { recursive: true })
cpSync(join(repo, 'apps/site/components'), join(contentRoot, 'components'), { recursive: true })
const contentSite = await createServer(
  loadConfig(
    {
      port: port + 1,
      sqliteFile: join(contentRoot, 'site.sqlite'),
      schemaDir: join(contentRoot, 'schema'),
      componentsDir: join(contentRoot, 'components'),
      mediaDir: join(contentRoot, 'media'),
      adminLogin: BROWSER_ADMIN.login,
      adminPassword: BROWSER_ADMIN.password,
      development: true,
      immutableAssets: true,
      members: { source: `http://localhost:${port}`, client: MEMBERS_CONTENT_SITE },
    },
    contentRoot,
  ),
)
Bun.serve(contentSite.serveOptions)
console.log(`its content site on http://127.0.0.1:${port + 1} (site ${contentRoot})`)

// Story 446: a third, open only to its back-office users; site-access.browser.ts signs in to it.
const closedRoot = mkdtempSync(join(repo, 'output', 'browser-site-'))
cpSync(join(repo, 'apps/site/schema'), join(closedRoot, 'schema'), { recursive: true })
cpSync(join(repo, 'apps/site/components'), join(closedRoot, 'components'), { recursive: true })
const closedSite = await createServer(
  loadConfig(
    {
      port: port + 2,
      siteName: 'Closed',
      siteAccess: 'users',
      sqliteFile: join(closedRoot, 'site.sqlite'),
      schemaDir: join(closedRoot, 'schema'),
      componentsDir: join(closedRoot, 'components'),
      mediaDir: join(closedRoot, 'media'),
      adminLogin: BROWSER_ADMIN.login,
      adminPassword: BROWSER_ADMIN.password,
      development: true,
      immutableAssets: true,
    },
    closedRoot,
  ),
)
// A published home page, so a visitor signed in is brought back to a page the site shows.
{
  const admin = await signIn(closedSite, {
    username: BROWSER_ADMIN.login,
    password: BROWSER_ADMIN.password,
  })
  const types = await admin.json<{ items: Array<{ id: string; name: string }> }>(
    `${V1}/document-type/allowed-at-root?skip=0&take=10`,
  )
  const home = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const { defaultTemplate } = await admin.json<{ defaultTemplate: { id: string } | null }>(
    `${V1}/document-type/${home.id}`,
  )
  const created = await admin.post(`${V1}/document`, {
    documentType: { id: home.id },
    template: defaultTemplate,
    parent: null,
    values: [{ alias: 'title', culture: null, segment: null, value: CLOSED_SITE_HOME }],
    variants: [{ culture: null, segment: null, name: CLOSED_SITE_HOME }],
  })
  const key = created.headers.get('umb-generated-resource')
  const published = await admin.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })
  if (created.status !== 201 || published.status !== 200)
    throw new Error(`The closed site's home page was not published: ${await published.text()}`)
}
Bun.serve(closedSite.serveOptions)
console.log(`its closed site on http://127.0.0.1:${port + 2} (site ${closedRoot})`)

const stop = async () => {
  await closedSite.close()
  await contentSite.close()
  await server.close()
  rmSync(contentRoot, { recursive: true, force: true })
  rmSync(closedRoot, { recursive: true, force: true })
  rmSync(root, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

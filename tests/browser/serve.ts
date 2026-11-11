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
import { DEFAULT_DATA_TYPES } from '@crombolo/data'
import { createServer, loadConfig, VERSION } from '@crombolo/server'
import { BLOCK_ONLY_ELEMENT_TYPE, BROWSER_ADMIN } from './fixtures.ts'

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
writeFileSync(
  join(sidePanel, 'package.json'),
  JSON.stringify({
    name: 'test-side-panel',
    version: '1.0.0',
    peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
    crombolo: {
      bundleType: 'extension',
      id: 'test-side-panel',
      schemaVersion: 6,
      // Its screens may reach this origin, and only this one (story 313).
      permissions: {
        'backoffice.code': 'Shows its notes beside the page',
        'http.outbound': { reason: 'Reads its notes', origins: ['https://notes.crombolo.test'] },
      },
      extensions: [
        {
          type: 'sidePanel',
          alias: 'Test.SidePanel.Notes',
          name: 'Notes',
          element: 'src/backoffice/panel.js',
          meta: { label: 'Notes', icon: 'icon-notepad', defaultWidth: 360, toggle: true },
        },
      ],
    },
  }),
)
mkdirSync(join(sidePanel, 'src', 'backoffice'), { recursive: true })
writeFileSync(
  join(sidePanel, 'src', 'backoffice', 'panel.js'),
  `class TestNotesPanel extends HTMLElement {
  count = 0
  connectedCallback() {
    if (this.button) return
    this.button = document.createElement('button')
    this.button.id = 'count'
    this.button.textContent = 'Clicked 0'
    this.button.addEventListener('click', () => {
      this.count += 1
      this.button.textContent = 'Clicked ' + this.count
    })
    this.append(this.button)
  }
}
customElements.define('test-notes-panel', TestNotesPanel)
export default TestNotesPanel
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
      // Seals the site's own signing key, which Trusted signers lists (story 316).
      secretKey: 'browser-suite-secret-key-that-is-long-enough-0123',
      // The site's code grants what it asks for, its back-office code included, so it runs
      // (stories 310, 320).
      extensions: {
        'test-side-panel': {
          grant: ['backoffice.code', 'http.outbound'],
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
Bun.serve(server.serveOptions)
console.log(`browser suite server on http://localhost:${port} (site ${root})`)

const stop = async () => {
  await server.close()
  rmSync(root, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

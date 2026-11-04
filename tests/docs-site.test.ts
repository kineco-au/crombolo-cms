/**
 * The product site's docs section (story 157): the guides rendered from
 * Markdown, the reference generated from the command line and the settings
 * list, and the committed bundle that carries both with the page types and
 * views they need.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { SearchIndex } from '@crombolo/data'
import { installBundleContent, SETTINGS } from '@crombolo/server'
import { buildManifest } from '../packages/cli/src/manifest.ts'
import {
  configurationHtml,
  DOCS_DIR,
  DOCS_SEED_DIR,
  type DocsPage,
  docsKey,
  docsTree,
  GENERATED_HEADER,
  parseGuide,
  renderMarkdown,
  walkthroughOf,
  writeDocsSeed,
} from '../scripts/docs-site.ts'
import { ROOT } from '../scripts/packages.ts'
import type { WalkthroughStep } from '../sites/crombolo/components/shared/walkthrough.tsx'
import { type Harness, signedInServer } from './support/harness.ts'

const BUNDLE = join(ROOT, 'sites/crombolo/bundles/demo-crombolo')
const NODES = join(BUNDLE, 'nodes')
const CLI_REFERENCE_KEY = '3c1e9b52-7d40-4f18-9a6e-150c11ec0150'

interface StoredNode {
  values: Array<{ property: string; value: unknown }>
}

const stored = (key: string): StoredNode | undefined => {
  const file = join(NODES, `${key}.json`)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StoredNode) : undefined
}

const storedValue = (node: StoredNode | undefined, property: string) =>
  node?.values.find((v) => v.property === property)?.value

const everyPage = (pages: readonly DocsPage[]): DocsPage[] =>
  pages.flatMap((page) => [page, ...everyPage(page.children)])

describe('the guides', () => {
  test('Markdown headings get ids, unique on the page, for "On this page"', () => {
    const html = renderMarkdown('## Set it up\n\ntext\n\n## Set it up\n\n### The `crombolo` file\n')
    expect(html).toContain('<h2 id="set-it-up">Set it up</h2>')
    expect(html).toContain('<h2 id="set-it-up-2">Set it up</h2>')
    expect(html).toContain('<h3 id="the-crombolo-file">The <code>crombolo</code> file</h3>')
  })

  test('a guide must say what it is, and leave the page title to the page', () => {
    const ok = parseGuide('a.md', '---\ntitle: A\nsummary: About a.\norder: 2\n---\n\n## One\n')
    expect(ok).toMatchObject({ title: 'A', summary: 'About a.', order: 2, body: '## One' })
    expect(() => parseGuide('b.md', '## No front matter\n')).toThrow('no front matter')
    expect(() => parseGuide('c.md', '---\ntitle: C\norder: 1\n---\n')).toThrow('"summary"')
    expect(() => parseGuide('d.md', '---\ntitle: D\nsummary: d\norder: 1\n---\n# D\n')).toThrow(
      'start at ##',
    )
  })

  test('every guide in the repository is well formed', () => {
    const pages = everyPage(docsTree({ version: '0', commands: {} }))
    const written = pages.filter((page) => page.editUrl)
    expect(written.map((page) => page.path)).toContain('getting-started')
    expect(written.filter((page) => page.path.startsWith('guides/')).length).toBeGreaterThan(0)
    for (const page of written) {
      expect(page.body, page.path).toBeTruthy()
      // Written for a visitor, not for someone reading the repository.
      expect(page.body, page.path).not.toMatch(/packages\/[a-z-]+\/src|story \d{3}/i)
    }
    expect(existsSync(join(DOCS_DIR, 'getting-started.md'))).toBe(true)
  })
})

describe('the configuration reference', () => {
  test('lists every setting the server reads, once', () => {
    const html = configurationHtml()
    for (const setting of SETTINGS)
      expect(html.split(`<tr><td><code>${setting.env}</code></td>`), setting.env).toHaveLength(2)
  })
})

describe('the committed bundle', () => {
  test('holds every docs page as the build writes it today', async () => {
    const pages = everyPage(docsTree(await buildManifest()))
    for (const page of pages) {
      const node = stored(docsKey(page.path))
      expect(node, `${page.path}: run \`bun run build:template\``).toBeDefined()
      const body = (storedValue(node, 'body') as { markup?: string } | undefined)?.markup
      expect(
        body === page.body,
        `${page.path} changed: run \`bun run build:template\` to rewrite the docs`,
      ).toBe(true)
      const walkthrough = storedValue(node, 'walkthrough')
      expect(
        walkthrough === (page.walkthrough && JSON.stringify(page.walkthrough)),
        `${page.path}'s steps changed: run \`bun run build:template\` to rewrite the docs`,
      ).toBe(true)
    }
  })

  test('the old command line page sends visitors to the docs', () => {
    const target = docsKey('reference/command-line').replaceAll('-', '')
    expect(storedValue(stored(CLI_REFERENCE_KEY), 'umbracoRedirect')).toBe(
      `umb://document/${target}`,
    )
  })

  test('carries the site’s schema and views with its content', () => {
    for (const file of [
      'schema/content-types/docs-page.toml',
      'schema/content-types/docs-section.toml',
      'components/pages/docsPage.tsx',
      'components/shared/docs.tsx',
      'styles/site.css',
    ])
      expect(existsSync(join(BUNDLE, file)), file).toBe(true)
    // And as the site has them, so the bundle is never a stale copy.
    expect(readFileSync(join(BUNDLE, 'components/pages/docsPage.tsx'), 'utf8')).toBe(
      readFileSync(join(ROOT, 'sites/crombolo/components/pages/docsPage.tsx'), 'utf8'),
    )
  })
})

describe('the docs seed', () => {
  test('is the seed the build writes today, file for file', async () => {
    // The generated pages are committed seed files (story 164): a guide, a
    // command or a setting changed without a rebuild shows here.
    const fresh = mkdtempSync(join(ROOT, 'output', 'docs-seed-'))
    try {
      cpSync(DOCS_SEED_DIR, fresh, { recursive: true })
      writeDocsSeed(await buildManifest(), fresh)
      const files = (dir: string) =>
        (readdirSync(dir, { recursive: true }) as string[])
          .filter((file) => file.endsWith('.toml'))
          .sort()
      expect(files(DOCS_SEED_DIR)).toEqual(files(fresh))
      for (const file of files(fresh))
        expect(
          readFileSync(join(DOCS_SEED_DIR, file), 'utf8') ===
            readFileSync(join(fresh, file), 'utf8'),
          `${file} changed: run \`bun run build:template\``,
        ).toBe(true)
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })

  test('says it is generated, and what to edit instead', () => {
    const guide = readFileSync(join(DOCS_SEED_DIR, 'guides', 'remotes.toml'), 'utf8')
    expect(guide.split('\n')[0]).toBe(
      `${GENERATED_HEADER} from sites/crombolo/docs/guides/remotes.md: edit that, not this file.`,
    )
  })
})

describe('installed on a site that has none of it', () => {
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

  async function emptySite() {
    const root = mkdtempSync(join(ROOT, 'output', 'docs-site-'))
    dirs.push(root)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'platform-copy' }))
    for (const dir of ['schema', 'components', 'css', 'scripts'])
      mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    const h = await signedInServer({
      config: {
        siteDir: root,
        schemaDir: join(root, 'schema'),
        componentsDir: join(root, 'components'),
        stylesheetsDir: join(root, 'css'),
        scriptsDir: join(root, 'scripts'),
        // Views the install writes are picked up on the next request, not seconds later.
        componentsSnapshot: { gateTtlMs: 0, minSwapIntervalMs: 0 },
      },
    })
    open.push(h)
    return { h, root }
  }

  test('one install brings the types, the views and the pages, and they render', async () => {
    const { h, root } = await emptySite()
    const copy = join(root, 'bundle')
    cpSync(BUNDLE, copy, { recursive: true })
    const result = await installBundleContent(h.server.db, h.server.config, {
      bundle: copy,
      publish: true,
      backupTaken: true,
    })
    expect(result.problems).toEqual([])

    // A render answers from the views it has and checks for new ones behind it,
    // so the views the install wrote arrive a request or two later.
    let docs = await h.call('/docs/')
    for (let tries = 0; docs.status !== 200 && tries < 50; tries++) {
      await Bun.sleep(20)
      docs = await h.call('/docs/')
    }
    expect(docs.status).toBe(200)
    const front = await docs.text()
    expect(front).toContain('<nav class="docs-nav" aria-label="Docs">')
    expect(front).toContain('href="/docs/getting-started"')

    const content = await (await h.call('/docs/reference/command-line/content/')).text()
    expect(content).toContain('id="content-publish"')
    expect(content).toContain('aria-label="On this page"')
    expect(content).toContain('Generated from')

    const old = await h.call('/developers/command-line/', { redirect: 'manual' })
    expect(old.status).toBe(302)
    expect(old.headers.get('location')).toEndWith('/docs/reference/command-line')

    // Docs pages are found by the site's search, from a word in their body,
    // once the indexer has been round: a job does that every few seconds.
    await new SearchIndex(h.server.db).indexAll()
    const found = await (await h.call('/docs/search/?q=clispec')).text()
    expect(found).toContain('href="/docs/reference/command-line"')

    // A view that differs here — edited on the platform, or older than the
    // release — is refused without permission, and replaced with it.
    const view = join(root, 'components/pages/docsPage.tsx')
    writeFileSync(view, readFileSync(view, 'utf8').replace('Suggest a change', 'Propose a change'))
    const install = (replaceFiles: boolean) =>
      installBundleContent(h.server.db, h.server.config, {
        bundle: copy,
        publish: true,
        backupTaken: true,
        replaceFiles,
      })
    expect((await install(false)).problems.join('\n')).toContain('components/pages/docsPage.tsx')
    expect((await install(true)).problems).toEqual([])
    expect(readFileSync(view, 'utf8')).toContain('Suggest a change')
  })
})

describe('Getting started (story 256)', () => {
  test('a walkthrough, and a page for every template the command line offers', async () => {
    const { docsTree, templateInfos } = await import('../scripts/docs-site.ts')
    const { listSites } = await import('../scripts/sites.ts')
    const tree = docsTree(await buildManifest())
    const start = tree.find((page) => page.path === 'getting-started')
    expect(start?.children.map((c) => c.slug)).toEqual(['from-the-command-line', 'templates'])
    const templates = start?.children.find((c) => c.slug === 'templates')
    const offered = [
      'basic',
      'next',
      ...listSites()
        .filter((s) => s.distribute)
        .map((s) => s.id),
    ]
    expect(templateInfos().map((t) => t.id)).toEqual(offered)
    expect(templates?.children).toHaveLength(offered.length)
    for (const [i, id] of offered.entries()) {
      const page = templates?.children[i]
      expect(page?.body).toContain(`init --template ${id}`)
      // Every one of them has its own words, from its TEMPLATE.md
      expect(page?.body).toContain('id="what-is-in-it"')
    }
    expect(templates?.children.find((p) => p.slug === 'next')?.body).toContain('bun run dev')
  })
})

describe('a walkthrough', () => {
  const MARKDOWN = [
    'Why we are here.',
    '## Up and running',
    '### Make it',
    'One sentence.',
    '```sh\nbunx crombolo init\n```',
    "> You'll see `done`.",
    '> **Note the password.** It is shown once.',
    '### Change a view',
    'Write it.',
    '```tsx components/page.tsx\nexport default () => null\n```',
    '## Up and running',
    "### You're done",
    'Well done.',
  ].join('\n\n')

  test('is stages of steps, each with its words, code, what to expect and what to note', () => {
    const walk = walkthroughOf('w.md', MARKDOWN)
    expect(walk.intro).toBe('<p>Why we are here.</p>')
    expect(walk.stages.map((s) => s.id)).toEqual(['up-and-running', 'up-and-running-2'])
    const [make, view] = walk.stages[0]?.steps ?? []
    expect(make).toEqual({
      id: 'make-it',
      title: 'Make it',
      text: '<p>One sentence.</p>',
      code: [{ lang: 'sh', text: 'bunx crombolo init' }],
      see: '<p>You&#39;ll see <code>done</code>.</p>',
      note: '<p><strong>Note the password.</strong> It is shown once.</p>',
    })
    expect(view?.code).toEqual([
      { lang: 'tsx', file: 'components/page.tsx', text: 'export default () => null' },
    ])
    expect(walk.stages[1]?.steps[0]).toMatchObject({ title: "You're done", code: [] })
  })

  test('has the same ids as the page body, so a link to a stage finds it', () => {
    const body = renderMarkdown(MARKDOWN)
    for (const stage of walkthroughOf('w.md', MARKDOWN).stages) {
      expect(body).toContain(`<h2 id="${stage.id}">`)
      for (const step of stage.steps) expect(body).toContain(`<h3 id="${step.id}">`)
    }
  })

  test('may offer one choice, with steps shown for one option only', () => {
    const markdown = [
      '## Start',
      '### Start Postgres [Postgres]',
      'Start it.',
      '### Make it [SQLite]',
      'Make it.',
      '### Make it [Postgres]',
      'Make it on Postgres.',
      '### Run it',
      'Run it.',
    ].join('\n\n')
    const walk = walkthroughOf('w.md', markdown, 'Database: SQLite, Postgres')
    expect(walk.choice).toEqual({ name: 'Database', options: ['SQLite', 'Postgres'] })
    expect(walk.stages[0]?.steps.map((s) => [s.id, s.title, s.only])).toEqual([
      ['start-postgres-postgres', 'Start Postgres', 'Postgres'],
      ['make-it-sqlite', 'Make it', 'SQLite'],
      ['make-it-postgres', 'Make it', 'Postgres'],
      ['run-it', 'Run it', undefined],
    ])
    expect(() => walkthroughOf('w.md', markdown, 'Database: SQLite, MySQL')).toThrow(
      'is for "Postgres", which is not a choice',
    )
    expect(() => walkthroughOf('w.md', markdown)).toThrow('which is not a choice')
    expect(() => walkthroughOf('w.md', markdown, 'Database')).toThrow('"Name: one, another"')
  })

  test('refuses a step with nothing to say, and anything between a stage and its steps', () => {
    expect(() => walkthroughOf('w.md', '## A\n\n### B\n\n```sh\nx\n```')).toThrow(
      'the step "B" says nothing',
    )
    expect(() => walkthroughOf('w.md', '## A\n\nStray.\n\n### B\n\nb')).toThrow(
      'a stage holds only steps',
    )
    expect(() => walkthroughOf('w.md', '## A\n\n## B\n\n### C\n\nc')).toThrow(
      'the stage "A" has no steps',
    )
  })

  test('"A site from the command line" gets a site running first, and only then goes further', async () => {
    const tree = docsTree(await buildManifest())
    const page = everyPage(tree).find((p) => p.slug === 'from-the-command-line')
    const walk = page?.walkthrough
    expect(walk?.stages.map((s) => s.title)).toEqual([
      'Before you start',
      'Up and running',
      'Your own pages',
      'Advanced',
    ])
    const [before, first, ...later] = walk?.stages ?? []
    // Before anything is made: the system, Bun at 1.3 or later, and Docker only for Postgres
    expect(before?.steps.map((s) => [s.title, s.only])).toEqual([
      ['Check your system', undefined],
      ['Check Bun', undefined],
      ['Check Docker', 'Postgres'],
    ])
    expect(before?.steps[0]?.text).toMatch(/macOS[\s\S]*Linux[\s\S]*WSL 2/)
    expect(before?.steps[1]?.text).toContain('Bun 1.3 or later')
    const commands = (steps: WalkthroughStep[]) =>
      steps.flatMap((s) => s.code.map((c) => c.text)).join('\n')
    // Workflows and webhooks wait until the site is up
    expect(commands(first?.steps ?? [])).not.toMatch(/workflows|webhooks|forms/)
    expect(commands(later.flatMap((s) => s.steps))).toMatch(/workflows new[\s\S]*webhooks new/)
    for (const step of walk?.stages.flatMap((s) => s.steps) ?? []) {
      // One sentence to say what the step does, and what to expect when it has run
      expect(step.text.match(/[.!?](\s|<)/g)?.length ?? 0, step.title).toBeLessThanOrEqual(
        step.code.length > 0 ? 1 : 10,
      )
      if (step.code.length > 0) expect(step.see, step.title).toBeTruthy()
    }
    // SQLite unless the reader picks Postgres, which starts a database and says so to init
    expect(walk?.choice).toEqual({ name: 'Database', options: ['SQLite', 'Postgres'] })
    const steps = (option: string) =>
      (first?.steps ?? []).filter((s) => !s.only || s.only === option)
    const init = (option: string) =>
      commands(steps(option).filter((s) => s.title === 'Make the site'))
    expect(init('SQLite')).toMatch(/init --name "Riverside Bakery"$/)
    expect(init('SQLite')).not.toContain('--postgres')
    expect(init('Postgres')).toContain('init --name "Riverside Bakery" --postgres')
    expect(commands(steps('Postgres'))).toContain('docker run')
    expect(commands(steps('SQLite'))).not.toContain('docker run')
    // The password is noted where it is shown, and the first stage ends signed in
    const start = first?.steps.find((s) => s.code.some((c) => c.text === 'bun start'))
    expect(start?.note).toContain('Make a note of the username and password')
    const welcome = first?.steps.at(-1)
    expect(welcome?.code).toEqual([])
    expect(welcome?.text).toContain('Welcome to your new Crombolo site')
    expect(welcome?.text).toContain('href="http://localhost:8080/crombolo"')
    expect(welcome?.text).toContain('Signing in')
  })
})

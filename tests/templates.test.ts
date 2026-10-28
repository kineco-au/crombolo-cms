/**
 * The starter templates and what `crombolo init` writes.
 *
 * `tests/integration/new-site.integration.ts` boots a scaffolded site; this
 * holds the shipped templates to the rules a site is held to — valid schema, a
 * view for every template alias, a seed that builds into a bundle (story 164) —
 * so a template that would fail in somebody's terminal fails here first.
 *
 * The sites in `sites/` are checked as templates, staged exactly as packing the
 * CLI stages the distributed ones — every site, so the product site is held to
 * the same rules as the ones that ship.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  findTemplate,
  listTemplates,
  packageNameFor,
  type SiteTemplate,
  scaffoldFiles,
} from '@crombolo/cli'
import { allFormFields, type SchemaForm } from '@crombolo/core'
import { SYSTEM_CONTENT_TYPES } from '@crombolo/data'
import { allProperties, loadSchemaDirectory, validateSchemaSet } from '@crombolo/schema'
import { type BundleBuildResult, buildBundleFromDirectory, listComponents } from '@crombolo/server'
import type { BundleNode } from '@crombolo/transfer'
import { ROOT } from '../scripts/packages.ts'
import { listSites, stageTemplates } from '../scripts/sites.ts'

mkdirSync(join(ROOT, 'output'), { recursive: true })
const STAGED = mkdtempSync(join(ROOT, 'output', 'templates-'))
stageTemplates(STAGED, listSites())
afterAll(() => rmSync(STAGED, { recursive: true, force: true }))

const templates = [...listTemplates(), ...listTemplates(STAGED)]
const byId = (id: string): SiteTemplate => {
  const found = findTemplate(id) ?? findTemplate(id, STAGED)
  if (!found) throw new Error(`no template "${id}"`)
  return found
}

/** A template built as `crombolo bundle build --template` builds it, once per run. */
const built = new Map<string, Promise<BundleBuildResult>>()
const templateBundle = (template: SiteTemplate): Promise<BundleBuildResult> => {
  const cached = built.get(template.id)
  if (cached) return cached
  const build = buildBundleFromDirectory(join(template.dir, 'files'))
  built.set(template.id, build)
  return build
}

describe('the starter templates', () => {
  test('are only basic in the CLI itself; the rest are sites staged at pack time', () => {
    expect(listTemplates().map((t) => t.id)).toEqual(['basic'])
  })

  test('are listed with what they contain, and an unknown one is not invented', () => {
    expect(templates.map((t) => t.id)).toEqual([
      'basic',
      'demo/crombolo',
      'demo/harbourstone',
      'starter',
    ])
    for (const template of templates) {
      expect(template.name).not.toBe('')
      expect(template.description).not.toBe('')
    }
    // A family is a directory of templates, so more demos need no code.
    expect(byId('demo/harbourstone').id).toContain('/')
    expect(findTemplate('demo', STAGED)).toBeUndefined()
    expect(findTemplate('nope')).toBeUndefined()
  })

  test.each(templates.map((t) => [t.id] as const))('%s has schema a site would accept', (id) => {
    const template = byId(id)
    const loaded = loadSchemaDirectory(join(template.dir, 'files', 'schema'))
    // Every component at any depth, keyed by the path that is its alias —
    // which is what the schema names and what the server scans for.
    const views = new Set(
      listComponents(join(template.dir, 'files', 'components')).map((c) => c.alias),
    )
    const problems = [
      ...loaded.problems,
      ...validateSchemaSet(loaded.set, { componentAliases: views }),
    ]
    expect(problems.map((p) => `${p.file}: ${p.message}`)).toEqual([])

    // No keys in the files: sync derives them from the aliases, the same on
    // every site, and the seed names types by alias (story 161).
    for (const type of [...loaded.set.contentTypes, ...(loaded.set.mediaTypes ?? [])]) {
      expect(type.key, type.alias).toBeUndefined()
      for (const property of allProperties(type))
        expect(property.key, property.alias).toBeUndefined()
    }
    for (const dataType of loaded.set.dataTypes)
      expect(dataType.key, dataType.alias).toBeUndefined()
  })

  test.each(templates.map((t) => [t.id] as const))(
    '%s ships a seed that builds into a bundle',
    async (id) => {
      const template = byId(id)
      expect(template.seed).toBe(true)
      const result = await templateBundle(template)
      expect(result.problems).toEqual([])
      const set = result.seed?.set
      expect(set?.nodes.length ?? 0).toBeGreaterThan(0)
      if (!set) return
      // Every type the seed needs is one this template's own files define.
      const aliases = new Set(
        loadSchemaDirectory(join(template.dir, 'files', 'schema')).set.contentTypes.map(
          (t) => t.alias,
        ),
      )
      // The media types every site has, and the content types Crombolo ships (menus among them).
      const seeded = new Set([
        'Image',
        'File',
        'Folder',
        ...SYSTEM_CONTENT_TYPES.map((t) => t.alias),
      ])
      for (const type of set.manifest.dependencies.schema.contentTypes)
        expect(aliases.has(type.alias) || seeded.has(type.alias), type.alias).toBe(true)
      // And nothing it expects to find at the destination, which a new site has not got.
      expect(set.manifest.dependencies.expected).toEqual([])
    },
    60_000,
  )

  test('the demo carries the bytes for every media file its seed names', async () => {
    const result = await templateBundle(byId('demo/harbourstone'))
    const blobs = result.seed?.set?.manifest.blobs ?? []
    expect(blobs.length).toBeGreaterThan(0)
    for (const blob of blobs) {
      // Carried, so a new site gets its images wherever its media lives — a
      // disk, a bucket, a container — rather than only on a local disk.
      expect(blob.included, blob.key).toBe(true)
      expect(result.seed?.blobs.get(blob.key)?.length, blob.key).toBe(blob.size as number)
    }
  }, 60_000)
})

describe('the demo’s form', () => {
  const template = byId('demo/harbourstone')
  const forms = loadSchemaDirectory(join(template.dir, 'files', 'schema')).set.forms ?? []

  test('is a file in the schema directory, like the types beside it', () => {
    expect(forms.map((form) => form.alias)).toEqual(['contactEnquiry'])
    expect(forms[0]?.key).toBeTruthy()
  })

  test('is pointed at by the page that renders it', async () => {
    // A `formPicker` stores a UUID, so a key that matches no file renders
    // nothing at all — silently, and only on the page nobody checked.
    const set = (await templateBundle(template)).seed?.set
    const picked = (set?.nodes ?? []).flatMap((node) =>
      (node.values ?? [])
        .filter((value) => value.editor === 'Crombolo.FormPicker')
        .map((value) => String(value.value)),
    )
    expect(picked).not.toBeEmpty()
    for (const key of picked) expect(forms.map((form) => form.key)).toContain(key)
  })

  test('is reachable from a property the content type declares', () => {
    const types = loadSchemaDirectory(join(template.dir, 'files', 'schema')).set.contentTypes
    const property = types
      .flatMap((type) => allProperties(type))
      .find((candidate) => candidate.alias === 'enquiryForm')
    expect(property?.type).toBe('formPicker')
  })

  test('is rendered by the view, with the submission passed through', () => {
    // Without `submission` a refused submission comes back on a bare page
    // instead of inside the site's own layout, which is the whole point of the
    // prop being on PageProps.
    const view = readFileSync(
      join(template.dir, 'files', 'components', 'pages', 'contactPage.tsx'),
      'utf8',
    )
    expect(view).toContain('<Form')
    expect(view).toContain('submission={submission}')
  })

  test('collects something, and asks before storing it', () => {
    const form = forms[0]
    expect(form?.storeEntries).toBe(true)
    const fields = allFormFields(form as SchemaForm)
    expect(fields.some((field) => field.type === 'dataConsent' && field.mandatory)).toBe(true)
    // The spam guards, which cost a visitor nothing and need no third party.
    expect(form?.honeypot).toBe(true)
    expect(form?.minimumSubmitSeconds).toBeGreaterThan(0)
  })
})

describe('a template that wires a server bundle', () => {
  test('adds the dependency and the import that turns it on', () => {
    const files = scaffoldFiles({ template: byId('demo/harbourstone'), siteName: 'Harbourstone' })
    const manifest = JSON.parse(
      files.find((file) => file.path === 'package.json')?.text as string,
    ) as { dependencies?: Record<string, string>; peerDependencies: Record<string, string> }
    // A peer, as every @crombolo package is: a host that runs the site provides it.
    expect(Object.keys(manifest.peerDependencies)).toContain('@crombolo/simple-redirects')
    expect(manifest.dependencies).toBeUndefined()

    const config = files.find((file) => file.path === 'crombolo.config.ts')?.text as string
    expect(config).toContain("import { redirects } from '@crombolo/simple-redirects'")
    expect(config).toContain('bundles: [redirects()]')
    // The site is still named what was asked for, which a template shipping its
    // own config file would have thrown away.
    expect(config).toContain("siteName: 'Harbourstone'")
  })

  test('leaves the config alone for a template that wires none', () => {
    const config = scaffoldFiles({ template: byId('basic') }).find(
      (file) => file.path === 'crombolo.config.ts',
    )?.text as string
    expect(config).not.toContain('bundles:')
    expect(config).toContain("import { defineConfig } from '@crombolo/crombolo'")
  })

  test('ignores a malformed entry rather than scaffolding a broken import', () => {
    expect(byId('basic').serverBundles).toEqual([])
    expect(byId('demo/harbourstone').serverBundles).toEqual([
      { package: '@crombolo/simple-redirects', import: 'redirects' },
    ])
  })
})

describe('what init writes', () => {
  test('is a package, a config, a server and a schema directory', () => {
    const paths = scaffoldFiles().map((f) => f.path)
    expect(paths).toContain('package.json')
    expect(paths).toContain('crombolo.config.ts')
    expect(paths).toContain('server.ts')
    expect(paths).toContain('tsconfig.json')
    expect(paths).toContain('schema/schema.toml')
    expect(paths).toContain('.gitignore')
    expect(paths).not.toContain('.env')
  })

  test('names the site, and the package after it', () => {
    const files = scaffoldFiles({ siteName: 'Harbourstone Distillery' })
    const manifest = JSON.parse(
      files.find((f) => f.path === 'package.json')?.text ?? '{}',
    ) as Record<string, unknown>
    expect(manifest.name).toBe('harbourstone-distillery')
    expect(files.find((f) => f.path === 'crombolo.config.ts')?.text).toContain(
      "siteName: 'Harbourstone Distillery'",
    )
    // A name npm will take, whatever was typed.
    expect(packageNameFor('  Ardbeg & Co. ')).toBe('ardbeg-co')
    expect(packageNameFor('***')).toBe('my-site')
    // An apostrophe joins its word rather than splitting it, straight or curly.
    expect(packageNameFor("Nature's Calendar")).toBe('natures-calendar')
    expect(packageNameFor('Mac\u2019s')).toBe('macs')
    // A quote in the name must not end the string it is written into.
    expect(
      scaffoldFiles({ siteName: "Mac's" }).find((f) => f.path === 'crombolo.config.ts')?.text,
    ).toContain("siteName: 'Mac\\'s'")
  })

  test('installs every type library its tsconfig names, so a new site type-checks', () => {
    const files = scaffoldFiles()
    const tsconfig = JSON.parse(files.find((f) => f.path === 'tsconfig.json')?.text ?? '{}') as {
      compilerOptions: { types: string[] }
    }
    const manifest = JSON.parse(files.find((f) => f.path === 'package.json')?.text ?? '{}') as {
      devDependencies: Record<string, string>
    }
    expect(manifest.devDependencies).toHaveProperty('typescript')
    for (const types of tsconfig.compilerOptions.types)
      expect(manifest.devDependencies).toHaveProperty([`@types/${types}`])
  })

  test('a server that boots with the site’s own config, as every site here does', () => {
    const server = scaffoldFiles().find((f) => f.path === 'server.ts')?.text ?? ''
    expect(server).toContain("import config from './crombolo.config.ts'")
    expect(server).toContain('crombolo(config)')
    for (const site of listSites())
      expect(readFileSync(join(site.dir, 'server.ts'), 'utf8')).toBe(server)
  })

  test('adds the Postgres environment only when asked, and gitignores it', () => {
    const files = scaffoldFiles({ siteName: 'Site', postgres: true })
    const env = files.find((f) => f.path === '.env')?.text ?? ''
    expect(env).toContain('CROMBOLO_DB=postgres')
    expect(env).toContain('CROMBOLO_POSTGRES_URL=')
    expect(env).toContain('CROMBOLO_PG_DUMP')
    expect(files.find((f) => f.path === '.gitignore')?.text).toContain('.env')
  })

  test('puts a template’s files where a site keeps them, and wires the import into `start`', () => {
    const template = byId('demo/harbourstone')
    const files = scaffoldFiles({ siteName: 'Harbourstone', template })
    const paths = files.map((f) => f.path)

    expect(paths).toContain('components/pages/homePage.tsx')
    expect(paths).toContain('schema/content-types/home-page.toml')
    expect(paths).toContain('css/site.css')
    // The content arrives as the seed, files the new site edits (story 164).
    expect(paths).toContain('seed/content/harbourstone.toml')
    expect(paths.some((p) => p.startsWith('seed/library/'))).toBe(true)
    // The images are seed media, not a bundle and not the site's own media/.
    expect(paths.some((p) => p.startsWith('seed/media/') && p.endsWith('.jpg'))).toBe(true)
    expect(paths.some((p) => p.startsWith('bundles/'))).toBe(false)
    expect(paths.some((p) => p.startsWith('media/'))).toBe(false)
    // Everything from the template is copied, not rewritten.
    for (const file of files.filter((f) => f.path.startsWith('seed/')))
      expect(file.copyFrom).toBeTruthy()

    const manifest = JSON.parse(files.find((f) => f.path === 'package.json')?.text ?? '{}') as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts.start).toBe('crombolo start --seed --publish')
  })

  test('lets a template win over the file it would otherwise scaffold', () => {
    const files = scaffoldFiles({ template: byId('basic') })
    const schemaFiles = files.filter((f) => f.path === 'schema/schema.toml')
    // One entry, and it is the template's — `init` skips a file that is already
    // on disk, so planning both would have let the scaffolded one win.
    expect(schemaFiles).toHaveLength(1)
    expect(schemaFiles[0]?.copyFrom).toBeTruthy()
  })
})

describe('the demo’s element types, reused across page types', () => {
  const template = byId('demo/harbourstone')
  const set = loadSchemaDirectory(join(template.dir, 'files', 'schema')).set

  test('one highlight type answers for the figures and the decisions alike', () => {
    // The home page's figures and the About page's four decisions are the same
    // shape, so they are blocks of the same element type in two places (story
    // 184). If this ever becomes two types, it is a decision somebody should have
    // to make deliberately rather than by adding a file.
    const highlight = set.contentTypes.find((type) => type.alias === 'highlight')
    expect(highlight?.isElement).toBe(true)

    const blocks = (set.dataTypes ?? []).find((type) => type.alias === 'highlightBlocks')
    expect(blocks?.editor).toBe('Umbraco.BlockList')
    expect(blocks?.blocks?.map((block) => block.element)).toEqual(['highlight'])

    const pickedBy = set.contentTypes
      .filter((type) => allProperties(type).some((property) => property.type === 'highlightBlocks'))
      .map((type) => type.alias)
      .sort()
    expect(pickedBy).toEqual(['contentPage', 'homePage'])
  })

  test('every picker names a type that is in this template', () => {
    // A picker narrowed to a type that no longer exists offers nothing at all,
    // silently, and only in the dialog nobody opened.
    const aliases = new Set(set.contentTypes.map((type) => type.alias))
    for (const dataType of set.dataTypes ?? []) {
      const allowed = dataType.config?.allowedContentTypes
      if (!Array.isArray(allowed)) continue
      for (const alias of allowed)
        expect([dataType.alias, aliases.has(alias)]).toEqual([dataType.alias, true])
    }
  })
})

describe('the demo’s photographs', () => {
  test('travel in its bundle byte for byte, as the seed holds them', async () => {
    // The bytes are passed through rather than re-encoded: re-encoding an
    // already-compressed JPEG would lose a little more of the image each build.
    const template = byId('demo/harbourstone')
    const media = join(template.dir, 'files', 'seed', 'media')
    const shipped = readdirSync(media).filter((file) => file.endsWith('.jpg'))
    expect(shipped.length).toBeGreaterThan(0)
    const blobs = (await templateBundle(template)).seed?.blobs ?? new Map()
    for (const file of shipped) {
      const blob = [...blobs].find(([key]) => basename(key) === file)
      expect([file, Boolean(blob)]).toEqual([file, true])
      expect(Buffer.from(blob?.[1] as Uint8Array)).toEqual(readFileSync(join(media, file)))
    }
  }, 60_000)
})

describe('the demo’s typography', () => {
  const template = byId('demo/harbourstone')
  const css = readFileSync(join(template.dir, 'files', 'css', 'site.css'), 'utf8')
  const layout = readFileSync(
    join(template.dir, 'files', 'components', 'shared', 'layout.tsx'),
    'utf8',
  )

  test('links every family the stylesheet asks for first', () => {
    // The two are a pair: a family renamed in the stylesheet and not in the
    // link falls back silently, and looks merely a bit wrong rather than
    // broken. Reading the first-named family out of each custom property is
    // enough to catch that.
    const families = [...css.matchAll(/--(?:display|sans):\s*"([^"]+)"/g)].map((m) => m[1] ?? '')
    expect(families.length).toBe(2)
    for (const family of families) expect([family, layout.includes(family)]).toEqual([family, true])
  })

  test('names a fallback for each, so a blocked request still reads', () => {
    // The fonts come off a third party. A site behind a filter that cannot
    // reach it should land on a system serif and sans, not on a default.
    for (const property of ['--display', '--sans']) {
      const declaration = new RegExp(`${property}:([^;]+);`).exec(css)?.[1] ?? ''
      expect([property, declaration.split(',').length > 2]).toEqual([property, true])
      expect([property, /serif/.test(declaration)]).toEqual([property, true])
    }
  })
})

describe('the Crombolo product site', () => {
  const template = byId('demo/crombolo')
  const components = join(template.dir, 'files', 'components')
  let nodes: BundleNode[] = []
  beforeAll(async () => {
    nodes = (await templateBundle(template)).seed?.set?.nodes ?? []
  }, 60_000)
  // Across every node of the type: the developer guide and the command line
  // reference are both developer pages.
  const storedValue = (type: string, alias: string) =>
    nodes
      .filter((node) => node.contentType.alias === type)
      .flatMap((node) => node.values)
      .find((value) => value.property === alias)?.value

  test('points its GitHub links at the project’s repository', () => {
    const repository = 'https://github.com/kineco-au/crombolo-cms'
    expect(storedValue('homePage', 'repositoryUrl')).toBe(repository)
    // The fallback for a home page that leaves the setting empty.
    expect(readFileSync(join(components, 'shared', 'site.tsx'), 'utf8')).toContain(
      `'${repository}'`,
    )
  })

  test('ships a TSX sample that is complete, and renders it as text', () => {
    const sample = String(storedValue('developerPage', 'codeSample'))
    expect(sample).toContain("import type { PageProps } from '@crombolo/crombolo'")
    expect(sample).toContain("import { Layout } from '../shared/layout.tsx'")
    // Every tag it opens, it closes.
    expect(sample.match(/<Layout\b/g)?.length).toBe(sample.match(/<\/Layout>/g)?.length)
    const view = readFileSync(join(components, 'pages', 'developerPage.tsx'), 'utf8')
    expect(view).toContain("<code>{model.text('codeSample')}</code>")
  })

  test('keeps the developer detail off the home page', () => {
    const types = loadSchemaDirectory(join(template.dir, 'files', 'schema')).set.contentTypes
    const home = types.find((type) => type.alias === 'homePage')
    const developer = types.find((type) => type.alias === 'developerPage')
    expect(home?.allowChildren).toEqual(['developerPage', 'docsSection'])
    const homeAliases = home ? allProperties(home).map((p) => p.alias) : []
    for (const alias of ['codeSample', 'steps', 'toolkit'])
      expect([alias, homeAliases.includes(alias)]).toEqual([alias, false])
    const developerAliases = developer ? allProperties(developer).map((p) => p.alias) : []
    expect(developerAliases).toContain('steps')
  })
})

describe('the starter', () => {
  const template = byId('starter')
  const components = join(template.dir, 'files', 'components')
  const read = (path: string) => readFileSync(join(components, path), 'utf8')
  let nodes: BundleNode[] = []
  beforeAll(async () => {
    nodes = (await templateBundle(template)).seed?.set?.nodes ?? []
  }, 60_000)

  test('is a header, a footer and a layout every page shares', () => {
    const layout = read('shared/layout.tsx')
    expect(layout).toContain('<SiteHeader')
    expect(layout).toContain('<SiteFooter')
    expect(layout).toContain('<SeoHead')
    // Named by the site's config, so `init --name` is what the header says.
    expect(layout).toContain('seo.siteName')
  })

  test('builds its nav from the pages, so a new page needs no code', () => {
    expect(read('shared/site-header.tsx')).toContain('nav.children(home')
  })

  test('has two columns only when there is something for the second', () => {
    const page = read('pages/contentPage.tsx')
    expect(page).toContain("model.hasValue('sidebarText')")
    expect(page).toContain('<aside>')
  })

  test('ships placeholder pages that show both layouts, and a search page', () => {
    const documents = nodes.filter((node) => node.kind === 'document')
    expect(documents.map((node) => node.variants[0]?.name).sort()).toEqual([
      'About',
      'Contact',
      'Home',
      'Search',
    ])
    const pages = documents.filter((node) => node.variants[0]?.name !== 'Search')
    const withSidebar = pages.filter((node) =>
      node.values.some((value) => value.property === 'sidebarText'),
    )
    expect(withSidebar.length).toBeGreaterThan(0)
    expect(withSidebar.length).toBeLessThan(pages.length)
  })
})

/**
 * The sites in `sites/`: each a private workspace run in place, shipped with the
 * CLI only when it opts in, and staged for that in the layout `init` reads.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { findTemplate, listTemplates, scaffoldFiles } from '@crombolo/cli'
import { siteMediaTypeFiles } from '@crombolo/schema'
import { buildBundleFromDirectory, listComponents } from '@crombolo/server'
import { ROOT } from '../scripts/packages.ts'
import {
  findSite,
  listSites,
  runState,
  SITES_DIR,
  SPA_SCRIPTS,
  stageTemplates,
  unstage,
} from '../scripts/sites.ts'

mkdirSync(join(ROOT, 'output'), { recursive: true })
const scratch: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(ROOT, 'output', 'sites-'))
  scratch.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

describe('the sites', () => {
  const sites = listSites()

  test('are found by their site.json, by id or by directory', () => {
    expect(sites.map((site) => site.id)).toEqual([
      'demo/crombolo',
      'demo/harbourstone',
      'demo/harbourstone-next',
      'demo/harbourstone-spa',
      'demo/plain-signal',
      'product/crombolo',
      'starter',
    ])
    expect(findSite('demo/harbourstone')?.dir).toBe(join(SITES_DIR, 'harbourstone'))
    expect(findSite('harbourstone')?.id).toBe('demo/harbourstone')
    expect(findSite('nope')).toBeUndefined()
  })

  test('are workspaces, so running one runs the working tree', () => {
    const root = json(join(ROOT, 'package.json')) as { workspaces: string[] }
    expect(root.workspaces).toContain('sites/*')
  })

  test.each(sites.map((site) => [site.id, site] as const))(
    '%s is a private package that depends on the workspace, and starts from its content files',
    (_, site) => {
      const manifest = json(join(site.dir, 'package.json')) as {
        private?: boolean
        scripts: Record<string, string>
        dependencies: Record<string, string>
      }
      expect(manifest.private).toBe(true)
      for (const [name, range] of Object.entries(manifest.dependencies))
        if (name.startsWith('@crombolo/')) expect(range).toBe('workspace:*')
      // Its content is its files (stories 164, 167), applied once for each change to them.
      expect(manifest.scripts.start).toBe('crombolo start --bundle . --publish')
      expect(existsSync(join(site.dir, 'content', 'pages'))).toBe(true)
    },
  )

  test.each(sites.map((site) => [site.id, site] as const))(
    '%s runs the server bundles its scaffold would wire',
    (_, site) => {
      // The site's own files and the ones `init` would write from its site.json
      // are two copies of one decision; this keeps them the same decision.
      const manifest = json(join(site.dir, 'package.json')) as {
        dependencies: Record<string, string>
      }
      const config = readFileSync(join(site.dir, 'crombolo.config.ts'), 'utf8')
      // Granted by the site's code under `extensions`, with nothing imported (story 310).
      for (const bundle of site.bundles as { package: string; id: string }[]) {
        expect(Object.keys(manifest.dependencies)).toContain(bundle.package)
        expect(config).toContain(`${bundle.id}: { grant: [`)
        expect(config).not.toContain(`from '${bundle.package}'`)
      }
    },
  )

  test('ship only when they opt in', () => {
    expect(sites.filter((site) => site.distribute).map((site) => site.id)).toEqual([
      'demo/crombolo',
      'demo/harbourstone',
      'demo/harbourstone-next',
      'demo/harbourstone-spa',
      'demo/plain-signal',
      'starter',
    ])
  })
})

describe('staging a site as a template', () => {
  test('stages the distributed sites by default, and nothing else', () => {
    const into = tempDir()
    stageTemplates(into)
    expect(listTemplates(into).map((template) => template.id)).toEqual([
      'demo/crombolo',
      'demo/harbourstone',
      'demo/harbourstone-next',
      'demo/harbourstone-spa',
      'demo/plain-signal',
      'starter',
    ])
  }, 20_000)

  test('writes the layout init reads, and leaves the site’s own files behind', () => {
    const into = tempDir()
    const site = findSite('demo/harbourstone')
    if (!site) throw new Error('no harbourstone')
    stageTemplates(into, [site])
    const template = findTemplate('demo/harbourstone', into)
    expect(template?.serverBundles).toEqual([
      {
        package: '@crombolo/simple-redirects',
        id: 'redirects',
        grant: ['redirects.read', 'redirects.write', 'content.read'],
      },
    ])
    const dir = join(into, 'demo', 'harbourstone')
    // The content is its files, content/ among them; there is no bundle (stories 164, 167).
    expect(readdirSync(dir).sort()).toEqual(['CREDITS.md', 'files', 'template.json'])
    expect(readdirSync(join(dir, 'files')).sort()).toEqual([
      'actions',
      'components',
      'content',
      'css',
      'schema',
    ])
  })

  test('a site with a Next.js front end ships its web/, less what is installed, built or secret', () => {
    const into = tempDir()
    const site = findSite('demo/harbourstone-next')
    if (!site) throw new Error('no harbourstone-next')
    stageTemplates(into, [site])
    const template = findTemplate('demo/harbourstone-next', into)
    expect(template?.next).toBe(true)
    const web = join(into, 'demo', 'harbourstone-next', 'files', 'web')
    expect(existsSync(join(web, 'components', 'compare.tsx'))).toBe(true)
    expect(existsSync(join(web, 'app', '[[...slug]]', 'page.tsx'))).toBe(true)
    for (const left of ['node_modules', '.next', '.env.local', 'package.json'])
      expect([left, existsSync(join(web, left))]).toEqual([left, false])
  })

  test('a single-page app ships its web/ and the scripts beside it, less what is installed or built', () => {
    const into = tempDir()
    const site = findSite('demo/harbourstone-spa')
    if (!site) throw new Error('no harbourstone-spa')
    expect(site.spa).toBe(true)
    expect(site.next).toBe(false)
    stageTemplates(into, [site])
    const template = findTemplate('demo/harbourstone-spa', into)
    expect(template?.spa).toBe(true)
    expect(template?.next).toBe(false)
    const files = join(into, 'demo', 'harbourstone-spa', 'files')
    expect(existsSync(join(files, 'web', 'components', 'app.tsx'))).toBe(true)
    expect(existsSync(join(files, 'web', 'lib', 'cms-types.gen.ts'))).toBe(true)
    for (const script of SPA_SCRIPTS)
      expect([script, existsSync(join(files, script))]).toEqual([script, true])
    for (const left of ['node_modules', '.next', 'out', '.env.local', 'package.json'])
      expect([left, existsSync(join(files, 'web', left))]).toEqual([left, false])
  })

  test('leaves out the media types init writes for itself', () => {
    const into = tempDir()
    const site = findSite('demo/harbourstone')
    if (!site) throw new Error('no harbourstone')
    for (const path of Object.keys(siteMediaTypeFiles()))
      expect([path, existsSync(join(site.dir, path))]).toEqual([path, true])
    stageTemplates(into, [site])
    expect(existsSync(join(into, 'demo', 'harbourstone', 'files', 'schema', 'media-types'))).toBe(
      false,
    )
    // So a scaffold from it still has them, from the CLI rather than the template.
    const paths = scaffoldFiles({ template: findTemplate('demo/harbourstone', into) }).map(
      (file) => file.path,
    )
    for (const path of Object.keys(siteMediaTypeFiles())) expect(paths).toContain(path)
  })

  test('refuses to overwrite a template that is already there', () => {
    const into = tempDir()
    mkdirSync(join(into, 'demo', 'harbourstone'), { recursive: true })
    expect(() => stageTemplates(into)).toThrow(/already exists/)
  })

  test('is taken away again, family directory and all, leaving the rest', () => {
    const into = tempDir()
    mkdirSync(join(into, 'basic'))
    const staged = stageTemplates(into, listSites())
    expect(staged).toHaveLength(7)
    unstage(staged, into)
    expect(readdirSync(into)).toEqual(['basic'])
  }, 20_000)
})

describe('the single-page Harbourstone (story 347)', () => {
  const site = findSite('demo/harbourstone-spa')
  const dir = site?.dir as string
  const page = (path: string) =>
    Bun.TOML.parse(readFileSync(join(dir, 'content', 'pages', path), 'utf8')) as {
      type: string
      key: string
    }

  test('makes members-only the page its content calls Members, signed in on its Login page', () => {
    const script = readFileSync(join(dir, 'members.ts'), 'utf8')
    const members = page('harbourstone/members.toml')
    const login = page('harbourstone/login.toml')
    expect(login.type).toBe('loginPage')
    expect(script).toContain(`MEMBERS_PAGE = '${members.key}'`)
    expect(script).toContain(`LOGIN_PAGE = '${login.key}'`)
    // The page the CMS sends a member to sign in on, by its address.
    expect(readFileSync(join(dir, 'crombolo.config.ts'), 'utf8')).toContain("loginPage: '/login'")
  })

  test('draws only the login page itself: every other page is sent to the app', () => {
    expect(
      listComponents(join(dir, 'components'))
        .map((c) => c.alias)
        .sort(),
    ).toEqual(['pages/appPage', 'pages/loginPage'])
  })

  test('keeps no key in the app, and reads with the delivery client alone', () => {
    const manifest = json(join(dir, 'web', 'package.json')) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@crombolo/delivery-client',
      'next',
      'react',
      'react-dom',
    ])
    const sources = readdirSync(join(dir, 'web'), { recursive: true, encoding: 'utf8' }).filter(
      (file) => /\.tsx?$/.test(file) && !/^(node_modules|\.next|out)\//.test(file),
    )
    for (const file of sources) {
      const text = readFileSync(join(dir, 'web', file), 'utf8')
      expect([file, /apiKey|CROMBOLO_DELIVERY_API_KEY/.test(text)]).toEqual([file, false])
    }
  })
})

describe('a site built into a bundle', () => {
  test('carries the plain modules its views import', async () => {
    const site = findSite('demo/crombolo')
    const built = await buildBundleFromDirectory(site?.dir as string, { media: false })
    expect(built.problems).toEqual([])
    const paths = built.files?.map((file) => file.path) ?? []
    expect(paths).toContain('components/shared/categories.ts')
    expect(paths).toContain('components/shared/dates.ts')
  }, 60_000)
})

describe('what a site writes as it runs', () => {
  test('is the database, its backups, media, logs and the view cache', () => {
    const dir = tempDir()
    const names = [
      'crombolo.sqlite',
      'crombolo.sqlite-wal',
      'crombolo.sqlite.2026-10-14T00-45-07-199Z.content-import.bak',
      'media',
      'logs',
      '.crombolo',
    ]
    const committed = ['site.json', 'package.json', 'components', 'schema', 'bundles']
    for (const name of [...names, ...committed]) mkdirSync(join(dir, name))
    expect(
      runState(dir)
        .map((path) => path.slice(dir.length + 1))
        .sort(),
    ).toEqual([...names].sort())
  })

  test('is all gitignored, along with the templates staged from it', () => {
    // Read from the file rather than asked of git, which the test image has not got.
    const rules = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n')
    for (const rule of [
      '*.sqlite',
      '*.sqlite-*',
      '*.content-import.bak',
      'sites/*/media/',
      'logs/',
      '.crombolo/',
      'packages/cli/templates/*',
      '!packages/cli/templates/basic/',
    ])
      expect([rule, rules.includes(rule)]).toEqual([rule, true])
  })
})

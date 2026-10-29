/**
 * Starter templates: what `crombolo init` writes, and the catalogue
 * `--template list` prints.
 *
 * A template is a directory under `templates/`, one or two levels deep so a
 * family can share a prefix (`demo/harbourstone`):
 *
 *   template.json   name and description, for the catalogue
 *   files/          copied verbatim into the new site, its content as
 *                   `seed/` among them (story 164)
 *
 * A template's content is its seed: files the new site reads, edits and keeps,
 * which the scaffolded `start` script applies with `--seed` — on the first
 * boot, and again after each change to them, through the one import path.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { siteMediaTypeFiles } from '@crombolo/schema'
import { setting, VERSION } from '@crombolo/server'

/**
 * `templates/`, beside `src/` and `bin/` in the published package.
 * `CROMBOLO_TEMPLATES_DIR` stands in for it, so a test can stage the sites
 * without writing into the package that other runs read.
 */
export const TEMPLATES_DIR =
  setting('CROMBOLO_TEMPLATES_DIR') || join(import.meta.dir, '..', 'templates')

/** The Next.js app a site with a front end gets as `web/` (story 208), beside `templates/`. */
export const NEXT_APP_DIR = join(import.meta.dir, '..', 'next-app')

/**
 * A bundle whose server half a template wires into the site it scaffolds: the
 * dependency, plus the import and the `bundles` entry in `crombolo.config.ts`.
 *
 * Written into the site's own files rather than hidden anywhere, because that
 * import is the whole of what lets a bundle answer a request — so it has to be
 * a line the developer owns from the first commit and can delete
 * (`docs/bundles.md`).
 */
export interface TemplateServerBundle {
  /** The npm package, added to the site's dependencies. */
  package: string
  /** The factory it exports, imported by name and called in `bundles`. */
  import: string
  /**
   * The range to depend on. Defaults to this release, which is right for a
   * bundle that ships with the CMS; a third-party one names its own.
   */
  version?: string
}

export interface SiteTemplate {
  /** `basic`, or `demo/harbourstone` for one of a family. */
  id: string
  name: string
  description: string
  dir: string
  /** The template ships content, as `files/seed/`. */
  seed: boolean
  /** Server bundles the scaffolded site runs; empty for most templates. */
  serverBundles: TemplateServerBundle[]
  /** The site has a Next.js front end in `web/` (story 208). */
  next: boolean
  /** Packages the site depends on, such as React for its islands (story 209). */
  dependencies: Record<string, string>
}

const MANIFEST = 'template.json'

function read(dir: string, id: string): SiteTemplate | undefined {
  const manifest = join(dir, MANIFEST)
  if (!existsSync(manifest)) return undefined
  const raw = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : '',
    dir,
    seed: existsSync(join(dir, 'files', 'seed')),
    serverBundles: readServerBundles(raw.bundles),
    next: raw.next === true,
    dependencies: readDependencies(raw.dependencies),
  }
}

/** `dependencies` in `template.json`: package names to ranges, anything else dropped. */
function readDependencies(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([name, range]) => /^(@[a-z0-9-]+\/)?[a-z0-9._-]+$/.test(name) && typeof range === 'string',
    ),
  ) as Record<string, string>
}

/** `bundles` in `template.json`; anything malformed is dropped rather than guessed at. */
function readServerBundles(raw: unknown): TemplateServerBundle[] {
  if (!Array.isArray(raw)) return []
  const out: TemplateServerBundle[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const name = typeof record.package === 'string' ? record.package : ''
    const imported = typeof record.import === 'string' ? record.import : ''
    if (!name || !imported) continue
    out.push({
      package: name,
      import: imported,
      ...(typeof record.version === 'string' ? { version: record.version } : {}),
    })
  }
  return out
}

/** Every template, in id order; a directory without a manifest is a family. */
export function listTemplates(root = TEMPLATES_DIR): SiteTemplate[] {
  if (!existsSync(root)) return []
  const out: SiteTemplate[] = []
  for (const entry of readdirSync(root).sort()) {
    const dir = join(root, entry)
    if (!statSync(dir).isDirectory()) continue
    const own = read(dir, entry)
    if (own) {
      out.push(own)
      continue
    }
    for (const child of readdirSync(dir).sort()) {
      const nested = read(join(dir, child), `${entry}/${child}`)
      if (nested) out.push(nested)
    }
  }
  return out
}

export function findTemplate(id: string, root = TEMPLATES_DIR): SiteTemplate | undefined {
  return listTemplates(root).find((t) => t.id === id)
}

export interface ScaffoldOptions {
  /** `--name`; also the package name, slugified. */
  siteName?: string
  /** `--postgres`: write a `.env` naming the Postgres variables instead of using the SQLite default. */
  postgres?: boolean
  template?: SiteTemplate
  /**
   * A bundle the site already has, for the `start` script to apply: the path,
   * relative to the site, and any `content import` flags it needs beyond
   * `--publish`. A template's own seed is used when this is absent.
   */
  bundle?: { path: string; flags?: readonly string[] }
  /** `--next`: a Next.js front end in `web/`, whatever the template says. */
  next?: boolean
  /** Secrets for a front end's `.env` files; random ones when unset. */
  secrets?: NextSecrets
}

export interface NextSecrets {
  apiKey: string
  revalidate: string
  session: string
}

/** One file to write: literal text, or a path to copy (a template's files and media). */
export interface ScaffoldFile {
  /** Relative to the new site, `/`-separated. */
  path: string
  text?: string
  copyFrom?: string
}

const DEFAULT_SITE_NAME = 'My Site'

/** Kept in step with the root `package.json`, which is what the views are checked with. */
const TYPESCRIPT_VERSION = '^7.0.2'
const BUN_TYPES_VERSION = '^1.4.2'

/** Single quotes, because the file is TypeScript the site's own formatter owns. */
const quote = (value: string): string => `'${value.replace(/[\\']/g, '\\$&')}'`

/** A directory name npm accepts: lowercase, no spaces, no leading punctuation. */
export function packageNameFor(siteName: string): string {
  const slug = siteName
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'my-site'
}

function tsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        jsxImportSource: '@crombolo/crombolo',
        strict: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        types: ['bun'],
      },
    },
    null,
    2,
  )}\n`
}

/** Search & sharing defaults, commented out: editors can also set them in Settings. */
const SEO_EXAMPLE = `  // Search & sharing defaults; each can also be set in Settings, which wins.
  // seo: { titleSuffix: ' | My site', notFoundPage: '<page key>', indexable: true },
`

/**
 * `crombolo.config.ts`. A template's server bundles are imported by name and
 * listed in `bundles`, which is the only thing that lets their endpoints
 * answer — so the scaffolded file carries a note saying so, and deleting the
 * line is how a site declines one.
 */
/** What a site with a Next.js front end in `web/` sets: the API, preview, member sign-in and its public address. */
const NEXT_CONFIG = `  // The Next.js app in web/ reads the site through the Delivery API (story 208).
  // The key is CROMBOLO_DELIVERY_API_KEY, in .env.
  deliveryApi: {
    enabled: true,
    preview: { url: \`\${APP}/api/crombolo/preview?path={path}&token={token}\` },
    memberAuthorization: {
      authorizationCodeFlow: {
        enabled: true,
        loginRedirectUrls: [\`\${APP}/api/crombolo/callback\`],
        logoutRedirectUrls: [\`\${APP}/\`],
        // A page on this site holding the member login form; add one before members sign in.
        loginPage: '/login',
      },
    },
  },
  seo: { publicUrl: APP },
`

function config(siteName: string, bundles: readonly TemplateServerBundle[], next = false): string {
  const imports = bundles
    .map((bundle) => `import { ${bundle.import} } from ${quote(bundle.package)}\n`)
    .join('')
  if (next)
    return `${imports}import { defineConfig } from '@crombolo/crombolo'

/** Where visitors see the site: the Next.js app in web/. */
const APP = process.env.CROMBOLO_APP_URL ?? 'http://localhost:3000'

export default defineConfig({
  siteName: ${quote(siteName)},
${bundles.length > 0 ? `  bundles: [${bundles.map((bundle) => `${bundle.import}()`).join(', ')}],\n` : ''}${NEXT_CONFIG}})
`
  if (bundles.length === 0)
    return `import { defineConfig } from '@crombolo/crombolo'

export default defineConfig({
  siteName: ${quote(siteName)},
${SEO_EXAMPLE}})
`
  return `${imports}import { defineConfig } from '@crombolo/crombolo'

export default defineConfig({
  siteName: ${quote(siteName)},
  // Installing a bundle gives you its backoffice screen. This line is what lets
  // its endpoints answer a request, so remove it to turn one off.
  bundles: [${bundles.map((bundle) => `${bundle.import}()`).join(', ')}],
${SEO_EXAMPLE}})
`
}

function packageJson(options: {
  name: string
  start: string
  bundles: readonly TemplateServerBundle[]
  next?: boolean
  dependencies?: Record<string, string>
}): string {
  const ranges = options.bundles.map(
    (bundle) => [bundle.package, bundle.version ?? `^${VERSION}`] as const,
  )
  const provided = ranges.filter(([name]) => name.startsWith('@crombolo/'))
  const own = [
    ...ranges.filter(([name]) => !name.startsWith('@crombolo/')),
    ...Object.entries(options.dependencies ?? {}),
  ]
  return `${JSON.stringify(
    {
      name: options.name,
      private: true,
      type: 'module',
      ...(options.next ? { workspaces: ['web'] } : {}),
      scripts: options.next
        ? { start: options.start, dev: 'bun dev.ts', 'dev:cms': 'bun --watch server.ts' }
        : { start: options.start, dev: 'bun --watch server.ts' },
      ...(own.length > 0 ? { dependencies: Object.fromEntries(own) } : {}),
      // Peers, because a host that runs the site provides the CMS; `bun install`
      // still installs them here (story 192).
      peerDependencies: { '@crombolo/crombolo': `^${VERSION}`, ...Object.fromEntries(provided) },
      // So the tsconfig written beside this has something to run it, and
      // `crombolo components check` checks types as well as compiling. The
      // versions are the ones crombolo itself is checked with; the tsconfig
      // names the `bun` types, so they have to be installed too.
      devDependencies: { '@types/bun': BUN_TYPES_VERSION, typescript: TYPESCRIPT_VERSION },
    },
    null,
    2,
  )}\n`
}

/** Every file in a scaffolded site, template files last so they win on a clash. */
export function scaffoldFiles(options: ScaffoldOptions = {}): ScaffoldFile[] {
  const siteName = options.siteName?.trim() || DEFAULT_SITE_NAME
  const bundle = options.bundle?.path
  const bundleFlags = ['--publish', ...(options.bundle?.flags ?? [])].join(' ')
  const start = bundle
    ? `crombolo start --bundle ${bundle} ${bundleFlags}`
    : options.template?.seed
      ? 'crombolo start --seed --publish'
      : 'crombolo start'
  const serverBundles = options.template?.serverBundles ?? []
  const next = options.next ?? options.template?.next ?? false
  const files: ScaffoldFile[] = [
    {
      path: 'package.json',
      text: packageJson({
        name: packageNameFor(siteName),
        // The import is a boot step rather than a config setting so that it is
        // visible here, and so that dropping it is editing one line.
        start,
        bundles: serverBundles,
        next,
        dependencies: options.template?.dependencies,
      }),
    },
    { path: 'crombolo.config.ts', text: config(siteName, serverBundles, next) },
    {
      path: 'server.ts',
      // `crombolo start` reads the config itself; `server.ts` is what `dev` and
      // a host run, and nothing else reads the file for them.
      text: `import { crombolo } from '@crombolo/crombolo'
import config from './crombolo.config.ts'

export default await crombolo(config)
`,
    },
    { path: 'tsconfig.json', text: tsconfig() },
    { path: 'schema/schema.toml', text: '[schema]\nversion = "1.0.0"\n' },
    // The media types a site owns as files rather than inheriting silently.
    ...Object.entries(siteMediaTypeFiles()).map(([path, text]) => ({ path, text })),
    { path: 'components/.gitkeep', text: '' },
    {
      path: '.gitignore',
      // `.crombolo/` holds the view snapshots: pure cache, rebuilt from `components/`
      // at every boot, and per node.
      text: '*.sqlite\n*.sqlite-*\nnode_modules/\n.env\n.crombolo/\nmedia/\nlogs/\n',
    },
  ]

  const secrets = next ? (options.secrets ?? randomSecrets()) : undefined
  if (next && secrets) files.push(...nextFiles(siteName, secrets))
  const nextEnv = secrets
    ? `CROMBOLO_DELIVERY_API_KEY=${secrets.apiKey}
CROMBOLO_REVALIDATE_SECRET=${secrets.revalidate}
`
    : ''
  if (nextEnv && !options.postgres) files.push({ path: '.env', text: nextEnv })
  if (options.postgres)
    files.push({
      path: '.env',
      text: `${nextEnv}CROMBOLO_DB=postgres
CROMBOLO_POSTGRES_URL=postgres://crombolo:crombolo@localhost:5432/${packageNameFor(siteName)}

# Postgres has no file to copy, so anything that writes needs a backup first:
# a command that takes one, or --backup-taken to vouch that you have.
# CROMBOLO_PG_DUMP=pg_dump "$CROMBOLO_POSTGRES_URL" -f "backup-$CROMBOLO_BACKUP_STAMP.sql"
`,
    })

  for (const file of componentFiles(options.template)) files.push(file)
  // One entry per path, the last winning, so a template's own `schema.toml` is
  // the one written rather than being skipped as a file that already exists.
  return [...new Map(files.map((file) => [file.path, file])).values()]
}

/** Secrets a front end and its CMS share, made fresh for each site. */
function randomSecrets(): NextSecrets {
  const secret = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
  return { apiKey: secret(), revalidate: secret(), session: secret() }
}

/** The pinned versions a front end starts on, as crombolo's own suite builds it. */
const NEXT_VERSIONS = { next: '^16.4.3', react: '^19.3.1', types: '^19.3.0', node: '^26.6.2' }

/**
 * The Next.js app in `web/` (story 208), the CMS's webhook that clears its
 * cache, and the script that starts both.
 */
function nextFiles(siteName: string, secrets: NextSecrets): ScaffoldFile[] {
  const out: ScaffoldFile[] = []
  if (existsSync(NEXT_APP_DIR))
    for (const entry of readdirSync(NEXT_APP_DIR, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const source = join(entry.parentPath, entry.name)
      out.push({
        path: `web/${relative(NEXT_APP_DIR, source).split(sepRe).join('/')}`,
        copyFrom: source,
      })
    }
  out.push(
    {
      path: 'web/package.json',
      text: `${JSON.stringify(
        {
          name: `${packageNameFor(siteName)}-web`,
          private: true,
          type: 'module',
          scripts: {
            dev: 'next dev --port 3000',
            build: 'next build',
            start: 'next start --port 3000',
          },
          dependencies: {
            '@crombolo/next-integration': `^${VERSION}`,
            next: NEXT_VERSIONS.next,
            react: NEXT_VERSIONS.react,
            'react-dom': NEXT_VERSIONS.react,
          },
          devDependencies: {
            '@types/node': NEXT_VERSIONS.node,
            '@types/react': NEXT_VERSIONS.types,
            typescript: TYPESCRIPT_VERSION,
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: 'web/.env.local',
      text: `CROMBOLO_URL=http://localhost:8080
CROMBOLO_APP_URL=http://localhost:3000
CROMBOLO_DELIVERY_API_KEY=${secrets.apiKey}
CROMBOLO_REVALIDATE_SECRET=${secrets.revalidate}
CROMBOLO_NEXT_SECRET=${secrets.session}
`,
    },
    {
      path: 'schema/webhooks/next-revalidate.toml',
      text: `[webhook]
alias = "nextRevalidate"
name = "Next.js front end"
description = "Clears the Next.js app's cache for a changed page and its ancestors."
url = "http://localhost:3000/api/crombolo/revalidate"
events = ["Umbraco.ContentPublish", "Umbraco.ContentUnpublish", "Umbraco.ContentDelete", "Umbraco.ContentMovedToRecycleBin", "Umbraco.ContentMoved", "Umbraco.ContentSorted"]
payload = "crombolo"

[webhook.headers]
X-Crombolo-Secret = "env:CROMBOLO_REVALIDATE_SECRET"
`,
    },
    {
      path: 'dev.ts',
      text: `/** Starts the CMS on port 8080 and the Next.js app in web/ on 3000, and stops both together. */
const children = [
  Bun.spawn(['bun', 'run', 'dev:cms'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn(['bun', 'run', 'dev'], { cwd: 'web', stdout: 'inherit', stderr: 'inherit' }),
]
const stop = () => {
  for (const child of children) child.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await Promise.race(children.map((child) => child.exited))
stop()
`,
    },
  )
  return out
}

/** `files/` into the site root, its seed among them. */
export function componentFiles(template: SiteTemplate | undefined): ScaffoldFile[] {
  if (!template) return []
  const out: ScaffoldFile[] = []
  const walk = (dir: string, target: (path: string) => string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const source = join(entry.parentPath, entry.name)
      out.push({ path: target(relative(dir, source).split(sepRe).join('/')), copyFrom: source })
    }
  }
  walk(join(template.dir, 'files'), (path) => path)
  return out
}

const sepRe = /[\\/]/

/**
 * A bundle from a site directory (story 164): its schema, components, styles,
 * scripts and seed, as one bundle that installs into a bare site — types,
 * views and content in one transaction. The seed is compiled against that
 * directory's own schema, booted in a throwaway database, so building needs no
 * site or database of its own.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  type BundleFile,
  bundleIdFor,
  codePatternsOf,
  readCodeFiles,
  selectCodeFiles,
  writeBundle,
  writeBundlePackage,
} from '@crombolo/transfer'
import { createFileSystemPort } from './adapters/file-system.ts'
import { createTemplateFileStore } from './adapters/template-files.ts'
import { loadConfig, VERSION } from './config.ts'
import { bootstrapDatabase } from './database.ts'
import { syncSchemaDirectory } from './schema.ts'
import { compileSeed, type SeedBuild } from './seed/compile.ts'
import { siteSections } from './site-sections.ts'

export interface BundleBuildOptions {
  /** The npm package name; default, from the directory's `site.json` or `package.json`. */
  name?: string
  /** What a person calls it; default, the site's name. */
  label?: string
  /**
   * Globs naming the site's own code, in place of `crombolo.code` in its
   * `package.json` (story 192). Neither: the bundle carries no code.
   */
  code?: readonly string[]
  /**
   * Carry the seed's media files (story 195). On unless turned off, so seeding
   * a site still brings its media; `crombolo bundle build` turns it off unless
   * `--with-media` is passed.
   */
  media?: boolean
}

export interface BundleBuildResult {
  /** What stops it being built: the schema refused, or the seed's findings. */
  problems: string[]
  seed?: SeedBuild
  files?: BundleFile[]
  name: string
  /** The site's code the bundle carries, by path; absent when it carries none. */
  code?: string[]
}

/** What a directory calls its site: `site.json`, then `package.json`, then its folder. */
function siteIdentity(dir: string): { name: string; label: string } {
  const read = (file: string) =>
    existsSync(join(dir, file))
      ? (JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>)
      : undefined
  const site = read('site.json') ?? read('template.json')
  const pkg = read('package.json')
  const label =
    (typeof site?.name === 'string' && site.name) ||
    (typeof pkg?.name === 'string' && pkg.name) ||
    (dir.split(/[\\/]/).at(-1) as string)
  const slug = (typeof site?.id === 'string' ? site.id : label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return { name: slug || 'site', label }
}

export async function buildBundleFromDirectory(
  sourceDir: string,
  options: BundleBuildOptions = {},
): Promise<BundleBuildResult> {
  const dir = resolve(sourceDir)
  const identity = siteIdentity(dir)
  const name = options.name ?? identity.name
  if (!existsSync(join(dir, 'schema')))
    return { problems: [`${dir} has no schema/ directory, so it is not a site`], name }
  const patterns = options.code ?? codePatternsOf(dir)
  const code = patterns ? selectCodeFiles(dir, patterns) : undefined
  if (code && code.problems.length > 0)
    return { problems: code.problems.map((problem) => `its code: ${problem}`), name }
  const work = mkdtempSync(join(tmpdir(), 'crombolo-bundle-build-'))
  try {
    const config = loadConfig(
      {
        siteName: options.label ?? identity.label,
        dialect: 'sqlite',
        sqliteFile: join(work, 'build.sqlite'),
        siteDir: dir,
        schemaDir: join(dir, 'schema'),
        componentsDir: join(dir, 'components'),
        stylesheetsDir: join(dir, 'css'),
        scriptsDir: join(dir, 'scripts'),
        mediaDir: join(work, 'media'),
        logsDir: join(work, 'logs'),
        development: true,
      },
      work,
    )
    const { db } = await bootstrapDatabase(config)
    try {
      const report = await syncSchemaDirectory(db, config, {
        nodeId: config.nodeId,
        revision: config.schemaRevision,
      })
      if (report.action === 'refused')
        return {
          problems: [
            `the schema was refused: ${report.reason ?? report.problems.map((p) => `${p.file}: ${p.message}`).join('; ')}`,
          ],
          name,
        }
      const seed = await compileSeed(db, config)
      if (seed.findings.length > 0 || !seed.set)
        return {
          problems: seed.findings.map((f) => `${f.file}:${f.line}  ${f.message}`),
          seed,
          name,
        }
      const sections = await siteSections(
        {
          db,
          componentFiles: createTemplateFileStore(config.componentsDir),
          components: createFileSystemPort(config.componentsDir, {
            extension: '.tsx',
            rewrites: ['.cshtml'],
          }),
          stylesheets: createFileSystemPort(config.stylesheetsDir, { extension: '.css' }),
          scripts: createFileSystemPort(config.scriptsDir, { extension: '.js' }),
          schemaDir: config.schemaDir,
        },
        'all',
      )
      const set = {
        ...seed.set,
        manifest: {
          ...seed.set.manifest,
          label: config.siteName,
          createdBy: 'crombolo bundle build',
        },
      }
      const files = writeBundlePackage(
        writeBundle(set, options.media === false ? new Map() : seed.blobs, [
          ...sections,
          ...(code ? readCodeFiles(dir, code.paths) : []),
        ]),
        {
          name,
          version: '1.0.0',
          id: bundleIdFor(name),
          label: config.siteName,
          private: true,
          // As `release:version` writes it into every committed bundle.
          peerRange: `>=${VERSION}`,
        },
      )
      return { problems: [], seed, files, name, ...(code ? { code: code.paths } : {}) }
    } finally {
      await db.close()
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Bundles as the tests need them: a package as discovery would return it, and a
 * site directory whose `package.json` declares packages for discovery to find.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  BUNDLE_SCHEMA_VERSION,
  type BundlePackage,
  backOfficeModules,
  packageInRoot,
  prepareRoot,
  readPackageJson,
  readRecord,
  recordExtension,
  writeRecord,
} from '@crombolo/backoffice-host'
import { VERSION } from '@crombolo/server'
import { applyMigration, planMigration } from '../../packages/cli/src/support/extension-migrate.ts'

/** A bundle package with a server half, for code that only reads what discovery found. */
export function stubBundlePackage(id: string, over: Partial<BundlePackage> = {}): BundlePackage {
  return {
    packageName: `@acme/${id}`,
    version: '1.0.0',
    directory: `/nowhere/${id}`,
    id,
    name: id,
    peerRange: `^${VERSION}`,
    private: false,
    bundleType: 'extension',
    field: {
      id,
      bundleType: 'extension',
      server: id,
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      permissions: {},
    },
    contentDir: undefined,
    carries: { extensions: false, content: false, server: true },
    ...over,
  }
}

export interface FixturePackage {
  /** Merged over a name, a version and a peer range on this release. */
  json?: object
  /** Files to write inside the package, by relative path. */
  files?: Record<string, string>
}

/**
 * A site directory under `output/` with these packages. An extension fixture is
 * installed as an install makes one (story 326): into its own root,
 * `extensions/<id>/node_modules/<name>`, with a line in the site's record. Any
 * other fixture is a dependency of the site, in its own `node_modules`; a name
 * given `null` is left to resolve from the repository's, which is how a
 * workspace package such as `@crombolo/simple-redirects` is found.
 */
export function siteDeclaring(
  prefix: string,
  dependencies: Record<string, FixturePackage | null>,
): string {
  const parent = join(process.cwd(), 'output')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, `${prefix}-`))
  // Its own empty views tree, so a server booted here renders nothing it shares.
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'a-site',
      dependencies: Object.fromEntries(Object.keys(dependencies).map((name) => [name, '*'])),
    }),
  )
  const rooted: string[] = []
  for (const [name, fixture] of Object.entries(dependencies)) {
    if (!fixture) continue
    const declared = (fixture.json as { crombolo?: { id?: unknown; bundleType?: unknown } })
      ?.crombolo
    const id = typeof declared?.id === 'string' ? declared.id : undefined
    // An extension, which says so or says nothing, goes in a root of its own.
    const inRoot = id !== undefined && (declared?.bundleType ?? 'extension') === 'extension'
    const dir = inRoot ? packageInRoot(root, id, name) : join(root, 'node_modules', name)
    if (inRoot) {
      prepareRoot(root, id)
      recordExtension(root, id, {
        name,
        version: String((fixture.json as { version?: unknown })?.version ?? '1.0.0'),
      })
      rooted.push(name)
    }
    mkdirSync(dir, { recursive: true })
    const json: Record<string, unknown> = {
      name,
      version: '1.0.0',
      peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
      ...fixture.json,
    }
    // An extension unless it says otherwise, as every bundle must (story 306).
    const field = json.crombolo as Record<string, unknown> | undefined
    const hasCode =
      field !== undefined && (field.server !== undefined || backOfficeModules(field).length > 0)
    // A list of permissions with no schema named is a test's shorthand for asking
    // for each; one that names schema 3 is a test of its refusal (story 308).
    const asked =
      Array.isArray(field?.permissions) && field?.schemaVersion === undefined
        ? Object.fromEntries(
            (field.permissions as string[]).map((permission) => [
              permission === 'documents.read' ? 'content.read' : permission,
              'Needed for its work',
            ]),
          )
        : field?.permissions
    if (field && typeof field === 'object')
      json.crombolo = {
        ...(!('bundleType' in field) ? { bundleType: 'extension' } : {}),
        ...field,
        ...(hasCode
          ? {
              schemaVersion: field.schemaVersion ?? (Array.isArray(asked) ? 3 : 4),
              permissions: asked ?? {},
            }
          : {}),
      }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(json))
    for (const [path, content] of Object.entries(fixture.files ?? {})) {
      const file = join(dir, path)
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, content)
    }
    toCurrentLayout(dir)
  }
  // What went in a root is not a dependency of the site.
  if (rooted.length > 0) {
    const site = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const name of rooted) delete site.dependencies[name]
    writeFileSync(join(root, 'package.json'), JSON.stringify(site))
  }
  return root
}

/**
 * A fixture package written as a test gives it, moved into this release's layout
 * by `extension migrate` (story 320). One at schema 3 or before is left as it
 * is: those tests are of its refusal. A module its manifest names that the test
 * did not write is written as an empty element, since the test does not use it.
 */
export function toCurrentLayout(dir: string): void {
  const json = readPackageJson(join(dir, 'package.json'))
  const field = json?.crombolo as Record<string, unknown> | undefined
  if (field?.bundleType !== 'extension') return
  const schema = typeof field.schemaVersion === 'number' ? field.schemaVersion : 4
  const modules = backOfficeModules(field)
  if (schema !== 4 || Array.isArray(field.permissions)) return
  if (field.server === undefined && modules.length === 0) return
  for (const module of modules) {
    const file = join(dir, module.replace(/^\.\//, ''))
    if (module.startsWith('/') || /^[a-z]+:/i.test(module) || existsSync(file)) continue
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, 'export default class extends HTMLElement {}\n')
  }
  const plan = planMigration(dir, { reason: 'Shows its screens' })
  if (plan.problems.length > 0)
    throw new Error(`The fixture at ${dir} cannot be migrated: ${plan.problems.join('; ')}`)
  applyMigration(dir, plan)
}

/**
 * Marks a fixture site's dependencies as linked, as a package built on this
 * machine is: someone has vouched for it, so its upper levels may be granted
 * (story 324). A `*` range reads as one from the registry, unsigned.
 */
export function linkedDependencies(dir: string): void {
  // An extension in a root is linked in the record (story 326).
  const record = readRecord(dir)
  for (const line of Object.values(record)) line.linked = true
  if (Object.keys(record).length > 0) writeRecord(dir, record)
  const file = join(dir, 'package.json')
  const json = JSON.parse(readFileSync(file, 'utf8')) as { dependencies?: Record<string, string> }
  json.dependencies = Object.fromEntries(
    Object.keys(json.dependencies ?? {}).map((name) => [name, `link:${name}`]),
  )
  writeFileSync(file, JSON.stringify(json))
}

/** Where a fixture package was installed: its root when it is an extension in one, else `node_modules`. */
export function fixtureDir(siteDir: string, name: string): string {
  const recorded = Object.entries(readRecord(siteDir)).find(([, line]) => line.name === name)
  return recorded ? packageInRoot(siteDir, recorded[0], name) : join(siteDir, 'node_modules', name)
}

/**
 * Moves a package a test wrote as a dependency of the site into a root of its
 * own, with its record line, as an install does now (story 326).
 */
export function moveIntoRoot(siteDir: string, name: string): string {
  const from = join(siteDir, 'node_modules', name)
  const json = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')) as {
    version: string
    crombolo: { id: string }
  }
  const id = json.crombolo.id
  prepareRoot(siteDir, id)
  const to = packageInRoot(siteDir, id, name)
  mkdirSync(dirname(to), { recursive: true })
  renameSync(from, to)
  recordExtension(siteDir, id, { name, version: json.version })
  const file = join(siteDir, 'package.json')
  const site = JSON.parse(readFileSync(file, 'utf8')) as { dependencies?: Record<string, string> }
  delete site.dependencies?.[name]
  writeFileSync(file, JSON.stringify(site))
  return to
}

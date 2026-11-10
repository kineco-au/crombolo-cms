/**
 * Bundles as the tests need them: a package as discovery would return it, and a
 * site directory whose `package.json` declares packages for discovery to find.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  BUNDLE_SCHEMA_VERSION,
  type BundlePackage,
  backOfficeModules,
  readPackageJson,
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
 * A site directory under `output/` whose `package.json` declares these
 * dependencies. A fixture is written into the site's own `node_modules`; a name
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
  for (const [name, fixture] of Object.entries(dependencies)) {
    if (!fixture) continue
    const dir = join(root, 'node_modules', name)
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

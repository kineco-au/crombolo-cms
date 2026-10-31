/**
 * The Bundles section in the backoffice: the views that replace Umbraco's, the
 * two labels its builder hard-codes, and the migrations that moved the stored
 * names. docs/bundles.md.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { formPermissionPrefixMigration, RENAMED_FORM_VERBS } from '@crombolo/data'
import { type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const PLUGIN = 'packages/backoffice-host/plugin'
const VENDOR = 'packages/backoffice-dist/dist/packages/packages'

describe('the Created view, which replaces a router', () => {
  test("reproduces every route Umbraco's own declares", async () => {
    // Umbraco's Created view is not a screen: it is the only thing that mounts
    // the builder workspace. A replacement that rendered a list would have left
    // the builder unreachable from anywhere in the backoffice.
    const theirs = await Bun.file(
      `${VENDOR}/package-section/views/created/created-packages-section-view.element.js`,
    ).text()
    const ours = await Bun.file(`${PLUGIN}/bundles-created.js`).text()
    // Upstream writes the catch-all as a template literal, so each route is
    // named twice: as it reads there, and as it reads here.
    const routes: Array<[string, string]> = [
      ["path: 'overview'", "path: 'overview'"],
      ['/edit/:unique', '/edit/:unique'],
      ['/create', '/create'],
      ["redirectTo: 'overview'", "redirectTo: 'overview'"],
      ['path: `**`', "path: '**'"],
    ]
    for (const [theirFragment, ourFragment] of routes) {
      expect([theirFragment, theirs.includes(theirFragment)]).toEqual([theirFragment, true])
      expect([ourFragment, ours.includes(ourFragment)]).toEqual([ourFragment, true])
    }
  })

  test('mounts the same workspace entity type the builder registers under', async () => {
    const manifests = await Bun.file(`${VENDOR}/package-builder/manifests.js`).text()
    expect(manifests).toContain("entityType: 'package-builder'")
    const ours = await Bun.file(`${PLUGIN}/bundles-created.js`).text()
    expect(ours).toContain("BUILDER_ENTITY_TYPE = 'package-builder'")
  })

  test('links to the builder at the path the section view is mounted on', async () => {
    // `pathname: 'created'` in the manifest and `section/packages` in the route
    // are the same two segments; a rename of either would break the link.
    const overview = await Bun.file(`${PLUGIN}/bundles-created-overview.js`).text()
    expect(overview).toContain("BUILDER_PATH = 'section/packages/view/created/package-builder'")
    const plugin = await Bun.file(`${PLUGIN}/umbraco-package.json`).json()
    const created = plugin.extensions.find(
      (e: { alias: string }) => e.alias === 'Crombolo.SectionView.Bundles.Created',
    )
    expect(created.meta.pathname).toBe('created')
    expect(created.overwrites).toEqual(['Umb.SectionView.Packages.Builder'])
  })

  test('says bundle where Umbraco said package', async () => {
    const overview = await Bun.file(`${PLUGIN}/bundles-created-overview.js`).text()
    expect(overview).toContain('headline="Created bundles"')
    expect(overview).toContain('delete this bundle?')
    expect(overview).not.toContain('this package')
  })
})

describe('the Bundle Editor (story 233)', () => {
  type Extension = {
    type: string
    alias: string
    element?: string
    overwrites?: string[]
    meta?: { entityType?: string; pathname?: string }
    conditions?: { alias: string; match: string }[]
  }
  const extensions = async (): Promise<Extension[]> =>
    (await Bun.file(`${PLUGIN}/umbraco-package.json`).json()).extensions

  test("replaces Umbraco's builder for the same entity type, so the Created view opens it", async () => {
    const all = await extensions()
    const editor = all.find((e) => e.alias === 'Crombolo.Workspace.BundleEditor')
    expect(editor).toMatchObject({
      type: 'workspace',
      overwrites: ['Umb.Workspace.PackageBuilder'],
      meta: { entityType: 'package-builder' },
    })
    expect(all.some((e) => e.alias === 'Crombolo.EntryPoint.BundleBuilderLabels')).toBe(false)
  })

  test("is what the Created view routes to, even while Umbraco's builder is still registered", async () => {
    const { editorsOf } = await import(
      '../packages/backoffice-host/plugin/bundle-editor-routing.js'
    )
    const both = [
      { alias: 'Umb.Workspace.PackageBuilder', meta: { entityType: 'package-builder' } },
      { alias: 'Crombolo.Workspace.BundleEditor', meta: { entityType: 'package-builder' } },
    ]
    expect(editorsOf(both).map((w: { alias: string }) => w.alias)).toEqual([
      'Crombolo.Workspace.BundleEditor',
    ])
    expect(editorsOf([both[0]]).map((w: { alias: string }) => w.alias)).toEqual([
      'Umb.Workspace.PackageBuilder',
    ])
  })

  test('has its tabs as workspace views on it, each with a file', async () => {
    const views = (await extensions()).filter(
      (e) =>
        e.type === 'workspaceView' &&
        e.conditions?.some((c) => c.match === 'Crombolo.Workspace.BundleEditor'),
    )
    expect(views.map((v) => v.meta?.pathname)).toEqual([
      'content',
      'types',
      'code',
      'language',
      'forms',
      'workflows',
      'user-groups',
    ])
    for (const view of views)
      expect(
        await Bun.file(
          `${PLUGIN}/${(view.element as string).replace('/crombolo-plugin/', '')}`,
        ).exists(),
      ).toBe(true)
  })

  test("imports only what Umbraco's modules export", async () => {
    const pkg = await Bun.file('packages/backoffice-dist/dist/umbraco-package.json').json()
    const map = pkg.importmap.imports as Record<string, string>
    const exported = new Map<string, Set<string>>()
    const namesOf = async (file: string, out: Set<string>, seen = new Set<string>()) => {
      if (seen.has(file) || !(await Bun.file(file).exists())) return
      seen.add(file)
      const source = await Bun.file(file).text()
      for (const m of source.matchAll(/export\s*\*\s*from\s*['"](\.[^'"]+)['"]/g))
        await namesOf(
          new URL(m[1] as string, `file://${process.cwd()}/${file}`).pathname.slice(
            process.cwd().length + 1,
          ),
          out,
          seen,
        )
      for (const m of source.matchAll(/export\s*\{([^}]*)\}/g))
        for (const n of (m[1] as string).split(','))
          out.add(
            n
              .trim()
              .split(/\s+as\s+/)
              .pop() as string,
          )
      for (const m of source.matchAll(/export (?:class|const|function|let) ([A-Za-z_$][\w$]*)/g))
        out.add(m[1] as string)
    }
    for (const file of [
      'bundle-editor.js',
      'bundle-editor-context.js',
      'bundle-editor-sections.js',
    ]) {
      const source = await Bun.file(`${PLUGIN}/${file}`).text()
      for (const m of source.matchAll(
        /import \{([^}]+)\} from '(@umbraco-cms\/backoffice\/[^']+)'/g,
      )) {
        const specifier = m[2] as string
        if (!exported.has(specifier)) {
          const out = new Set<string>()
          await namesOf(
            `packages/backoffice-dist/dist/${(map[specifier] as string).replace(/^\/umbraco\/backoffice\//, '')}`,
            out,
          )
          exported.set(specifier, out)
        }
        for (const name of (m[1] as string)
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean))
          expect([file, specifier, name, exported.get(specifier)?.has(name)]).toEqual([
            file,
            specifier,
            name,
            true,
          ])
      }
    }
  })

  test("saves through Umbraco's package repository, as its builder does", async () => {
    const ours = await Bun.file(`${PLUGIN}/bundle-editor-context.js`).text()
    const theirs = await Bun.file(
      `${VENDOR}/package-builder/workspace/workspace-package-builder.element.js`,
    ).text()
    for (const call of [
      'getCreatedPackage(',
      'saveCreatedPackage(',
      'updateCreatedPackage(',
      'getCreatePackageDownload(',
    ])
      expect([call, theirs.includes(call), ours.includes(call)]).toEqual([call, true, true])
  })
})

describe('migration 026, which re-prefixes the form verbs', () => {
  test('rewrites a stored Umb. verb to Crombolo. and leaves others alone', async () => {
    const h = await signedInServer()
    open.push(h)
    const db = h.server.db
    const [group] = await db.query<{ key: string }>(
      "SELECT key FROM user_group WHERE alias = 'admin'",
    )
    if (!group) throw new Error('the admin group was not seeded')

    await db.exec('DELETE FROM user_group_permission WHERE permission = ?', ['Crombolo.Form.Read'])
    await db.exec('INSERT INTO user_group_permission (user_group_key, permission) VALUES (?, ?)', [
      group.key,
      'Umb.Form.Read',
    ])

    await formPermissionPrefixMigration.up?.(db)

    const after = await db.query<{ permission: string }>(
      'SELECT permission FROM user_group_permission WHERE user_group_key = ? AND permission IN (?, ?)',
      [group.key, 'Umb.Form.Read', 'Crombolo.Form.Read'],
    )
    expect(after.map((row) => row.permission)).toEqual(['Crombolo.Form.Read'])
    // An Umbraco verb with a similar shape is untouched.
    const document = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM user_group_permission WHERE permission = 'Umb.Document.Read'",
    )
    expect(Number(document[0]?.n ?? 0)).toBeGreaterThan(0)
  })

  test('leaves one row when a group somehow holds both spellings', async () => {
    const h = await signedInServer()
    open.push(h)
    const db = h.server.db
    const [group] = await db.query<{ key: string }>(
      "SELECT key FROM user_group WHERE alias = 'admin'",
    )
    if (!group) throw new Error('the admin group was not seeded')

    await db.exec('INSERT INTO user_group_permission (user_group_key, permission) VALUES (?, ?)', [
      group.key,
      'Umb.FormEntry.Sensitive',
    ])
    await formPermissionPrefixMigration.up?.(db)

    const rows = await db.query<{ permission: string }>(
      'SELECT permission FROM user_group_permission WHERE user_group_key = ? AND permission = ?',
      [group.key, 'Crombolo.FormEntry.Sensitive'],
    )
    expect(rows).toHaveLength(1)
  })

  test('covers every verb the seed grants', () => {
    expect(RENAMED_FORM_VERBS.map(([before]) => before)).toEqual([
      'Umb.Form.Read',
      'Umb.Form.Manage',
      'Umb.FormEntry.Read',
      'Umb.FormEntry.Manage',
      'Umb.FormEntry.Sensitive',
    ])
    for (const [before, after] of RENAMED_FORM_VERBS) {
      expect([before, after]).toEqual([before, before.replace(/^Umb\./, 'Crombolo.')])
    }
  })
})

describe('migration 027, which renames the table', () => {
  test('leaves the definitions in a table called bundle', async () => {
    const h = await signedInServer()
    open.push(h)
    const rows = await h.server.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM bundle')
    expect(Number(rows[0]?.n ?? -1)).toBe(0)
    await expect(h.server.db.query('SELECT 1 FROM created_package')).rejects.toThrow()
  })
})

/**
 * The framework's backoffice package: the Changes dashboard and the read-only
 * banner are served and registered like any installed npm extension, and read a
 * report endpoint that a development boot fills. Proved by its endpoint and
 * its manifest, not by clicking it. docs/10, "The upgrade dashboard ships in the first release".
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository, connect, readLedger, writeReport } from '@crombolo/data'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

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

const ARTICLE = (extra: string) => `[content-type]
key = "0b1c8e3a-4444-4a5b-9c1d-000000000001"
alias = "article"
name = "Article"
allow-at-root = true

[[property]]
key = "0b1c8e3a-4444-4a5b-9c1d-000000000002"
alias = "title"
name = "Title"
type = "textstring"
${extra}`

const REQUIRED_SUMMARY = `
[[property]]
key = "0b1c8e3a-4444-4a5b-9c1d-000000000003"
alias = "summary"
name = "Summary"
type = "textarea"
mandatory = true
`

function site(version: string, extra: string) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'dashboard-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), `[schema]\nversion = "${version}"\n`)
  writeFileSync(join(root, 'schema', 'content-types', 'article.toml'), ARTICLE(extra))
  return {
    root,
    schemaDir: join(root, 'schema'),
    componentsDir: join(root, 'components'),
    sqliteFile: join(root, 'site.sqlite'),
  }
}

describe(`changes dashboard (${dialectUnderTest})`, () => {
  test('the framework package is in the manifests and its modules are served', async () => {
    const h = await signedInServer()
    open.push(h)
    const manifests = await h.json<
      Array<{
        name: string
        extensions: Array<{
          type: string
          alias: string
          element?: string
          js?: string
          api?: string
          overwrites?: string[]
        }>
      }>
    >(`${V1}/manifest/manifest`)
    const ours = manifests.find((m) => m.name === 'Crombolo')
    expect(ours).toBeDefined()
    const aliases = ours?.extensions.map((e) => `${e.type}:${e.alias}`) ?? []
    expect(aliases).toEqual([
      'theme:Crombolo.Theme.Dark',
      'theme:Crombolo.Theme.System',
      'backofficeEntryPoint:Crombolo.EntryPoint.SessionGuard',
      'backofficeEntryPoint:Crombolo.EntryPoint.ThemeSync',
      'entityUserPermission:Crombolo.UserPermission.Remote.Pull',
      'entityUserPermission:Crombolo.UserPermission.Remote.PullFull',
      'entityUserPermission:Crombolo.UserPermission.Remote.Push',
      'entityUserPermission:Crombolo.UserPermission.Remote.PushProtected',
      'entityUserPermission:Crombolo.UserPermission.Remote.ApplyStructure',
      'entityUserPermission:Crombolo.UserPermission.Remote.InstallCode',
      'entityUserPermission:Crombolo.UserPermission.Media.Read',
      'entityUserPermission:Crombolo.UserPermission.Media.Update',
      'backofficeEntryPoint:Crombolo.EntryPoint.MediaPermissions',
      'backofficeEntryPoint:Crombolo.EntryPoint.PageSharing',
      'backofficeEntryPoint:Crombolo.EntryPoint.PreviewMember',
      'backofficeEntryPoint:Crombolo.EntryPoint.MediaAccess',
      'backofficeEntryPoint:Crombolo.EntryPoint.EditConflicts',
      'userProfileApp:Crombolo.UserProfileApp.SignedInDevices',
      'mfaLoginProvider:Crombolo.MfaLoginProvider.Authenticator',
      'dashboard:Crombolo.Dashboard.CiAccess',
      'dashboard:Crombolo.Dashboard.Bundles',
      // The Bundle Editor, in place of Umbraco's package builder (stories 233, 226).
      'workspace:Crombolo.Workspace.BundleEditor',
      'workspaceView:Crombolo.WorkspaceView.BundleEditor.Content',
      'workspaceView:Crombolo.WorkspaceView.BundleEditor.Types',
      'workspaceView:Crombolo.WorkspaceView.BundleEditor.Code',
      'workspaceView:Crombolo.WorkspaceView.BundleEditor.Language',
      'workspaceView:Crombolo.WorkspaceView.BundleEditor.Forms',
      'workspaceView:Crombolo.WorkspaceView.BundleEditor.Workflows',
      'workspaceView:Crombolo.WorkspaceView.BundleEditor.UserGroups',
      'workspaceView:Crombolo.WorkspaceView.Webhook.Storage',
      'dashboard:Crombolo.Dashboard.Addresses',
      'dashboard:Crombolo.Dashboard.Changes',
      'dashboard:Crombolo.Dashboard.BackgroundJobs',
      'dashboard:Crombolo.Dashboard.AuditLog',
      'homeView:Crombolo.HomeView.Overview',
      'dashboard:Crombolo.Dashboard.ContentHome',
      // Settings' own layout, in place of the welcome dashboard (story 234).
      'sectionLayout:Crombolo.SectionLayout.Settings',
      'backofficeEntryPoint:Crombolo.EntryPoint.TsxEditors',
      'headerApp:Crombolo.HeaderApp.ReadOnly',
      'backofficeEntryPoint:Crombolo.EntryPoint.SidePanels',
      'globalContext:Crombolo.GlobalContext.SidePanel',
      'headerApp:Crombolo.HeaderApp.BundlesChanged',
      'headerApp:Crombolo.HeaderApp.MediaJobs',
      'headerApp:Crombolo.HeaderApp.Settings',
      'workspaceFooterApp:Crombolo.WorkspaceFooterApp.ElementTypeHint',
      'workspaceFooterApp:Crombolo.WorkspaceFooterApp.FormTypeNote',
      'backofficeEntryPoint:Crombolo.EntryPoint.HelpMenu',
      'section:Crombolo.Section.Forms',
      'entityAction:Crombolo.EntityAction.Document.EditContentType',
      'entityAction:Crombolo.EntityAction.Document.EditTemplate',
      'backofficeEntryPoint:Crombolo.EntryPoint.ContentStrip',
      'entityCreateOptionAction:Crombolo.EntityCreateOptionAction.DocumentType.Form',
      'menuItem:Crombolo.MenuItem.Forms',
      'menuItem:Crombolo.MenuItem.Workflows',
      'sectionSidebarApp:Crombolo.SectionSidebarApp.DefinitionTree',
      'sectionView:Crombolo.SectionView.Forms.Overview',
      'sectionView:Crombolo.SectionView.Forms.Entries',
      'propertyEditorSchema:Crombolo.FormPicker',
      'propertyEditorUi:Crombolo.PropertyEditorUi.FormPicker',
      // One tree over components/, in place of Templates and Partial Views.
      'backofficeEntryPoint:Crombolo.EntryPoint.ComponentsTree',
      'backofficeEntryPoint:Crombolo.EntryPoint.ContentTypeLabels',
      // The sign-in button, in place of Umbraco's "Sign in with Umbraco".
      'backofficeEntryPoint:Crombolo.EntryPoint.SignIn',
      'backofficeEntryPoint:Crombolo.EntryPoint.TemplatePicker',
      'backofficeEntryPoint:Crombolo.EntryPoint.DictionaryWords',
      'backofficeEntryPoint:Crombolo.EntryPoint.NotificationsDialog',
      // Keeps the Umbraco mark out of the icon picker.
      'globalContext:Crombolo.GlobalContext.Icons',
      // Approval workflows: Umbraco Workflow's section, in core here (story 028).
      // A page's Workflow tab shows only while the site has a workflow or a request is open
      // (234); Approvals, in the menu under Content, says when there is none.
      'condition:Crombolo.Condition.ApprovalsActive',
      'section:Crombolo.Section.Structure',
      'section:Crombolo.Section.Components',
      'section:Crombolo.Section.WorkflowSetup',
      'section:Crombolo.Section.Workflow',
      'sectionSidebarApp:Crombolo.SectionSidebarApp.ApprovalsTree',
      'sectionView:Crombolo.SectionView.Workflow.Requests',
      // Setting workflows up is a node in Structure, or beside forms; deciding is Approvals'.
      'sectionView:Crombolo.SectionView.Workflows',
      // Sending for approval is in the bottom bar, beside Save and publish.
      'condition:Crombolo.Condition.Document.MaySendForApproval',
      'workspaceAction:Crombolo.WorkspaceAction.Document.SendForApproval',
      'workspaceActionMenuItem:Crombolo.WorkspaceActionMenuItem.Document.RequestUnpublish',
      'workspaceView:Crombolo.WorkspaceView.Document.Workflow',
    ])
    // Content's home takes the place of Umbraco's news dashboard through the
    // registry's own `overwrites`, rather than mutating it while rendering.
    const home = ours?.extensions.find((e) => e.alias === 'Crombolo.Dashboard.ContentHome')
    expect(home?.overwrites).toEqual(['Umb.Dashboard.UmbracoNews'])
    // Bundles is a Settings tool (story 238), not Umbraco's Packages section:
    // its views are the tool's tabs, so none is a section view any more.
    const bundles = ours?.extensions.find((e) => e.alias === 'Crombolo.Dashboard.Bundles')
    expect(bundles?.type).toBe('dashboard')
    expect(
      ours?.extensions.filter((e) => e.type === 'sectionView' && /Bundles/.test(e.alias)),
    ).toEqual([])
    // Five kinds of extension have no module of their own: a `theme`, which is a
    // stylesheet (story 049); a `section`, which is
    // a route and a label, a `propertyEditorSchema`, which declares a
    // server-side editor alias and its default UI; a header app of `kind:
    // 'button'`, whose element the client supplies; and an
    // `entityUserPermission`, which declares a verb a user group can grant.
    // Everything else loads one, under `element`, `js`, or — for a context
    // class — `api`.
    const moduleless = ours?.extensions.filter((e) => !e.element && !e.js && !e.api) ?? []
    expect(moduleless.map((e) => e.alias)).toEqual([
      'Crombolo.Theme.Dark',
      'Crombolo.Theme.System',
      'Crombolo.UserPermission.Remote.Pull',
      'Crombolo.UserPermission.Remote.PullFull',
      'Crombolo.UserPermission.Remote.Push',
      'Crombolo.UserPermission.Remote.PushProtected',
      'Crombolo.UserPermission.Remote.ApplyStructure',
      'Crombolo.UserPermission.Remote.InstallCode',
      'Crombolo.UserPermission.Media.Read',
      'Crombolo.UserPermission.Media.Update',
      'Crombolo.HeaderApp.Settings',
      'Crombolo.Section.Forms',
      'Crombolo.FormPicker',
      'Crombolo.Section.Structure',
      'Crombolo.Section.Components',
      'Crombolo.Section.WorkflowSetup',
      'Crombolo.Section.Workflow',
    ])
    expect(moduleless.map((e) => e.type)).toEqual([
      'theme',
      'theme',
      'entityUserPermission',
      'entityUserPermission',
      'entityUserPermission',
      'entityUserPermission',
      'entityUserPermission',
      'entityUserPermission',
      'entityUserPermission',
      'entityUserPermission',
      'headerApp',
      'section',
      'propertyEditorSchema',
      'section',
      'section',
      'section',
      'section',
    ])

    // Module paths follow the backoffice mount and resolve to real modules
    for (const extension of ours?.extensions ?? []) {
      const path = (extension.element ?? extension.js ?? extension.api) as string | undefined
      if (!path) continue
      expect(path.startsWith(`${BACKOFFICE}/crombolo/`)).toBe(true)
      const response = await h.call(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('javascript')
      // What a module must export follows what kind of extension it is: an element
      // defines one, a context exports the class as `api`, an entry point runs
      // `onInit`, and a localization is a dictionary.
      const expected = extension.element
        ? 'customElements.define'
        : extension.api
          ? ' as api }'
          : extension.type === 'localization'
            ? 'export default'
            : 'export const onInit'
      const text = await response.text()
      // A tab re-exported from the module that defines it defines it on import.
      const reexported = extension.element && /as default \} from '\.\//.test(text)
      if (!reexported) expect(text, `${extension.alias} exports ${expected}`).toContain(expected)
    }
    expect((await h.call(`${BACKOFFICE}/crombolo/report-client.js`)).status).toBe(200)
    expect((await h.call(`${BACKOFFICE}/crombolo/../package.json`)).status).not.toBe(200)
  })

  test('the report endpoint needs a session, and a development boot fills it with what the schema needs', async () => {
    const s = site('1.0.0', '')
    const first = await signedInServer({
      config: {
        schemaDir: s.schemaDir,
        componentsDir: s.componentsDir,
        sqliteFile: s.sqliteFile,
        development: true,
        nodeId: 'dev',
      },
    })
    open.push(first)
    const typeKey = (await new ContentTypeRepository(first.server.db).byAlias('article'))
      ?.key as string
    for (const name of ['One', 'Two']) {
      const created = await first.post(`${V1}/document`, {
        documentType: { id: typeKey },
        template: null,
        parent: null,
        values: [{ alias: 'title', culture: null, segment: null, value: name }],
        variants: [{ culture: null, segment: null, name }],
      })
      expect(created.status).toBe(201)
      const key = created.headers.get('umb-generated-resource') as string
      expect(
        (await first.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status,
      ).toBe(200)
    }
    const anonymous = await first.server.fetch(
      new Request(`http://localhost${BACKOFFICE}/crombolo/api/change-report`),
    )
    expect(anonymous.status).toBe(401)
    const empty = await first.json<{ counts: Record<string, number>; findings: unknown[] }>(
      `${BACKOFFICE}/crombolo/api/change-report`,
    )
    expect(empty.findings).toEqual([])
    await first.db.close()
    open.pop()

    // A bundle was checked against this site before the restart. The boot below
    // writes its own findings, and a run resolves whatever it does not report —
    // so without the source scoping this would silently clear the bundle's
    // report on every dev server restart, which is the failure nobody would see.
    const between = await connect({ file: s.sqliteFile })
    await writeReport(
      between,
      [
        {
          kind: 'person',
          code: 'local-edit',
          subjectType: 'document',
          subjectKey: 'doc-b',
          subjectName: 'Landing',
          propertyAlias: null,
          culture: null,
          message: 'edited here since the bundle was exported',
          link: null,
        },
      ],
      { source: 'transfer', scope: 'campaign-x' },
    )
    await between.close()

    // The developer adds a required property and restarts: pending-allowed, so boot proceeds and reports
    writeFileSync(join(s.schemaDir, 'content-types', 'article.toml'), ARTICLE(REQUIRED_SUMMARY))
    writeFileSync(join(s.schemaDir, 'schema.toml'), '[schema]\nversion = "1.1.0"\n')
    const second = await signedInServer({
      keepDatabase: true,
      config: {
        schemaDir: s.schemaDir,
        componentsDir: s.componentsDir,
        sqliteFile: s.sqliteFile,
        development: true,
        nodeId: 'dev',
      },
    })
    open.push(second)
    expect(second.server.schema.report?.action).toBe('applied')
    // The boot already applied the change, so the diff is empty; the unfilled pages remain
    expect(second.server.schema.check?.classification).toBe('none')
    const report = await second.json<{
      health: { ok: boolean; readOnly: boolean; version: string }
      counts: Record<string, number>
      bySource: Record<string, Record<string, number>>
      findings: Array<{
        kind: string
        code: string
        source: string
        scope: string | null
        subjectName: string
        link: string | null
        status: string
      }>
    }>(`${BACKOFFICE}/crombolo/api/change-report`)
    expect(report.health).toMatchObject({ ok: true, readOnly: false, version: '1.1.0' })
    // The boot's two findings, plus the bundle's — which it neither reported nor
    // resolved. The dashboard separates them by source rather than pooling them.
    expect(report.counts).toEqual({ person: 3 })
    expect(report.bySource).toEqual({ upgrade: { person: 2 }, transfer: { person: 1 } })
    expect(report.findings.map((f) => [f.source, f.code, f.subjectName, f.status])).toEqual([
      ['transfer', 'local-edit', 'Landing', 'open'],
      ['upgrade', 'mandatory-unfilled', 'One', 'open'],
      ['upgrade', 'mandatory-unfilled', 'Two', 'open'],
    ])
    expect(report.findings.find((f) => f.code === 'local-edit')?.scope).toBe('campaign-x')
    expect(report.findings.find((f) => f.code === 'mandatory-unfilled')?.link).toMatch(
      new RegExp(`^${BACKOFFICE}/section/content/workspace/document/edit/`),
    )
  })

  test('production boot refuses a schema change that needs data work, naming the command', async () => {
    if (dialectUnderTest !== 'sqlite') return
    const s = site('1.0.0', '')
    const config = {
      schemaDir: s.schemaDir,
      componentsDir: s.componentsDir,
      sqliteFile: s.sqliteFile,
      development: false,
      schemaWritable: false,
      nodeId: 'prod',
    }
    const live = await signedInServer({ config })
    open.push(live)
    const typeKey = (await new ContentTypeRepository(live.server.db).byAlias('article'))
      ?.key as string
    await live.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: null,
      parent: null,
      values: [{ alias: 'title', culture: null, segment: null, value: 'Page' }],
      variants: [{ culture: null, segment: null, name: 'Page' }],
    })
    await live.db.close()
    open.pop()

    writeFileSync(join(s.schemaDir, 'content-types', 'article.toml'), ARTICLE(REQUIRED_SUMMARY))
    writeFileSync(join(s.schemaDir, 'schema.toml'), '[schema]\nversion = "1.1.0"\n')
    const { createServer, loadConfig, UpgradeRequiredError } = await import('@crombolo/server')
    let failure: unknown
    try {
      const server = await createServer(loadConfig(config))
      await server.close()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(UpgradeRequiredError)
    expect((failure as Error).message).toContain('crombolo upgrade check')
    // An additive change (an optional property) rolls out at boot as before
    writeFileSync(
      join(s.schemaDir, 'content-types', 'article.toml'),
      ARTICLE(REQUIRED_SUMMARY.replace('mandatory = true\n', '')),
    )
    const rolled = await signedInServer({ keepDatabase: true, config })
    open.push(rolled)
    expect(rolled.server.schema.report?.action).toBe('applied')
    expect((await readLedger(rolled.server.db)).some((r) => r.kind === 'upgrade')).toBe(false)
  })
})

describe('the plugin views', () => {
  test('a dashboard, section view or workspace view is an Umbraco element, which the router provides context on', () => {
    const dir = join(import.meta.dir, '..', 'packages', 'backoffice-host', 'plugin')
    const manifest = JSON.parse(readFileSync(join(dir, 'umbraco-package.json'), 'utf8')) as {
      extensions: Array<{ type: string; alias: string; element?: string }>
    }
    const plain = manifest.extensions
      .filter(
        (e) =>
          (e.type === 'dashboard' || e.type === 'sectionView' || e.type === 'workspaceView') &&
          e.element,
      )
      .filter((e) => {
        const read = (file: string) => readFileSync(join(dir, file), 'utf8')
        let source = read((e.element as string).replace('/crombolo-plugin/', ''))
        // A view re-exported from the module that defines it.
        const from = /export \{[^}]*\bdefault\b[^}]*\} from '\.\/([^']+)'/.exec(source)?.[1]
        if (from) source = read(from)
        return !source.includes('UmbLitElement') && !source.includes('UmbElementMixin')
      })
      .map((e) => e.alias)
    // A plain LitElement fails as `provideContext is not a function` when the view opens.
    expect(plain).toEqual([])
  })

  test('Approvals is one list, always there, and workflows are set up beside forms too', () => {
    const dir = join(import.meta.dir, '..', 'packages', 'backoffice-host', 'plugin')
    const manifest = JSON.parse(readFileSync(join(dir, 'umbraco-package.json'), 'utf8')) as {
      extensions: Array<{
        type: string
        alias: string
        weight?: number
        conditions?: { alias: string; match?: string }[]
      }>
    }
    const views = manifest.extensions
      .filter(
        (e) =>
          e.type === 'sectionView' &&
          e.conditions?.some((c) => c.match === 'Crombolo.Section.Workflow'),
      )
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    expect(views.map((v) => v.alias)).toEqual(['Crombolo.SectionView.Workflow.Requests'])
    const designer = manifest.extensions.find((e) => e.alias === 'Crombolo.SectionView.Workflows')
    expect(designer?.type).toBe('sectionView')
    expect(designer?.conditions).toEqual([
      { alias: 'Umb.Condition.SectionAlias', match: 'Crombolo.Section.Forms' },
      { alias: 'Umb.Condition.SectionUserPermission', match: 'Crombolo.Section.WorkflowSetup' },
    ])
    const approvals = manifest.extensions.find((e) => e.alias === 'Crombolo.Section.Workflow')
    expect(approvals?.conditions).toBeUndefined()
  })

  test('no view uses a link to nowhere for an action', () => {
    // The backoffice router follows any href, a cancelled click included, so
    // `href="#"` sends the editor to the home page.
    const dir = join(import.meta.dir, '..', 'packages', 'backoffice-host', 'plugin')
    const offenders = [...new Bun.Glob('**/*.js').scanSync({ cwd: dir })].filter((file) =>
      readFileSync(join(dir, file), 'utf8').includes('href="#"'),
    )
    expect(offenders).toEqual([])
  })
})

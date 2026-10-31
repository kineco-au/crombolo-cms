/**
 * Story 226: a created bundle carries the forms, approval workflows and user
 * groups its author picks, and what those bring with them, less anything the
 * author unticks. docs/bundles.md, "The Bundle Editor".
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FORM_RENDERED_FIELD, FORM_TOKEN_FIELD } from '@crombolo/core'
import { FormEntryRepository, UserGroupRepository } from '@crombolo/data'
import {
  carriedPicks,
  formSigningSecret,
  installBundleContent,
  signFormToken,
  siteSections,
} from '@crombolo/server'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'
import { untar } from './support/tar.ts'

const SITE = join(import.meta.dir, '..', 'sites', 'plain-signal')
const PLUGIN = `${BACKOFFICE}/crombolo/api/bundles`
const FORM_KEY = '3e9a5b71-2c4d-4f8e-9a16-5b0c7d2e4f58'

const NONE = { forms: [], workflows: [], userGroups: [], excluded: [] }

const form = (alias: string, contentType?: string) =>
  ({
    alias,
    name: alias,
    workflows: contentType
      ? [{ type: 'saveAsContent', settings: { 'content-type': contentType, parent: 'x' } }]
      : [],
  }) as never

const workflow = (alias: string, contentTypes: string[], approvers: string[][]) =>
  ({
    alias,
    name: `The ${alias}`,
    appliesTo: { branches: [], contentTypes },
    stages: approvers.map((groups) => ({ approvers: groups })),
  }) as never

const SET = {
  version: '1',
  contentTypes: [],
  dataTypes: [],
  languages: [],
  forms: [form('enquiry', 'enquiryRecord'), form('newsletter')],
  workflows: [workflow('review', ['article', 'page'], [['subEditors'], ['editors', 'subEditors']])],
}

describe('what a set of picks carries', () => {
  test('a workflow brings the document types it covers and the groups its stages name', () => {
    expect(carriedPicks(SET, { ...NONE, workflows: ['review'] })).toEqual([
      { kind: 'workflow', alias: 'review' },
      {
        kind: 'documentType',
        alias: 'article',
        for: { kind: 'workflow', alias: 'review', name: 'The review' },
      },
      {
        kind: 'documentType',
        alias: 'page',
        for: { kind: 'workflow', alias: 'review', name: 'The review' },
      },
      {
        kind: 'userGroup',
        alias: 'subEditors',
        for: { kind: 'workflow', alias: 'review', name: 'The review' },
      },
      {
        kind: 'userGroup',
        alias: 'editors',
        for: { kind: 'workflow', alias: 'review', name: 'The review' },
      },
    ])
  })

  test('a form brings the document type its entries are saved as, and nothing else', () => {
    expect(carriedPicks(SET, { ...NONE, forms: ['enquiry', 'newsletter'] })).toEqual([
      { kind: 'form', alias: 'enquiry' },
      { kind: 'form', alias: 'newsletter' },
      {
        kind: 'documentType',
        alias: 'enquiryRecord',
        for: { kind: 'form', alias: 'enquiry', name: 'enquiry' },
      },
    ])
  })

  test('what was picked is listed once, and an unticked dependency is marked rather than dropped', () => {
    const carried = carriedPicks(SET, {
      ...NONE,
      workflows: ['review'],
      userGroups: ['editors'],
      excluded: ['documentType:page', 'userGroup:editors'],
    })
    expect(carried.filter((pick) => pick.alias === 'editors')).toEqual([
      { kind: 'userGroup', alias: 'editors' },
    ])
    expect(carried.find((pick) => pick.alias === 'page')?.excluded).toBe(true)
  })

  test('a pick the site no longer has carries itself and nothing more', () => {
    expect(carriedPicks(SET, { ...NONE, workflows: ['gone'] })).toEqual([
      { kind: 'workflow', alias: 'gone' },
    ])
  })
})

describe('a created bundle with picks', () => {
  let h: Harness
  let root: string

  beforeAll(async () => {
    root = mkdtempSync(join(process.cwd(), 'output', 'schema-picks-'))
    for (const part of ['schema', 'components'])
      cpSync(join(SITE, part), join(root, part), { recursive: true })
    h = await signedInServer({
      config: {
        schemaDir: join(root, 'schema'),
        componentsDir: join(root, 'components'),
        componentsCacheDir: join(root, '.crombolo'),
      },
    })
  }, 60_000)

  afterAll(async () => {
    await h?.db.close().catch(() => {})
    if (root) rmSync(root, { recursive: true, force: true })
  })

  const create = async (name: string) => {
    const response = await h.post(`${V1}/package/created`, {
      name,
      contentNodeId: null,
      contentLoadChildNodes: false,
      mediaIds: [],
      mediaLoadChildNodes: false,
      documentTypes: [],
      mediaTypes: [],
      dataTypes: [],
      components: [],
      partialViews: [],
      stylesheets: [],
      scripts: [],
      languages: [],
      dictionaryItems: [],
    })
    expect(response.status).toBe(201)
    return response.headers.get('umb-generated-resource') as string
  }

  test('offers the site’s forms, workflows and groups, and says what a choice brings', async () => {
    const choices = await h.json<Record<string, { alias: string; name: string }[]>>(
      `${PLUGIN}/schema`,
    )
    expect(choices.forms).toEqual([{ alias: 'writeToTheDesk', name: expect.any(String) }])
    expect(choices.workflows).toEqual([{ alias: 'articleApproval', name: 'Article approval' }])
    expect(choices.userGroups?.map((g) => g.alias).sort()).toEqual([
      'editors',
      'subEditors',
      'writers',
    ])
    const response = await h.post(`${PLUGIN}/schema/carried`, { workflows: ['articleApproval'] })
    const { carried } = (await response.json()) as { carried: { kind: string; alias: string }[] }
    expect(carried.map((pick) => `${pick.kind}:${pick.alias}`)).toEqual([
      'workflow:articleApproval',
      'documentType:article',
      'userGroup:subEditors',
      'userGroup:editors',
    ])
  })

  test('keeps its picks, and its download carries the files and what they bring', async () => {
    const id = await create('Newsroom')
    expect(await h.json<object>(`${PLUGIN}/created/${id}/schema`)).toEqual(NONE)
    const saved = await h.put(`${PLUGIN}/created/${id}/schema`, {
      forms: ['writeToTheDesk'],
      workflows: ['articleApproval'],
      userGroups: ['writers', 7],
      excluded: ['userGroup:editors'],
    })
    expect(saved.status).toBe(200)
    expect(await h.json<object>(`${PLUGIN}/created/${id}/schema`)).toEqual({
      forms: ['writeToTheDesk'],
      workflows: ['articleApproval'],
      userGroups: ['writers'],
      excluded: ['userGroup:editors'],
    })

    const response = await h.call(`${PLUGIN}/created/${id}/download`)
    expect(response.status).toBe(200)
    const entries = untar(new Uint8Array(await response.arrayBuffer()))
    const paths = [...entries.keys()].filter((path) => path.startsWith('schema/'))
    expect(paths.sort()).toEqual([
      'schema/content-types/article.toml',
      'schema/forms/contact.toml',
      'schema/schema.toml',
      'schema/user-groups/sub-editors.toml',
      'schema/user-groups/writers.toml',
      'schema/workflows/article-approval.toml',
    ])
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('bundle.json'))) as {
      carries: Record<string, string[]>
    }
    expect(manifest.carries.schema).toContain('schema/workflows/article-approval.toml')
  })

  test('a bundle that is gone has no picks to read or keep', async () => {
    const gone = crypto.randomUUID()
    expect((await h.call(`${PLUGIN}/created/${gone}/schema`)).status).toBe(404)
    expect((await h.put(`${PLUGIN}/created/${gone}/schema`, NONE)).status).toBe(404)
  })

  test('installed on another site, its form takes an entry and its workflow covers the pages', async () => {
    const id = await create('Desk')
    await h.put(`${PLUGIN}/created/${id}/schema`, {
      forms: ['writeToTheDesk'],
      workflows: ['articleApproval'],
    })
    const response = await h.call(`${PLUGIN}/created/${id}/download`)
    const dir = join(root, 'desk-bundle')
    for (const [path, bytes] of untar(new Uint8Array(await response.arrayBuffer()))) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), bytes)
    }

    const other = mkdtempSync(join(process.cwd(), 'output', 'schema-picks-other-'))
    try {
      mkdirSync(join(other, 'schema'))
      cpSync(join(SITE, 'schema', 'schema.toml'), join(other, 'schema', 'schema.toml'))
      cpSync(join(SITE, 'components'), join(other, 'components'), { recursive: true })
      const b = await signedInServer({
        config: {
          siteDir: other,
          schemaDir: join(other, 'schema'),
          componentsDir: join(other, 'components'),
          componentsCacheDir: join(other, '.crombolo'),
        },
      })
      try {
        const installed = await installBundleContent(b.server.db, b.server.config, {
          bundle: dir,
          backupTaken: true,
        })
        expect(installed.problems).toEqual([])

        const groups = new UserGroupRepository(b.server.db)
        expect((await groups.byAlias('subEditors'))?.name).toBe('Sub-editors')
        expect((await groups.byAlias('editors'))?.name).toBe('Editors')
        const workflows = await b.json<{
          items: { alias: string; appliesTo: { contentTypes: string[] } }[]
        }>(`${BACKOFFICE}/crombolo/api/approvals/workflows`)
        expect(workflows.items).toMatchObject([
          { alias: 'articleApproval', appliesTo: { contentTypes: ['article'] } },
        ])

        const renderedAt = Date.now() - 10_000
        const body = new FormData()
        for (const [name, value] of Object.entries({
          readerName: 'Ada',
          readerEmail: 'ada@example.com',
          reason: 'A question about a story',
          message: 'Which model was it?',
          consent: 'true',
        }))
          body.append(name, value)
        body.set(
          FORM_TOKEN_FIELD,
          signFormToken(await formSigningSecret(b.server.db), FORM_KEY, renderedAt),
        )
        body.set(FORM_RENDERED_FIELD, String(renderedAt))
        const posted = await b.server.fetch(
          new Request(`http://localhost/crombolo/forms/${FORM_KEY}`, {
            method: 'POST',
            body,
            headers: { referer: 'http://localhost/', accept: 'application/json' },
          }),
        )
        expect(posted.status).toBe(200)
        expect(await new FormEntryRepository(b.server.db).count(FORM_KEY)).toBe(1)
      } finally {
        await b.db.close().catch(() => {})
      }
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  }, 60_000)

  test('a site-directory bundle carries every form, workflow and group file', async () => {
    const files = await siteSections(
      { db: h.server.db, componentFiles: undefined as never, schemaDir: join(root, 'schema') },
      'all',
    )
    const paths = files.map((file) => file.path)
    expect(paths).toContain('schema/forms/contact.toml')
    expect(paths).toContain('schema/workflows/article-approval.toml')
    expect(paths).toContain('schema/user-groups/writers.toml')
  })
})

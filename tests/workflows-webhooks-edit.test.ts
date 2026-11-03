/**
 * Story 251: approval workflows and webhooks changed from the command line.
 * The pure edits on their own, then `workflows` and `webhooks` through the CLI
 * on a SQLite site with an approval request waiting.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SchemaWorkflow } from '@crombolo/core'
import { ApprovalRepository, connect } from '@crombolo/data'
import { addStage, removeStage, updateStage, updateWorkflow } from '@crombolo/schema'
import { updateWebhook, type WebhookDefinition, webhookKeyFor } from '@crombolo/server'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const workflow = (): SchemaWorkflow => ({
  alias: 'signOff',
  name: 'Sign-off',
  appliesTo: { branches: [], contentTypes: ['page'] },
  publishersMaySkip: true,
  onEdit: 'withdraw',
  selfApproval: 'refused',
  comments: 'optional',
  unpublish: false,
  onChange: 'keep',
  stages: [
    {
      alias: 'review',
      approvers: ['editor'],
      required: 'one',
      next: ['legal'],
      sendBack: 'editor',
    },
    { alias: 'legal', approvers: ['admin'], required: 'all', next: [], sendBack: 'review' },
  ],
})

const webhook = (): WebhookDefinition => ({
  key: webhookKeyFor('searchIndex'),
  alias: 'searchIndex',
  name: null,
  description: null,
  url: 'https://search.example/hook',
  enabled: true,
  events: ['Umbraco.ContentPublish'],
  contentTypeKeys: [],
  headers: {},
})

describe('the workflow edits', () => {
  test('rules and what it covers', () => {
    const changed = updateWorkflow(workflow(), {
      name: 'Approval',
      addContentTypes: ['page', 'news'],
      removeContentTypes: ['page'],
      selfApproval: 'allowed',
      scheduling: true,
    })
    expect(changed.ok && changed.workflow).toMatchObject({
      name: 'Approval',
      appliesTo: { contentTypes: ['news'] },
      selfApproval: 'allowed',
      scheduling: true,
    })
    expect(updateWorkflow(workflow(), { removeBranches: ['x'] })).toMatchObject({ ok: false })
  })

  test('a stage added after the last, between two, and refused when it names nothing', () => {
    const last = addStage(workflow(), { alias: 'final', approvers: ['admin'] })
    expect(last.ok && last.workflow.stages.map((s) => [s.alias, s.next])).toEqual([
      ['review', ['legal']],
      ['legal', ['final']],
      ['final', []],
    ])
    const between = addStage(workflow(), {
      alias: 'copy',
      approvers: ['writer'],
      after: ['review'],
      next: ['legal'],
    })
    expect(between.ok && between.workflow.stages.map((s) => [s.alias, s.next])).toEqual([
      ['review', ['copy']],
      ['legal', []],
      ['copy', ['legal']],
    ])
    expect(addStage(workflow(), { alias: 'review', approvers: ['admin'] })).toMatchObject({
      ok: false,
    })
    expect(addStage(workflow(), { alias: 'x', approvers: [] })).toMatchObject({ ok: false })
    expect(addStage(workflow(), { alias: 'x', approvers: ['a'], after: ['nope'] })).toMatchObject({
      ok: false,
    })
  })

  test('a stage changed, and removed with what came after it passed on', () => {
    const changed = updateStage(workflow(), 'review', {
      addApprovers: ['writer'],
      removeApprovers: ['editor'],
      required: 'majority',
    })
    expect(changed.ok && changed.workflow.stages[0]).toMatchObject({
      approvers: ['writer'],
      required: 'majority',
    })
    expect(updateStage(workflow(), 'review', { removeApprovers: ['editor'] })).toMatchObject({
      ok: false,
    })
    const refused = removeStage(workflow(), 'review')
    expect(!refused.ok && refused.reason).toContain('"legal" sends back to "review"')
    const moved = updateStage(workflow(), 'legal', { sendBack: 'editor' })
    const removed = removeStage(moved.ok ? moved.workflow : workflow(), 'review')
    expect(removed.ok && removed.workflow.stages.map((s) => s.alias)).toEqual(['legal'])
    const one = removeStage(removed.ok ? removed.workflow : workflow(), 'legal')
    expect(one).toMatchObject({ ok: false })
  })
})

describe('the webhook edits', () => {
  test('events, content types and headers added and taken away', () => {
    const changed = updateWebhook(webhook(), {
      addEvents: ['Umbraco.ContentUnpublish'],
      addContentTypes: ['page'],
      setHeaders: { Authorization: 'env:SEARCH_TOKEN' },
      enabled: false,
    })
    expect(changed.ok && changed.webhook).toMatchObject({
      events: ['Umbraco.ContentPublish', 'Umbraco.ContentUnpublish'],
      contentTypeKeys: ['page'],
      headers: { Authorization: 'env:SEARCH_TOKEN' },
      enabled: false,
    })
    const back = updateWebhook(changed.ok ? changed.webhook : webhook(), {
      removeHeaders: ['Authorization'],
      removeContentTypes: ['page'],
    })
    expect(back.ok && back.webhook).toMatchObject({ headers: {}, contentTypeKeys: [] })
    expect(updateWebhook(webhook(), { removeEvents: ['nothing'] })).toMatchObject({ ok: false })
  })

  test('a secret given as a value is refused', () => {
    const refused = updateWebhook(webhook(), { setHeaders: { Authorization: 'Bearer abc' } })
    expect(!refused.ok && refused.reason).toContain('env:NAME')
  })
})

describe('the commands, on a site with a request waiting', () => {
  let site: string
  const env = () => ({
    ...process.env,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_SQLITE_FILE: join(site, 'site.sqlite'),
    CROMBOLO_MEDIA_DIR: join(site, 'media'),
    CROMBOLO_COMPONENTS_DIR: join(site, 'components'),
    CROMBOLO_SCHEMA_DIR: join(site, 'schema'),
    CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
    CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
    CROMBOLO_LOG_TO_CONSOLE: 'false',
  })
  const cli = (...args: string[]) => {
    const proc = Bun.spawnSync(['bun', BIN, ...args], { cwd: site, env: env(), stdin: 'ignore' })
    const stdout = proc.stdout.toString()
    return { code: proc.exitCode, out: stdout + proc.stderr.toString(), stdout }
  }
  const schema = (path: string) => join(site, 'schema', path)
  const runs: Array<{ out: string }> = []
  const run = (...args: string[]) => {
    const result = cli(...args)
    runs.push(result)
    return result
  }

  beforeAll(() => {
    site = mkdtempSync(join(process.cwd(), 'output', 'workflows-webhooks-edit-'))
    const files: Record<string, string> = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\n',
      'schema/content-types/news.toml':
        '[content-type]\nalias = "news"\nname = "News"\nallow-at-root = true\n',
      'schema/content-types/article.toml':
        '[content-type]\nalias = "article"\nname = "Article"\nallow-at-root = true\n',
      'schema/webhooks/searchIndex.toml':
        '[webhook]\nalias = "searchIndex"\nurl = "https://search.example/hook"\nevents = ["Umbraco.ContentPublish"]\n',
      'components/page.tsx': 'export default () => <main />\n',
    }
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(site, path, '..'), { recursive: true })
      writeFileSync(join(site, path), body)
    }
    expect(cli('types', 'sync').code).toBe(0)
    for (const [alias, type] of [
      ['signOff', 'page'],
      ['legalReview', 'news'],
    ] as const) {
      const made = cli('workflows', 'new', alias, '--content-type', type)
      expect(made.code, made.out).toBe(0)
    }
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('listed and shown', () => {
    const listed = run('workflows', 'list', '-o', 'json')
    expect(listed.code, listed.out).toBe(0)
    const items = (JSON.parse(listed.stdout) as { items: Array<{ alias: string }> }).items
    expect(items.map((i) => i.alias)).toEqual(['legalReview', 'signOff'])
    const shown = run('workflows', 'show', 'signOff')
    expect(shown.code, shown.out).toBe(0)
    expect(shown.out).toContain('Stages')
  })

  test('rules changed, idempotently, and a dry run changes nothing', () => {
    const file = schema('workflows/sign-off.toml')
    const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const dry = run('workflows', 'update', 'signOff', '--content-type', 'article', '--dry-run')
    expect(dry.code, dry.out).toBe(0)
    expect(existsSync(file) ? readFileSync(file, 'utf8') : '').toBe(before)
    const covered = run('workflows', 'update', 'signOff', '--content-type', 'news')
    expect(covered.code, covered.out).toBe(ERROR_KINDS.refused.exitCode)
    const changed = run(
      'workflows',
      'update',
      'signOff',
      '--content-type',
      'article',
      '--scheduling',
    )
    expect(changed.code, changed.out).toBe(0)
    const shown = JSON.parse(
      run('workflows', 'show', 'signOff', '-o', 'json').stdout,
    ) as SchemaWorkflow
    expect(shown.appliesTo.contentTypes).toEqual(['page', 'article'])
    expect(shown.scheduling).toBe(true)
    const again = run('workflows', 'update', 'signOff', '--content-type', 'article', '--scheduling')
    expect(again.code).toBe(0)
    expect(again.out).toContain('nothing to change')
  })

  test('stages added, changed and removed; an unknown group or a send-back off its path refused', () => {
    const added = run('workflows', 'stage', 'add', 'signOff', 'legal', '--approver', 'admin')
    expect(added.code, added.out).toBe(0)
    const unknown = run('workflows', 'stage', 'add', 'signOff', 'x', '--approver', 'nobody')
    expect(unknown.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(unknown.out).toContain('"nobody"')
    const stages = () =>
      (JSON.parse(run('workflows', 'show', 'signOff', '-o', 'json').stdout) as SchemaWorkflow)
        .stages
    const first = stages()[0]?.alias as string
    const offPath = run('workflows', 'stage', 'update', 'signOff', first, '--send-back', 'legal')
    expect(offPath.code, offPath.out).toBe(ERROR_KINDS.refused.exitCode)
    const changed = run(
      'workflows',
      'stage',
      'update',
      'signOff',
      'legal',
      '--add-approver',
      'editor',
      '--required',
      'majority',
    )
    expect(changed.code, changed.out).toBe(0)
    expect(stages().find((s) => s.alias === 'legal')).toMatchObject({
      approvers: ['admin', 'editor'],
      required: 'majority',
    })
    const removed = run('workflows', 'stage', 'remove', 'signOff', 'legal')
    expect(removed.code, removed.out).toBe(0)
    expect(stages().map((s) => s.alias)).toEqual([first])
  })

  test('removed with a request open: the request is withdrawn, and how many is said', async () => {
    const shown = JSON.parse(
      cli('workflows', 'show', 'legalReview', '-o', 'json').stdout,
    ) as SchemaWorkflow
    const db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
    const request = await new ApprovalRepository(db).create({
      nodeKey: crypto.randomUUID(),
      cultures: null,
      action: 'publish',
      eventId: null,
      workflow: shown,
      workflowVersion: '1',
      requestedBy: crypto.randomUUID(),
    })
    await db.close()
    const removed = run('workflows', 'remove', 'legalReview')
    expect(removed.code, removed.out).toBe(0)
    expect(removed.out).toContain('1 request(s) waiting on it are withdrawn')
    expect(cli('workflows', 'show', 'legalReview').code).toBe(ERROR_KINDS.not_found.exitCode)
    const after = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
    expect((await new ApprovalRepository(after).byKey(request.key))?.state).not.toBe('waiting')
    await after.close()
  })

  test('a webhook changed; a secret as a value refused; idempotent; removed', () => {
    const file = schema('webhooks/searchIndex.toml')
    const changed = run(
      'webhooks',
      'update',
      'searchIndex',
      '--event',
      'Umbraco.ContentUnpublish',
      '--content-type',
      'page',
      '--header',
      'Authorization=env:SEARCH_TOKEN',
      '--no-enabled',
    )
    expect(changed.code, changed.out).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(
      [
        '[webhook]',
        'alias = "searchIndex"',
        'url = "https://search.example/hook"',
        'enabled = false',
        'events = ["Umbraco.ContentPublish", "Umbraco.ContentUnpublish"]',
        'content-types = ["page"]',
        '',
        '[webhook.headers]',
        'Authorization = "env:SEARCH_TOKEN"',
        '',
      ].join('\n'),
    )
    const again = run('webhooks', 'update', 'searchIndex', '--event', 'Umbraco.ContentUnpublish')
    expect(again.out).toContain('nothing to change')
    const secret = run('webhooks', 'update', 'searchIndex', '--header', 'X-Key=abc123')
    expect(secret.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(secret.out).toContain('env:NAME')
    expect(readFileSync(file, 'utf8')).not.toContain('abc123')
    const badType = run('webhooks', 'update', 'searchIndex', '--content-type', 'nothing')
    expect(badType.code).toBe(ERROR_KINDS.refused.exitCode)
    const listed = JSON.parse(run('webhooks', 'list', '-o', 'json').stdout) as {
      items: Array<{ alias: string; withTheSite: boolean }>
    }
    expect(listed.items).toEqual([
      expect.objectContaining({ alias: 'searchIndex', withTheSite: true }),
    ])
    const removed = run('webhooks', 'remove', 'searchIndex')
    expect(removed.code, removed.out).toBe(0)
    expect(existsSync(file)).toBe(false)
    expect(cli('webhooks', 'show', 'searchIndex').code).toBe(ERROR_KINDS.not_found.exitCode)
  })

  test('a webhook kept in the database is listed, and changed in the back office', async () => {
    const db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
    const { WebhookRepository } = await import('@crombolo/data')
    await new WebhookRepository(db).save({
      key: crypto.randomUUID(),
      name: 'Stored hook',
      description: null,
      url: 'https://stored.example/hook',
      enabled: true,
      events: ['Umbraco.ContentPublish'],
      contentTypeKeys: [],
      sealedHeaders: null,
    })
    await db.close()
    const listed = run('webhooks', 'list')
    expect(listed.out).toContain('change it in the back office')
    const refused = run('webhooks', 'update', 'storedHook', '--no-enabled')
    expect(refused.code, refused.out).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.out).toContain('back office')
  })

  test('no output names a file', () => {
    expect(runs.length).toBeGreaterThan(10)
    // The last line for scripts carries each problem's file, for tools (story 252)
    for (const { out } of runs)
      expect(out.replace(/^\{"error".*$/m, '')).not.toMatch(/\.toml|schema\//i)
  })
})

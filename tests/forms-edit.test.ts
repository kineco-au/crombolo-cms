/**
 * Story 251: forms changed from the command line. The pure edits on their own,
 * then `forms list|show|update|remove` and the field, page, fieldset and workflow
 * commands through the CLI on a SQLite site with a page whose form picker names
 * one form.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SchemaForm } from '@crombolo/core'
import {
  addFormField,
  addFormGroup,
  addFormPage,
  addFormWorkflow,
  fileNameFor,
  formConditionFrom,
  moveFormField,
  moveFormPage,
  newForm,
  parseForm,
  removeFormField,
  removeFormGroup,
  removeFormPage,
  removeFormWorkflow,
  updateForm,
  updateFormField,
  updateFormGroup,
  updateFormWorkflow,
  writeForm,
} from '@crombolo/schema'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const aliases = (form: SchemaForm) =>
  form.pages.map((page) => page.groups.map((group) => group.fields.map((field) => field.alias)))
const ok = (result: { ok: true; form: SchemaForm } | { ok: false; reason: string }) => {
  if (!result.ok) throw new Error(result.reason)
  return result.form
}

describe('the form edits', () => {
  test('a form’s settings, and ones taken away', () => {
    const form = ok(
      updateForm(newForm('contact'), {
        name: 'Get in touch',
        messageOnSubmit: 'Thanks',
        maxEntries: 10,
        redirectTo: 'k-1',
      }),
    )
    expect(form).toMatchObject({
      name: 'Get in touch',
      messageOnSubmit: 'Thanks',
      maxEntries: 10,
      redirectTo: 'k-1',
    })
    const cleared = ok(updateForm(form, { messageOnSubmit: '', maxEntries: 0, redirectTo: null }))
    expect(cleared.messageOnSubmit).toBeUndefined()
    expect(cleared.maxEntries).toBeUndefined()
    expect(cleared.redirectTo).toBeUndefined()
  })

  test('fields added at the end or beside another, moved, changed and removed', () => {
    let form = ok(addFormField(newForm('contact'), 'message', 'longAnswer', { mandatory: true }))
    expect(aliases(form)).toEqual([[['name', 'email', 'message']]])
    const added = form.pages[0]?.groups[0]?.fields[2]
    expect(added).toMatchObject({ caption: 'Message', mandatory: true, type: 'longAnswer' })
    form = ok(
      addFormField(form, 'topic', 'dropdown', { values: ['Sales', 'Support'] }, { after: 'email' }),
    )
    expect(aliases(form)).toEqual([[['name', 'email', 'topic', 'message']]])
    form = ok(moveFormField(form, 'message', { before: 'name' }))
    expect(aliases(form)).toEqual([[['message', 'name', 'email', 'topic']]])
    form = ok(updateFormField(form, 'message', { caption: 'Your message', mandatory: false }))
    expect(form.pages[0]?.groups[0]?.fields[0]).toMatchObject({
      caption: 'Your message',
      mandatory: false,
    })
    expect(addFormField(form, 'email', 'email')).toMatchObject({ ok: false })
    expect(updateFormField(form, 'nothing', {})).toMatchObject({ ok: false })
    expect(moveFormField(form, 'email', { after: 'email' })).toMatchObject({ ok: false })
    form = ok(removeFormField(form, 'message'))
    expect(aliases(form)).toEqual([[['name', 'email', 'topic']]])
  })

  test('a condition, and a field it names is not removed', () => {
    const condition = formConditionFrom(['topic=Sales', 'email!=x@y.z'], 'all')
    expect(condition).toEqual({
      action: 'show',
      match: 'all',
      rules: [
        { field: 'topic', operator: 'is', value: 'Sales' },
        { field: 'email', operator: 'isNot', value: 'x@y.z' },
      ],
    })
    expect(typeof formConditionFrom(['topic'], 'all')).toBe('string')
    let form = ok(addFormField(newForm('contact'), 'topic', 'dropdown', { values: ['Sales'] }))
    form = ok(addFormField(form, 'company', 'shortAnswer', { condition: condition as never }))
    const refused = removeFormField(form, 'topic')
    expect(refused).toMatchObject({ ok: false })
    form = ok(updateFormField(form, 'company', { condition: null }))
    expect(
      form.pages[0]?.groups[0]?.fields.find((f) => f.alias === 'company')?.condition,
    ).toBeUndefined()
  })

  test('pages and fieldsets: added, moved, and removed only once their fields have somewhere to go', () => {
    let form = ok(addFormPage(newForm('contact'), { caption: 'About you' }))
    expect(form.pages.map((p) => p.caption)).toEqual([undefined, 'About you'])
    form = ok(addFormField(form, 'company', 'shortAnswer', {}, { page: 'About you' }))
    expect(aliases(form)).toEqual([[['name', 'email']], [['company']]])
    form = ok(moveFormPage(form, 'about you', { before: '1' }))
    expect(aliases(form)).toEqual([[['company']], [['name', 'email']]])
    expect(removeFormPage(form, '1')).toMatchObject({ ok: false })
    form = ok(removeFormPage(form, '1', '2'))
    expect(aliases(form)).toEqual([[['name', 'email', 'company']]])
    expect(removeFormPage(form, '1')).toMatchObject({ ok: false })

    form = ok(addFormGroup(form, '1', { caption: 'Address', columns: 2 }))
    expect(form.pages[0]?.groups.map((g) => g.columns)).toEqual([1, 2])
    form = ok(updateFormGroup(form, '1', 'Address', { caption: 'Where' }))
    expect(updateFormGroup(form, '1', 'Where', { columns: 0 })).toMatchObject({ ok: false })
    form = ok(moveFormField(form, 'company', { page: '1', group: 'Where' }))
    expect(removeFormGroup(form, '1', 'Where')).toMatchObject({ ok: false })
    form = ok(removeFormGroup(form, '1', 'Where', '1'))
    expect(aliases(form)).toEqual([[['name', 'email', 'company']]])
  })

  test('workflows: added by name, their settings merged and taken away, removed', () => {
    let form = ok(
      addFormWorkflow(newForm('contact'), 'sendEmail', 'Tell the team', {
        settings: { to: 'a@example.com', subject: 'New' },
      }),
    )
    expect(form.workflows).toEqual([
      {
        type: 'sendEmail',
        name: 'Tell the team',
        on: 'submit',
        settings: { to: 'a@example.com', subject: 'New' },
      },
    ])
    expect(addFormWorkflow(form, 'sendToUrl', 'tell the TEAM')).toMatchObject({ ok: false })
    form = ok(
      updateFormWorkflow(form, 'tell the team', {
        settings: { cc: 'b@example.com' },
        unset: ['subject'],
      }),
    )
    expect(form.workflows[0]?.settings).toEqual({ to: 'a@example.com', cc: 'b@example.com' })
    expect(updateFormWorkflow(form, 'Tell the team', { unset: ['nothing'] })).toMatchObject({
      ok: false,
    })
    form = ok(removeFormWorkflow(form, 'Tell the team'))
    expect(form.workflows).toEqual([])
    expect(removeFormWorkflow(form, 'Tell the team')).toMatchObject({ ok: false })
  })
})

describe('the commands, on a site with a page using a form', () => {
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
    return {
      code: proc.exitCode,
      stdout: proc.stdout.toString(),
      out: proc.stdout.toString() + proc.stderr.toString(),
    }
  }
  const file = (alias: string) =>
    readFileSync(join(site, 'schema', 'forms', fileNameFor(alias)), 'utf8')
  const form = (alias: string) => parseForm(alias, file(alias)).value as SchemaForm
  const outputs: string[] = []
  const run = (...args: string[]) => {
    const result = cli(...args)
    outputs.push(result.out)
    return result
  }

  beforeAll(() => {
    site = mkdtempSync(join(process.cwd(), 'output', 'forms-edit-'))
    const files: Record<string, string> = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\nallow-children = ["page"]\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "form"\nname = "Form"\ntype = "formPicker"\n',
      [`schema/forms/${fileNameFor('contact')}`]: writeForm(newForm('contact', 'Contact')),
      [`schema/forms/${fileNameFor('survey')}`]: writeForm(newForm('survey', 'Survey')),
      'components/page.tsx': 'export default () => <main />\n',
      'content/pages/home.toml': 'type = "page"\nname = "Home"\n\n[values]\nform = "contact"\n',
      'content/pages/home/thanks.toml': 'type = "page"\nname = "Thanks"\n',
    }
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(site, path, '..'), { recursive: true })
      writeFileSync(join(site, path), body)
    }
    expect(cli('types', 'sync').code).toBe(0)
    const applied = cli('site', 'apply')
    expect(applied.code, applied.out).toBe(0)
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('forms list and show say what uses each form', () => {
    const list = JSON.parse(run('forms', 'list', '-o', 'json').stdout) as {
      items: Array<{ alias: string; fields: number; pages: number | null }>
    }
    expect(list.items).toEqual([
      expect.objectContaining({ alias: 'contact', fields: 2, pages: 1, libraryForms: 0 }),
      expect.objectContaining({ alias: 'survey', fields: 2, pages: 0 }),
    ])
    const shown = run('forms', 'show', 'contact')
    expect(shown.code, shown.out).toBe(0)
    expect(shown.out).toContain('Used by 1 page(s)')
    expect(run('forms', 'show', 'nothing').code).toBe(ERROR_KINDS.not_found.exitCode)
  }, 60_000)

  test('a form’s settings, with a page to go to by its path', () => {
    const changed = run(
      'forms',
      'update',
      'contact',
      '--message',
      'Thanks',
      '--redirect-to',
      '/Home/Thanks',
    )
    expect(changed.code, changed.out).toBe(0)
    expect(form('contact')).toMatchObject({ messageOnSubmit: 'Thanks' })
    expect(form('contact').redirectTo).toBeString()
    expect(run('forms', 'update', 'contact', '--message', 'Thanks').out).toContain(
      'nothing to change',
    )
    expect(run('forms', 'update', 'contact', '--redirect-to', 'none').code).toBe(0)
    expect(form('contact').redirectTo).toBeUndefined()
  }, 60_000)

  test('fields added, changed, moved and removed; what is written is the form as written', () => {
    expect(
      run(
        'forms',
        'field',
        'add',
        'contact',
        'topic',
        '--type',
        'dropdown',
        '--option',
        'Sales',
        '--option',
        'Support',
        '--after',
        'name',
      ).code,
    ).toBe(0)
    const shown = run(
      'forms',
      'field',
      'add',
      'contact',
      'company',
      '--type',
      'shortAnswer',
      '--show-when',
      'topic=Sales',
    )
    expect(shown.code, shown.out).toBe(0)
    expect(aliases(form('contact'))).toEqual([[['name', 'topic', 'email', 'company']]])
    expect(file('contact')).toBe(writeForm(form('contact')))
    expect(
      run(
        'forms',
        'field',
        'update',
        'contact',
        'company',
        '--caption',
        'Your company',
        '--mandatory',
      ).code,
    ).toBe(0)
    expect(form('contact').pages[0]?.groups[0]?.fields[3]).toMatchObject({
      caption: 'Your company',
      mandatory: true,
    })
    const early = run('forms', 'field', 'move', 'contact', 'company', '--before', 'topic')
    expect(early.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(run('forms', 'field', 'move', 'contact', 'email', '--before', 'name').code).toBe(0)
    expect(aliases(form('contact'))).toEqual([[['email', 'name', 'topic', 'company']]])

    const named = run('forms', 'field', 'remove', 'contact', 'topic')
    expect(named.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(named.out).toContain('company')
    expect(run('forms', 'field', 'update', 'contact', 'nothing', '--caption', 'x').code).toBe(
      ERROR_KINDS.refused.exitCode,
    )
    expect(run('forms', 'field', 'add', 'contact', 'x', '--type', 'notAType').code).toBe(
      ERROR_KINDS.refused.exitCode,
    )

    const before = file('contact')
    expect(run('forms', 'field', 'remove', 'contact', 'company', '--dry-run').code).toBe(0)
    expect(file('contact')).toBe(before)
    expect(run('forms', 'field', 'remove', 'contact', 'company').code).toBe(0)
    expect(aliases(form('contact'))).toEqual([[['email', 'name', 'topic']]])
  }, 60_000)

  test('pages and fieldsets, and a page with fields is not removed without somewhere for them', () => {
    expect(run('forms', 'page', 'add', 'survey', '--caption', 'More').code).toBe(0)
    expect(run('forms', 'field', 'move', 'survey', 'email', '--page', 'More').code).toBe(0)
    const refused = run('forms', 'page', 'remove', 'survey', 'More')
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.out).toContain('email')
    expect(run('forms', 'page', 'update', 'survey', 'More', '--caption', 'Extra').code).toBe(0)
    expect(run('forms', 'page', 'move', 'survey', 'Extra', '--before', '1').code).toBe(0)
    expect(run('forms', 'page', 'remove', 'survey', 'Extra', '--move-fields-to', '2').code).toBe(0)
    expect(aliases(form('survey'))).toEqual([[['name', 'email']]])

    expect(
      run('forms', 'group', 'add', 'survey', '--caption', 'Address', '--columns', '2').code,
    ).toBe(0)
    expect(run('forms', 'group', 'update', 'survey', 'Address', '--caption', 'Where').code).toBe(0)
    expect(run('forms', 'group', 'move', 'survey', 'Where', '--before', '1').code).toBe(0)
    expect(form('survey').pages[0]?.groups.map((g) => g.caption)).toEqual(['Where', undefined])
    expect(run('forms', 'group', 'remove', 'survey', 'Where').code).toBe(0)
    expect(run('forms', 'group', 'remove', 'survey', '1').code).toBe(ERROR_KINDS.refused.exitCode)
  }, 60_000)

  test('workflows, with their settings stored as given', () => {
    const added = run(
      'forms',
      'workflow',
      'add',
      'contact',
      '--type',
      'sendEmail',
      '--name',
      'Tell the team',
      '--to',
      'a@example.com',
      '--to',
      'b@example.com',
      '--subject',
      'New enquiry',
    )
    expect(added.code, added.out).toBe(0)
    expect(form('contact').workflows[0]).toMatchObject({
      type: 'sendEmail',
      settings: { to: 'a@example.com, b@example.com', subject: 'New enquiry' },
    })
    expect(
      run(
        'forms',
        'workflow',
        'update',
        'contact',
        'Tell the team',
        '--set',
        'attach-uploads=false',
      ).code,
    ).toBe(0)
    expect(form('contact').workflows[0]?.settings['attach-uploads']).toBe(false)
    const wrong = run(
      'forms',
      'workflow',
      'update',
      'contact',
      'Tell the team',
      '--set',
      'notASetting=1',
    )
    expect(wrong.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(form('contact').workflows[0]?.settings.notASetting).toBeUndefined()
    expect(
      run('forms', 'workflow', 'update', 'contact', 'Tell the team', '--unset', 'attach-uploads')
        .code,
    ).toBe(0)
    expect(run('forms', 'workflow', 'remove', 'contact', 'Tell the team').code).toBe(0)
    expect(form('contact').workflows).toEqual([])
  }, 60_000)

  test('a form a page uses is not removed; one nothing uses is, and nothing names a file', () => {
    const used = run('forms', 'remove', 'contact')
    expect(used.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(used.out).toContain('1 page(s)')
    expect(run('forms', 'remove', 'survey').code).toBe(0)
    expect(run('forms', 'show', 'survey').code).toBe(ERROR_KINDS.not_found.exitCode)
    // The last line for scripts carries each problem's file, for tools (story 252)
    for (const out of outputs)
      expect(out.replace(/^\{"error".*$/m, '')).not.toMatch(/\.toml|schema\//i)
  }, 60_000)
})

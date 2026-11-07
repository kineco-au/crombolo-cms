/**
 * Story 289: forms and workflows in folders. A folder is a real subfolder of
 * `schema/`, so it travels with the code. A form in one still loads, saves where
 * it is and deletes from there, and two files claiming an alias are named.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadSchemaDirectory } from '@crombolo/schema'
import {
  buildBundleFromDirectory,
  createFolder,
  deleteFolder,
  deleteForm,
  folderOf,
  folderPath,
  foldersIn,
  moveDefinition,
  renameFolder,
  saveForm,
} from '@crombolo/server'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const FORM = (alias: string) => `[form]
alias = "${alias}"
name = "${alias}"

[[page]]
[[page.group]]
[[page.group.field]]
alias = "email"
type = "shortAnswer"
caption = "Email"
`

function site(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'definition-folders-'))
  dirs.push(root)
  const schemaDir = join(root, 'schema')
  mkdirSync(schemaDir)
  writeFileSync(join(schemaDir, 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(schemaDir, path)), { recursive: true })
    writeFileSync(join(schemaDir, path), text)
  }
  return { schemaDir, options: { schemaDir, writable: true } }
}

describe('a folder name', () => {
  test('is a path of plain names, and nothing that climbs', () => {
    expect(folderPath('Contact')).toBe('Contact')
    expect(folderPath('Contact/Sales team')).toBe('Contact/Sales team')
    expect(folderPath('')).toBe('')
    for (const bad of ['..', 'a/..', '/a', 'a/', '.hidden', 'a\\b', 12]) {
      expect(folderPath(bad), String(bad)).toBeUndefined()
    }
  })
})

describe('forms in folders', () => {
  test('load from any depth, and know their folder', () => {
    const { schemaDir } = site({
      'forms/top.toml': FORM('top'),
      'forms/contact/sales/deep.toml': FORM('deep'),
    })
    const loaded = loadSchemaDirectory(schemaDir)
    expect(loaded.problems).toEqual([])
    expect(loaded.set.forms?.map((form) => form.alias).sort()).toEqual(['deep', 'top'])
    expect(folderOf(schemaDir, 'forms', loaded.files.get('form:deep') as string)).toBe(
      'contact/sales',
    )
    expect(folderOf(schemaDir, 'forms', loaded.files.get('form:top') as string)).toBe('')
  })

  test('two files with one alias are both named', () => {
    const { schemaDir } = site({
      'forms/a/same.toml': FORM('same'),
      'forms/b/same.toml': FORM('same'),
    })
    const messages = loadSchemaDirectory(schemaDir).problems.map((p) => `${p.file} ${p.message}`)
    expect(messages.join()).toContain('schema/forms/a/same.toml')
    expect(messages.join()).toContain('schema/forms/b/same.toml')
  })

  test('a saved form stays in its folder, with no second copy', async () => {
    const { schemaDir, options } = site({ 'forms/contact/enquiry.toml': FORM('enquiry') })
    const form = loadSchemaDirectory(schemaDir).set.forms?.[0]
    if (!form) throw new Error('no form')
    const saved = await saveForm({ ...form, name: 'Changed' }, options)
    expect(saved.ok).toBe(true)
    expect(existsSync(join(schemaDir, 'forms', 'enquiry.toml'))).toBe(false)
    expect(loadSchemaDirectory(schemaDir).set.forms?.[0]?.name).toBe('Changed')
  })

  test('a new form goes in the folder it was made in', async () => {
    const { schemaDir, options } = site({ 'forms/contact/enquiry.toml': FORM('enquiry') })
    const form = loadSchemaDirectory(schemaDir).set.forms?.[0]
    if (!form) throw new Error('no form')
    const { key: _key, ...rest } = form
    await saveForm({ ...rest, alias: 'other' }, { ...options, folder: 'sales' })
    expect(existsSync(join(schemaDir, 'forms', 'sales', 'other.toml'))).toBe(true)
  })

  test('deleting takes the file from its folder', async () => {
    const { schemaDir, options } = site({ 'forms/contact/enquiry.toml': FORM('enquiry') })
    expect((await deleteForm('enquiry', options)).ok).toBe(true)
    expect(existsSync(join(schemaDir, 'forms', 'contact', 'enquiry.toml'))).toBe(false)
  })
})

describe('a bundle', () => {
  test('carries a form in its folder, and a site that installs it finds it there', async () => {
    const { schemaDir } = site({ 'forms/contact/enquiry.toml': FORM('enquiry') })
    const built = await buildBundleFromDirectory(dirname(schemaDir))
    expect(built.problems).toEqual([])
    const paths = built.files?.map((file) => file.path) ?? []
    expect(paths).toContain('schema/forms/contact/enquiry.toml')
  })
})

describe('managing folders', () => {
  test('makes, lists, renames and moves', async () => {
    const { schemaDir, options } = site({ 'forms/enquiry.toml': FORM('enquiry') })
    expect(await createFolder('forms', 'Contact/Sales', options)).toMatchObject({ ok: true })
    expect(foldersIn(schemaDir, 'forms')).toEqual(['Contact', 'Contact/Sales'])
    const file = join(schemaDir, 'forms', 'enquiry.toml')
    expect(await moveDefinition('forms', file, 'Contact/Sales', options)).toMatchObject({
      ok: true,
    })
    expect(existsSync(join(schemaDir, 'forms', 'Contact', 'Sales', 'enquiry.toml'))).toBe(true)
    expect(await renameFolder('forms', 'Contact', 'People', options)).toMatchObject({ ok: true })
    expect(existsSync(join(schemaDir, 'forms', 'People', 'Sales', 'enquiry.toml'))).toBe(true)
  })

  test('refuses a non-empty delete, a clash and a folder inside itself', async () => {
    const { options } = site({ 'forms/a/one.toml': FORM('one') })
    await createFolder('forms', 'b', options)
    expect(await deleteFolder('forms', 'a', options)).toMatchObject({ status: 'conflict' })
    expect(await createFolder('forms', 'a', options)).toMatchObject({ status: 'conflict' })
    expect(await renameFolder('forms', 'a', 'b', options)).toMatchObject({ status: 'conflict' })
    expect(await renameFolder('forms', 'a', 'a/c', options)).toMatchObject({ status: 'invalid' })
    expect(await deleteFolder('forms', 'b', options)).toMatchObject({ ok: true })
  })

  test('a read-only site changes nothing', async () => {
    const { schemaDir } = site({ 'forms/one.toml': FORM('one') })
    const options = { schemaDir, writable: false }
    expect(await createFolder('forms', 'a', options)).toMatchObject({ status: 'readOnly' })
    expect(foldersIn(schemaDir, 'forms')).toEqual([])
  })
})

/**
 * Story 344: a back-office save that would leave the schema files invalid is
 * refused before anything is kept, rather than saved to the database with its
 * file quietly left behind.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository } from '@crombolo/data'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

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

const QUOTE = `[content-type]
alias = "quote"
name = "Quote"
is-element = true
`

const BLOCKS = `[data-type]
alias = "quoteBlocks"
name = "Quote Blocks"
editor = "Umbraco.BlockList"
editor-ui = "Umb.PropertyEditorUi.BlockList"

[[data-type.block]]
element = "quote"
`

/** A site whose block list offers the element type `quote`, its files writable. */
async function site() {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const schemaDir = mkdtempSync(join(process.cwd(), 'output', 'schema-save-'))
  dirs.push(schemaDir)
  for (const dir of ['content-types', 'data-types']) mkdirSync(join(schemaDir, dir))
  writeFileSync(join(schemaDir, 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(schemaDir, 'content-types', 'quote.toml'), QUOTE)
  writeFileSync(join(schemaDir, 'data-types', 'quote-blocks.toml'), BLOCKS)
  const h = await signedInServer({ config: { schemaDir, schemaWritable: true } })
  open.push(h)
  const quote = await new ContentTypeRepository(h.server.db).byAlias('quote')
  if (!quote) throw new Error('the quote type did not sync')
  return { h, schemaDir, key: quote.key }
}

describe('a save that would leave the schema files invalid (story 344)', () => {
  test('is refused, saying why, and neither the database nor the files change', async () => {
    const { h, schemaDir, key } = await site()
    const before = {
      type: readFileSync(join(schemaDir, 'content-types', 'quote.toml'), 'utf8'),
      version: readFileSync(join(schemaDir, 'schema.toml'), 'utf8'),
    }
    const read = await h.json<Record<string, unknown>>(`${V1}/document-type/${key}`)

    // The block list offers it, so it can't stop being an element type.
    const response = await h.put(`${V1}/document-type/${key}`, { ...read, isElement: false })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { detail: string }).detail).toContain(
      '"quote" is not an element type',
    )

    expect((await new ContentTypeRepository(h.server.db).byKey(key))?.isElement).toBe(true)
    expect(readFileSync(join(schemaDir, 'content-types', 'quote.toml'), 'utf8')).toBe(before.type)
    // The version moves only for a save that is kept.
    expect(readFileSync(join(schemaDir, 'schema.toml'), 'utf8')).toBe(before.version)
  })

  test('a save that keeps the schema valid is written to the database and the file alike', async () => {
    const { h, schemaDir, key } = await site()
    const read = await h.json<Record<string, unknown>>(`${V1}/document-type/${key}`)
    const response = await h.put(`${V1}/document-type/${key}`, { ...read, name: 'Pull quote' })
    expect(response.status).toBe(200)
    expect((await new ContentTypeRepository(h.server.db).byKey(key))?.name).toBe('Pull quote')
    expect(readFileSync(join(schemaDir, 'content-types', 'quote.toml'), 'utf8')).toContain(
      'name = "Pull quote"',
    )
  })

  test('a data type naming a type that is not an element is refused the same way', async () => {
    const { h } = await site()
    const page = await h.post(`${V1}/document-type`, {
      alias: 'page',
      name: 'Page',
      icon: 'icon-document',
      allowedAsRoot: true,
      isElement: false,
      variesByCulture: false,
      variesBySegment: false,
      containers: [],
      properties: [],
      allowedDocumentTypes: [],
      compositions: [],
      allowedTemplates: [],
      cleanup: { preventCleanup: false },
    })
    const pageKey = page.headers.get('umb-generated-resource') as string
    const response = await h.post(`${V1}/data-type`, {
      name: 'Page Blocks',
      editorAlias: 'Umbraco.BlockList',
      editorUiAlias: 'Umb.PropertyEditorUi.BlockList',
      values: [{ alias: 'blocks', value: [{ contentElementTypeKey: pageKey }] }],
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { title: string }).title).toBe('The data type was not saved')
  })
})

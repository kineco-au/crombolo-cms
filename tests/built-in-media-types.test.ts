/**
 * Umbraco's seven built-in media types. Folder, Image and File are system
 * types: shipped with the framework, ensured at every boot, not deletable,
 * alias fixed. Video, Audio, Article and Vector Graphics are site files that
 * `crombolo init` scaffolds; Folder allows whichever of them a site has.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MEDIA_CACHE_FIELDS_TYPE_KEY, SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import {
  BUILT_IN_MEDIA_TYPES,
  ContentTypeRepository,
  ensureBuiltInDataTypes,
  ensureSystemMediaTypes,
} from '@crombolo/data'
import {
  exportSchemaSet,
  loadSchemaDirectory,
  parseMediaType,
  siteMediaTypeFiles,
  typeKeyFor,
  validateSchemaSet,
} from '@crombolo/schema'
import { installDatabase, loadConfig, syncSchemaDirectory } from '@crombolo/server'
import { freshDb } from './support/db.ts'
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

const SYSTEM = SYSTEM_MEDIA_TYPE_KEYS
const VIDEO = BUILT_IN_MEDIA_TYPES.find((t) => t.alias === 'umbracoMediaVideo')?.key as string

/** A site as `crombolo init` would leave it, optionally without the four site-owned files. */
async function site(options: { withSiteMediaTypes?: boolean } = {}) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'built-in-media-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'media-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  if (options.withSiteMediaTypes ?? true)
    for (const [path, content] of Object.entries(siteMediaTypeFiles()))
      writeFileSync(join(root, path), content)
  const h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components') },
  })
  open.push(h)
  return { h, schemaDir: join(root, 'schema') }
}

type MediaTypeResponse = {
  id: string
  alias: string
  name: string
  icon: string
  collection: { id: string } | null
  isDeletable: boolean
  aliasCanBeChanged: boolean
  allowedMediaTypes: Array<{ mediaType: { id: string } }>
  containers: Array<{ id: string; name: string; alias: string; type: string; parent: unknown }>
  properties: Array<{
    id: string
    alias: string
    name: string
    dataType: { id: string }
    container: { id: string } | null
    validation: { mandatory: boolean }
  }>
}

describe('built-in media types', () => {
  test("the system types are Umbraco's, key for key, and cannot be deleted or renamed", async () => {
    const { h } = await site()
    const image = await h.json<MediaTypeResponse>(`${V1}/media-type/${SYSTEM.Image}`)
    expect(image).toMatchObject({
      alias: 'Image',
      name: 'Image',
      icon: 'icon-picture',
      isDeletable: false,
      aliasCanBeChanged: false,
    })
    expect(image.containers).toEqual([
      expect.objectContaining({
        id: '79ed4d07-254a-42cf-8fa9-ebe1c116a596',
        name: 'Image',
        type: 'Group',
        parent: null,
      }),
    ])
    expect(image.properties.map((p) => [p.id, p.alias, p.name, p.validation.mandatory])).toEqual([
      ['b646ca8f-e469-4fc2-a48a-d4dc1aa64a53', 'umbracoFile', 'Image', true],
      ['a68d453b-1f62-44f4-9f71-0b6bbd43c355', 'umbracoWidth', 'Width', false],
      ['854087f6-648b-40ed-bc98-b8a9789e80b9', 'umbracoHeight', 'Height', false],
      ['bd4c5ace-26e3-4a8b-af1a-e8206a35fa07', 'umbracoBytes', 'File size', false],
      ['f7786fe8-724a-4ed0-b244-72546db32a92', 'umbracoExtension', 'File extension', false],
    ])
    expect(image.properties[0]?.dataType.id).toBe('1df9f033-e6d4-451f-b8d2-e0cbc50a836f')
    expect(image.properties[1]?.dataType.id).toBe('5eb57825-e15e-4fc7-8e37-fca65cdafbde')
    const pixels = await h.json<{ name: string; values: Array<{ alias: string; value: unknown }> }>(
      `${V1}/data-type/5eb57825-e15e-4fc7-8e37-fca65cdafbde`,
    )
    expect(pixels.name).toBe('Label (pixels)')
    expect(pixels.values).toContainEqual({ alias: 'labelTemplate', value: '{=value}px' })

    const folder = await h.json<MediaTypeResponse>(`${V1}/media-type/${SYSTEM.Folder}`)
    expect(folder).toMatchObject({
      alias: 'Folder',
      icon: 'icon-folder',
      collection: { id: '3a0156c4-3b8c-4803-bdc1-6871faa83fff' },
    })
    expect(folder.properties).toEqual([])
    expect(
      (await h.json<MediaTypeResponse>(`${V1}/media-type/${SYSTEM.File}`)).properties[0]?.dataType
        .id,
    ).toBe('84c6b441-31df-4ffe-b67e-67d5bc3ae65a')

    const refused = await h.del(`${V1}/media-type/${SYSTEM.Image}`)
    expect(refused.status).toBe(400)
    expect((await refused.json()).title).toBe('System media types cannot be deleted')
    const renamed = await h.put(`${V1}/media-type/${SYSTEM.File}`, {
      ...folder,
      alias: 'Attachment',
      allowedMediaTypes: [],
    })
    expect(renamed.status).toBe(400)

    const tree = await h.json<{ items: Array<{ id: string; isDeletable: boolean }> }>(
      `${V1}/tree/media-type/root?skip=0&take=20`,
    )
    const byId = new Map(tree.items.map((i) => [i.id, i.isDeletable]))
    expect(byId.get(SYSTEM.Folder)).toBe(false)
    expect(byId.get(VIDEO)).toBe(true)
  })

  test('the four site types come from files, and Folder allows all seven', async () => {
    const { h, schemaDir } = await site()
    const video = await h.json<MediaTypeResponse>(`${V1}/media-type/${VIDEO}`)
    expect(video).toMatchObject({
      alias: 'umbracoMediaVideo',
      name: 'Video',
      icon: 'icon-video',
      isDeletable: true,
    })
    // The group kept Umbraco's key, though the file carries none
    expect(video.containers.map((c) => [c.id, c.name, c.type])).toEqual([
      ['2f0a61b6-cf92-4ff4-b437-751ab35eb254', 'Video', 'Group'],
    ])
    expect(video.properties[0]?.dataType.id).toBe('70575fe7-9812-4396-bbe1-c81a76db71b5')

    const folder = await h.json<MediaTypeResponse>(`${V1}/media-type/${SYSTEM.Folder}`)
    // Every built-in a folder can hold; "Caching" is only ever composed (story 057).
    expect(folder.allowedMediaTypes.map((a) => a.mediaType.id).sort()).toEqual(
      BUILT_IN_MEDIA_TYPES.filter((t) => !t.composition)
        .map((t) => t.key)
        .sort(),
    )

    // The file is a top-level group, round-trips, and the site can delete the type
    const file = join(schemaDir, 'media-types', 'umbraco-media-video.toml')
    const source = readFileSync(file, 'utf8')
    expect(source).toContain('[[group]]\nname = "Video"\nalias = "video"')
    expect(source).toContain('[[group.property]]')
    expect(parseMediaType('video', source).problems).toEqual([])
    expect((await h.del(`${V1}/media-type/${VIDEO}`)).status).toBe(200)
    expect(existsSync(file)).toBe(false)
  })

  test('a site without the four files still has the system three, and Folder allows only what exists', async () => {
    const { h } = await site({ withSiteMediaTypes: false })
    const tree = await h.json<{ items: Array<{ id: string }> }>(
      `${V1}/tree/media-type/root?skip=0&take=20`,
    )
    expect(tree.items.map((i) => i.id).sort()).toEqual(
      [...Object.values(SYSTEM), MEDIA_CACHE_FIELDS_TYPE_KEY].sort(),
    )
    const folder = await h.json<MediaTypeResponse>(`${V1}/media-type/${SYSTEM.Folder}`)
    expect(folder.allowedMediaTypes.map((a) => a.mediaType.id).sort()).toEqual(
      Object.values(SYSTEM).sort(),
    )
  })

  test('export writes no file for an unchanged system type, and one once it is changed', async () => {
    const { h, schemaDir } = await site()
    const set = await exportSchemaSet(h.server.db, '1.0.0')
    expect((set.mediaTypes ?? []).map((t) => t.alias).sort()).toEqual([
      'umbracoMediaArticle',
      'umbracoMediaAudio',
      'umbracoMediaVectorGraphics',
      'umbracoMediaVideo',
    ])
    // Change Image in the backoffice: it gains a file
    const image = await h.json<MediaTypeResponse>(`${V1}/media-type/${SYSTEM.Image}`)
    const changed = await h.put(`${V1}/media-type/${SYSTEM.Image}`, {
      ...image,
      name: 'Picture',
      allowedMediaTypes: [],
      compositions: [],
    })
    expect(changed.status).toBe(200)
    const imageFile = join(schemaDir, 'media-types', 'image.toml')
    expect(existsSync(imageFile)).toBe(true)
    const parsed = parseMediaType('image', readFileSync(imageFile, 'utf8'))
    expect(parsed.value).toMatchObject({ alias: 'Image', name: 'Picture' })
    // Its key is the one Crombolo ships, so the file need not say it (story 161).
    expect(parsed.value?.key).toBeUndefined()
    expect(typeKeyFor('media', 'Image')).toBe(SYSTEM.Image)
    // …and that file is a valid override of the system type
    expect(validateSchemaSet(loadSchemaDirectory(schemaDir).set)).toEqual([])
  })

  test('a file cannot take a system alias with another key', () => {
    const set = {
      version: '1.0.0',
      contentTypes: [],
      dataTypes: [],
      languages: [],
      mediaTypes: [
        {
          key: '0b1c8e3a-7777-4a5b-9c1d-000000000001',
          alias: 'file',
          name: 'File',
          icon: 'icon-document',
          allowAtRoot: true,
          isElement: false,
          allowInLibrary: false,
          variesByCulture: false,
          variesBySegment: false,
          compositions: [],
          allowChildren: ['Folder'],
          components: [],
          cleanup: { prevent: false },
          properties: [],
          tabs: [],
        },
      ],
    }
    const problems = validateSchemaSet(set)
    expect(problems.map((p) => p.message)).toEqual([
      expect.stringContaining('is the system media type File'),
    ])
  })

  test('a database from before the built-ins gains them at boot, once', async () => {
    const { h } = await site({ withSiteMediaTypes: false })
    const db = h.server.db
    // Simulate an older database: no pixel label, no Image
    const repo = new ContentTypeRepository(db, { kind: 'media' })
    await repo.delete(SYSTEM.Image)
    await db.exec(
      "DELETE FROM data_type WHERE node_id = (SELECT id FROM node WHERE unique_id = '5eb57825-e15e-4fc7-8e37-fca65cdafbde')",
    )
    await db.exec("DELETE FROM node WHERE unique_id = '5eb57825-e15e-4fc7-8e37-fca65cdafbde'")
    expect(await ensureBuiltInDataTypes(db)).toEqual(['labelPixels'])
    expect(await ensureSystemMediaTypes(db)).toEqual(['Image'])
    expect(await ensureBuiltInDataTypes(db)).toEqual([])
    expect(await ensureSystemMediaTypes(db)).toEqual([])
    expect((await repo.byKey(SYSTEM.Image))?.properties).toHaveLength(5)
  })
})

describe('the media types init writes, without keys (story 161)', () => {
  test('carry no key lines, and sync to the keys Umbraco ships', async () => {
    for (const [path, content] of Object.entries(siteMediaTypeFiles()))
      expect(content, path).not.toContain('key = ')
    const { h } = await site()
    const repo = new ContentTypeRepository(h.server.db, { kind: 'media' })
    for (const def of BUILT_IN_MEDIA_TYPES.filter((t) => !t.system && !t.composition)) {
      const synced = await repo.byAlias(def.alias)
      expect(synced?.key, def.alias).toBe(def.key)
      for (const property of def.properties)
        expect(
          synced?.properties.find((p) => p.alias === property.alias)?.key,
          `${def.alias}.${property.alias}`,
        ).toBe(property.key)
    }
  })
})

describe('Folder on a site never started (story 180)', () => {
  const dbs: Array<{ close(): Promise<void> }> = []
  afterEach(async () => {
    while (dbs.length > 0) await dbs.pop()?.close()
  })

  async function siteNeverStarted(files: Record<string, string> = {}) {
    const root = mkdtempSync(join(process.cwd(), 'output', 'never-started-'))
    dirs.push(root)
    mkdirSync(join(root, 'schema', 'media-types'), { recursive: true })
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content)
    const db = await freshDb()
    dbs.push(db)
    const config = loadConfig({ schemaDir: join(root, 'schema'), development: true })
    // What every command does when it opens the database: no server, no boot.
    await installDatabase(db, config)
    const folderAllows = async () => {
      const folder = await new ContentTypeRepository(db, { kind: 'media' }).byKey(SYSTEM.Folder)
      const keys = new Set(folder?.allowedContentTypes.map((a) => a.contentTypeKey.toLowerCase()))
      return BUILT_IN_MEDIA_TYPES.filter((t) => keys.has(t.key)).map((t) => t.alias)
    }
    return { db, config, root, folderAllows }
  }

  test('opening the database puts images in folders, and a sync adds the types it creates', async () => {
    const site = await siteNeverStarted()
    expect(await site.folderAllows()).toEqual(expect.arrayContaining(['Folder', 'Image', 'File']))
    expect(await site.folderAllows()).not.toContain('umbracoMediaVideo')

    for (const [path, content] of Object.entries(siteMediaTypeFiles()))
      writeFileSync(join(site.root, path), content)
    const report = await syncSchemaDirectory(site.db, site.config, { nodeId: 'n', revision: '1' })
    expect(report.action).toBe('applied')
    // In the same process, not at the next start.
    expect(await site.folderAllows()).toContain('umbracoMediaVideo')
  })

  test('a file that defines Folder says itself what it allows', async () => {
    const site = await siteNeverStarted({
      'schema/media-types/folder.toml':
        '[media-type]\nalias = "Folder"\nname = "Folder"\nicon = "icon-folder"\nallow-at-root = true\nallow-children = ["Folder"]\n',
    })
    const report = await syncSchemaDirectory(site.db, site.config, { nodeId: 'n', revision: '1' })
    expect(report.action, JSON.stringify(report.problems)).toBe('applied')
    expect(await site.folderAllows()).toEqual(['Folder'])
  })
})

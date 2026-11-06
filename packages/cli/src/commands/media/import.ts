import { readdirSync, statSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import { type DocumentValue, IMAGE_CROPPER_EDITOR_ALIAS, mediaFileOf } from '@crombolo/core'
import {
  appendCacheInstruction,
  ContentTypeRepository,
  DataTypeRepository,
  IMAGE_ALT_TEXT_ALIAS,
  type NodeRow,
} from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { childrenByName, mediaParent, openMedia, sha256 } from '../../support/media-tree.ts'
import { siteConfig } from '../../support/site.ts'

/** The editors `--alt` can write a sentence to. */
const TEXT_EDITORS = new Set(['Umbraco.TextBox', 'Umbraco.TextArea'])

/** How many new items one cache instruction names. */
const IMPORT_BATCH = 500

interface Outcome {
  path: string
  action: 'created' | 'folder' | 'skipped' | 'updated' | 'differs' | 'unsupported'
  type?: string
}

/** What one file was told about itself, beyond its bytes. */
interface FileDetails {
  alt?: string
  focal?: { left: number; top: number }
}

/** `--focal x,y`, each from 0 to 1. */
function focalPoint(value: string): { left: number; top: number } | undefined {
  const parts = value.split(',')
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return undefined
  const [left, top] = parts.map(Number) as [number, number]
  return left >= 0 && left <= 1 && top >= 0 && top <= 1 ? { left, top } : undefined
}

/**
 * A folder of files into the media library: a media folder for each directory,
 * an item for each file, typed by its extension as an upload is. A file already
 * there with the same bytes is skipped, so an import that stopped part-way runs
 * again from where it got to.
 */
export default class MediaImport extends BaseCommand {
  static override summary =
    'import a file, or a folder of files keeping its folders, into the media library'
  static override description = [
    'Each directory becomes a media folder and each file a media item, typed by its extension as an upload is. Files no media type takes are reported and left.',
    'Run it again after a stop: a file already imported with the same bytes is skipped, and one whose bytes differ is reported and left alone.',
    'For one file, --name, --alt and --focal set its name, its alternative text and the point a crop keeps. Run again with other values, they update the item.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> media import ./photos --under /Gallery --dry-run',
    '<%= config.bin %> media import ./hero.jpg --under /Gallery --alt "The harbour at dawn" --focal 0.4,0.6',
  ]
  static override args = {
    path: Args.string({ required: true, description: 'the file or folder to import' }),
  }
  static override flags = {
    under: Flags.string({
      summary: 'the media folder to import into; the root when not given',
      helpValue: '<path|uuid>',
    }),
    name: Flags.string({ summary: 'one file: its name in the library', helpValue: '<name>' }),
    alt: Flags.string({ summary: 'one file: its alternative text', helpValue: '<text>' }),
    focal: Flags.string({
      summary: 'one image: the point a crop keeps, each from 0 to 1',
      helpValue: '<x,y>',
    }),
    'dry-run': dryRun,
  }
  static override audit = { category: 'media', action: 'Import', entityType: 'Media' } as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: [
      { name: 'created', type: 'integer' },
      { name: 'folders', type: 'integer' },
      { name: 'skipped', type: 'integer' },
      { name: 'updated', type: 'integer' },
      { name: 'differs', type: 'array', items: { type: 'string' } },
      { name: 'unsupported', type: 'array', items: { type: 'string' } },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'io', 'usage', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MediaImport)
    const root = resolve(args.path)
    const found = statSync(root, { throwIfNoEntry: false })
    if (!found) this.fail('not_found', `There is nothing at ${args.path}.`)
    const single = found.isFile()
    if (!single && (flags.name || flags.alt !== undefined || flags.focal))
      this.fail('usage', '--name, --alt and --focal are for one file, not a folder.')
    const focal = flags.focal ? focalPoint(flags.focal) : undefined
    if (flags.focal && !focal)
      this.fail('usage', `--focal takes two numbers from 0 to 1, as 0.4,0.6: not ${flags.focal}.`)
    const details: FileDetails = {
      ...(flags.alt === undefined ? {} : { alt: flags.alt }),
      ...(focal ? { focal } : {}),
    }
    const config = await siteConfig()
    const { db } = await bootstrapDatabase(config)
    try {
      const tree = await openMedia(db, config)
      const parent = await mediaParent(db, flags.under)
      const folderTypes = await tree.port.folderTypes()
      const folderType = folderTypes.find((t) => t.name === 'Folder') ?? folderTypes[0]
      if (!folderType) this.fail('refused', 'This site has no media folder type to import into.')
      const typeFor = new Map<string, { key: string; name: string } | undefined>()
      const outcomes: Outcome[] = []
      const dry = flags['dry-run']
      // The servers drop just these items, a batch at a time (story 197).
      let batch: string[] = []
      const announce = async () => {
        if (batch.length === 0) return
        await appendCacheInstruction(db, {
          kind: 'content',
          payload: { media: batch },
          by: `cli:${config.nodeId}`,
        })
        batch = []
      }
      const created = async (key: string) => {
        batch.push(key)
        if (batch.length >= IMPORT_BATCH) await announce()
      }

      const contentTypes = new ContentTypeRepository(db, { kind: 'media' })
      const dataTypes = new DataTypeRepository(db)
      /** Refuses what this type cannot hold, naming the file. */
      const checkDetails = async (typeKey: string, typeName: string, name: string) => {
        const properties = (await contentTypes.byKey(typeKey))?.properties ?? []
        const editorOf = async (alias: string) => {
          const property = properties.find((p) => p.alias === alias)
          return property && (await dataTypes.byKey(property.dataTypeKey))?.editorAlias
        }
        if (
          details.alt !== undefined &&
          !TEXT_EDITORS.has((await editorOf(IMAGE_ALT_TEXT_ALIAS)) ?? '')
        )
          this.fail('refused', `${name} would be a ${typeName}, which has no text field for --alt.`)
        if (details.focal && (await editorOf('umbracoFile')) !== IMAGE_CROPPER_EDITOR_ALIAS)
          this.fail('refused', `${name} would be a ${typeName}, which has no focal point.`)
      }
      const altValue = (value: string): DocumentValue => ({
        alias: IMAGE_ALT_TEXT_ALIAS,
        culture: null,
        segment: null,
        value,
      })
      /** Sets `details` on an item already here; whether anything changed. */
      const updateDetails = async (key: string, typeKey: string, shown: string) => {
        const media = await tree.repo.byKey(key)
        if (!media) return false
        let values = media.values
        if (details.alt !== undefined) {
          const was = values.find((v) => v.alias === IMAGE_ALT_TEXT_ALIAS)?.value
          if (was !== details.alt)
            values = [
              ...values.filter((v) => v.alias !== IMAGE_ALT_TEXT_ALIAS),
              altValue(details.alt),
            ]
        }
        if (details.focal) {
          const file = values.find((v) => v.alias === 'umbracoFile')
          const was = (file?.value as { focalPoint?: FileDetails['focal'] } | null)?.focalPoint
          if (file && (was?.left !== details.focal.left || was?.top !== details.focal.top))
            values = values.map((v) =>
              v === file
                ? { ...v, value: { ...(v.value as object), focalPoint: details.focal } }
                : v,
            )
        }
        if (values === media.values) return false
        if (!dry)
          await tree.repo.update({
            key,
            contentTypeKey: typeKey,
            componentKey: null,
            parentKey: media.parentKey,
            values,
            variants: media.variants.map((v) => ({
              culture: v.culture,
              segment: v.segment,
              name: v.name,
            })),
          })
        this.progress(`  ${dry ? 'would update' : 'updated'} ${shown}`)
        return true
      }

      const importFile = async (
        path: string,
        name: string,
        shown: string,
        existing: Map<string, NodeRow>,
        intoKey: string | null,
      ) => {
        const extension = extname(path).slice(1).toLowerCase()
        if (!typeFor.has(extension)) {
          const types = await tree.port.typesForExtension(extension)
          typeFor.set(extension, types.find((t) => t.matched) ?? types[0])
        }
        const type = typeFor.get(extension)
        if (!type) {
          outcomes.push({ path: shown, action: 'unsupported' })
          return
        }
        await checkDetails(type.key, type.name, shown)
        const bytes = await Bun.file(path).bytes()
        const there = existing.get(name)
        if (there) {
          const media = await tree.repo.byKey(there.key)
          const src = media ? mediaFileOf(media) : null
          const stored = src ? await tree.files.open(src) : undefined
          const same = stored ? sha256(await stored.bytes()) === sha256(bytes) : false
          const action = !same
            ? 'differs'
            : (await updateDetails(there.key, type.key, shown))
              ? 'updated'
              : 'skipped'
          if (action === 'updated') await created(there.key)
          outcomes.push({ path: shown, action, type: type.name })
          return
        }
        outcomes.push({ path: shown, action: 'created', type: type.name })
        if (dry) return
        const upload = crypto.randomUUID()
        await tree.files.saveTemporary(upload, new File([bytes], basename(path)))
        const key = crypto.randomUUID()
        await tree.repo.create({
          key,
          contentTypeKey: type.key,
          componentKey: null,
          parentKey: intoKey,
          values: [
            {
              alias: 'umbracoFile',
              culture: null,
              segment: null,
              value: {
                temporaryFileId: upload,
                ...(details.focal ? { focalPoint: details.focal } : {}),
              },
            },
            ...(details.alt === undefined ? [] : [altValue(details.alt)]),
          ],
          variants: [{ culture: null, segment: null, name }],
        })
        await created(key)
        const made = outcomes.filter((o) => o.action === 'created').length
        if (made % 25 === 0) this.progress(`  imported ${made}`)
      }

      const walk = async (dir: string, into: NodeRow | null, intoKey: string | null) => {
        const existing =
          into || !dry ? await childrenByName(tree, into) : new Map<string, NodeRow>()
        for (const name of readdirSync(dir).sort()) {
          if (name.startsWith('.')) continue
          const path = join(dir, name)
          const shown = relative(root, path)
          if (statSync(path).isDirectory()) {
            let folder = existing.get(name) ?? null
            if (!folder) {
              outcomes.push({ path: shown, action: 'folder' })
              if (!dry) {
                const key = crypto.randomUUID()
                await tree.repo.create({
                  key,
                  contentTypeKey: folderType.key,
                  componentKey: null,
                  parentKey: intoKey,
                  values: [],
                  variants: [{ culture: null, segment: null, name }],
                })
                await created(key)
                folder = (await tree.nodes.byKey(key)) ?? null
              }
            }
            await walk(path, folder, folder?.key ?? null)
            continue
          }
          await importFile(path, name, shown, existing, intoKey)
        }
      }
      if (single) {
        const existing = await childrenByName(tree, parent)
        const name = flags.name ?? basename(root)
        await importFile(root, name, name, existing, parent?.key ?? null)
      } else await walk(root, parent, parent?.key ?? null)
      await announce()

      const count = (action: Outcome['action']) => outcomes.filter((o) => o.action === action)
      const verb = dry ? 'would create' : 'created'
      for (const o of outcomes.filter((o) => o.action !== 'skipped'))
        this.say(
          `  ${(o.action === 'created' ? verb : o.action === 'folder' ? `${verb} folder` : o.action).padEnd(20)} ${o.path}${o.type ? `  (${o.type})` : ''}`,
        )
      this.say(
        `\n  ${count('created').length} file(s) and ${count('folder').length} folder(s) ${dry ? 'to create' : 'created'}, ${count('skipped').length} already here` +
          `${count('updated').length > 0 ? `, ${count('updated').length} ${dry ? 'to update' : 'updated'}` : ''}` +
          `${count('differs').length > 0 ? `, ${count('differs').length} differ` : ''}${count('unsupported').length > 0 ? `, ${count('unsupported').length} no media type takes` : ''}`,
      )
      const changed =
        !dry &&
        (count('created').length > 0 || count('folder').length > 0 || count('updated').length > 0)
      if (dry) this.changedNothing = true
      return {
        created: count('created').length,
        folders: count('folder').length,
        skipped: count('skipped').length,
        updated: count('updated').length,
        differs: count('differs').map((o) => o.path),
        unsupported: count('unsupported').map((o) => o.path),
        changed,
      }
    } finally {
      await db.close()
    }
  }
}

import { usedByWords } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  referenceFields,
  referenceLines,
  showingWords,
  sizeWords,
  withMediaLibrary,
} from '../../support/media-library.ts'
import { profileFlags } from '../../support/remote.ts'

/** One media item: what it is, its file, and with --references what uses it (story 355). */
export default class MediaShow extends BaseCommand {
  static override summary =
    'one media item: its type, folder, file, size, alternative text, focal point and who can see it'
  static override examples = [
    '<%= config.bin %> media show /Gallery/hero.jpg',
    '<%= config.bin %> media show /Gallery/hero.jpg --references --profile production',
  ]
  static override args = {
    item: Args.string({ required: true, description: 'the media item: a path or a uuid' }),
  }
  static override flags = {
    references: Flags.boolean({ summary: 'list the pages and media that use it' }),
    skip: Flags.integer({ summary: 'with --references: how many to skip', min: 0, default: 0 }),
    take: Flags.integer({
      summary: 'with --references: how many to show',
      min: 1,
      max: 100,
      default: 25,
    }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'media' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'path', type: 'string' },
      {
        name: 'type',
        type: 'object',
        fields: [
          { name: 'alias', type: 'string' },
          { name: 'name', type: 'string' },
        ],
      },
      { name: 'folder', type: 'boolean' },
      {
        name: 'parent',
        type: 'object',
        nullable: true,
        fields: [
          { name: 'key', type: 'string' },
          { name: 'name', type: 'string' },
          { name: 'path', type: 'string' },
        ],
      },
      { name: 'file', type: 'string', nullable: true, description: 'the address it is served at' },
      { name: 'size', type: 'integer', nullable: true },
      { name: 'width', type: 'integer', nullable: true },
      { name: 'height', type: 'integer', nullable: true },
      { name: 'extension', type: 'string', nullable: true },
      { name: 'alt', type: 'string', nullable: true },
      {
        name: 'focal',
        type: 'object',
        nullable: true,
        fields: [
          { name: 'left', type: 'number' },
          { name: 'top', type: 'number' },
        ],
      },
      { name: 'access', type: 'string', description: 'who can see and change it' },
      { name: 'protected', type: 'boolean' },
      referenceFields,
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MediaShow)
    return withMediaLibrary(flags, 'media-library', async (site) => {
      const item = await site.show(args.item, flags.references, {
        skip: flags.skip,
        take: flags.take,
      })
      this.say(`${item.path}  (${item.folder ? 'folder' : item.type.name})`)
      this.say(`  key        ${item.key}`)
      this.say(`  folder     ${item.parent?.path ?? 'the top of the library'}`)
      if (item.file) this.say(`  file       ${item.file}`)
      if (item.size !== null) this.say(`  size       ${sizeWords(item.size)}`)
      if (item.width !== null && item.height !== null)
        this.say(`  dimensions ${item.width} × ${item.height}`)
      if (item.alt) this.say(`  alt text   ${item.alt}`)
      if (item.focal) this.say(`  focal      ${item.focal.left},${item.focal.top}`)
      this.say(`  access     ${item.access}`)
      if (item.references) {
        this.say(`\n  ${usedByWords(item.references)}`)
        for (const line of referenceLines(item.references)) this.say(line)
        const showing = showingWords(
          flags.skip,
          item.references.items.length,
          item.references.total,
        )
        if (showing) this.say(`\n  ${showing}`)
      }
      return item
    })
  }
}

import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { profileFlags } from '../../support/remote.ts'
import { ago, withUndo } from '../../support/undo.ts'

const binItemFields = [
  { name: 'key', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'kind', type: 'string', enum: ['content', 'media'] },
  { name: 'trashedAt', type: 'string', nullable: true },
  {
    name: 'by',
    type: 'object',
    nullable: true,
    description: 'who put it in the bin; null when not a person, or not recorded',
    fields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
    ],
  },
  {
    name: 'from',
    type: 'object',
    fields: [
      { name: 'key', type: 'string', nullable: true, description: 'null for the top level' },
      { name: 'path', type: 'string', nullable: true, description: '`/` for the top level' },
      {
        name: 'gone',
        type: 'boolean',
        description: 'the place has been deleted, or is in the bin too',
      },
    ],
  },
] as const

/** What is in the recycle bin (story 353). */
export default class RecycleBinList extends BaseCommand {
  static override summary =
    'list what is in the recycle bin: name, when, by whom, and where it came from'
  static override description =
    'Pages and media both, unless --content or --media names one: what was put in the bin, not what went with it. `recycle-bin restore` puts one back.'
  static override examples = [
    '<%= config.bin %> recycle-bin list',
    '<%= config.bin %> recycle-bin list --media --older-than 30 --profile production',
  ]
  static override flags = {
    content: Flags.boolean({ summary: 'only pages', exclusive: ['media'] }),
    media: Flags.boolean({ summary: 'only media', exclusive: ['content'] }),
    'older-than': Flags.integer({
      summary: 'only what was trashed more than this many days ago',
      min: 0,
    }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = ['content', 'media'] as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      { name: 'items', type: 'array', items: { type: 'object', fields: binItemFields } },
    ],
    errors: ['refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { flags } = await this.parse(RecycleBinList)
    const kinds = (['content', 'media'] as const).filter(
      (kind) => (!flags.content && !flags.media) || flags[kind],
    )
    return withUndo(flags, 'recycle-bin', async (site) => {
      const items = await site.bin(kinds, flags['older-than'])
      const now = Date.now()
      for (const item of items) {
        const from = item.from.gone ? 'from a place that is gone' : `from ${item.from.path ?? '/'}`
        const by = item.by ? ` by ${item.by.name}` : ''
        this.say(
          `  ${(item.kind === 'media' ? 'media' : 'page').padEnd(6)} ${item.name.padEnd(24)} ${from.padEnd(28)} trashed${by}, ${ago(item.trashedAt, now)}`,
        )
      }
      if (items.length === 0) this.say('  The recycle bin is empty.')
      return { items }
    })
  }
}

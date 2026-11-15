import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { profileFlags } from '../../support/remote.ts'
import { TOP } from '../../support/tree.ts'
import { pickBinItem, refuseGonePlace, withUndo } from '../../support/undo.ts'

/** A page or media item back out of the recycle bin, with what was below it (story 353). */
export default class RecycleBinRestore extends BaseCommand {
  static override summary =
    'put a page or media item back where it came from, with what was below it'
  static override description = [
    'The item is named by its key, by the path it was at (`/Home/Visit us`), or by its name when only one item in the bin has it. `recycle-bin list` shows each.',
    `When the place it came from is gone, it is refused unless --to gives another: a page or folder, or ${TOP} for the top level. A media branch large enough to be restored in the background is followed until it is done.`,
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> recycle-bin restore "/Home/Visit us"',
    '<%= config.bin %> recycle-bin restore cover.png --to /Images',
  ]
  static override args = {
    item: Args.string({
      required: true,
      description: 'the item: a key, the path it was at, or its name',
    }),
  }
  static override flags = {
    to: Flags.string({
      summary: `restore it here instead: a path or uuid, or ${TOP} for the top level; a uuid on a hosted site`,
      helpValue: '<parent>',
    }),
    content: Flags.boolean({ summary: 'only look among pages', exclusive: ['media'] }),
    media: Flags.boolean({ summary: 'only look among media', exclusive: ['content'] }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = ['content', 'media'] as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      {
        name: 'item',
        type: 'object',
        fields: [
          { name: 'key', type: 'string' },
          { name: 'name', type: 'string' },
          { name: 'kind', type: 'string', enum: ['content', 'media'] },
        ],
      },
      {
        name: 'to',
        type: 'object',
        nullable: true,
        description: 'where it went; null for the top level',
        fields: [
          { name: 'key', type: 'string' },
          { name: 'name', type: 'string' },
        ],
      },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(RecycleBinRestore)
    const kinds = (['content', 'media'] as const).filter(
      (kind) => (!flags.content && !flags.media) || flags[kind],
    )
    return withUndo(flags, 'recycle-bin', async (site) => {
      const item = pickBinItem(await site.bin(kinds), args.item)
      const named = flags.to === undefined ? undefined : await site.place(item.kind, flags.to)
      if (named === undefined) refuseGonePlace(item)
      await site.restore(this, item, named)
      const to =
        named !== undefined
          ? named
          : item.from.key
            ? { key: item.from.key, name: item.from.path ?? item.from.key }
            : null
      this.say(`  restored ${item.name} to ${to ? to.name : 'the top level'}`)
      return { item: { key: item.key, name: item.name, kind: item.kind }, to }
    })
  }
}

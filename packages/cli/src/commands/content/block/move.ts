import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import {
  blockArgs,
  blockFlags,
  blockListOf,
  blockSpec,
  indexOfBlock,
  placeFlags,
  placeIn,
  saveBlockList,
  withPages,
} from '../../../support/blocks.ts'

/** A block put elsewhere in its list (story 253). */
export default class ContentBlockMove extends BaseCommand {
  static override summary = 'move a block within its list'
  static override examples = [
    '<%= config.bin %> content block move /Home blocks rye --before sourdough',
    '<%= config.bin %> content block move /Home blocks rye --last',
  ]
  static override args = {
    ...blockArgs,
    block: Args.string({ required: true, description: 'the block: its alias or its key' }),
  }
  static override flags = { ...placeFlags, ...blockFlags }
  static override spec = blockSpec

  async run() {
    const { args, flags } = await this.parse(ContentBlockMove)
    if (!flags.before && !flags.after && !flags.first && !flags.last)
      throw new CliError('usage', 'Say where: --before, --after, --first or --last.')
    return withPages(async (site) => {
      const list = await blockListOf(site, args.page, args.property, flags.culture ?? null)
      const from = indexOfBlock(list, args.block)
      const to = placeIn(list, flags, from)
      const [item] = list.layout.splice(from, 1)
      list.layout.splice(to, 0, item as Record<string, unknown>)
      return saveBlockList(this, site, list, flags, `block "${args.block}" moved`)
    })
  }
}

import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  blockArgs,
  blockFlags,
  blockListOf,
  blockSpec,
  indexOfBlock,
  saveBlockList,
  withPages,
} from '../../../support/blocks.ts'

/** A block taken off a page (story 253). */
export default class ContentBlockRemove extends BaseCommand {
  static override summary = "take a block off a page's block list"
  static override examples = ['<%= config.bin %> content block remove /Home blocks rye']
  static override args = {
    ...blockArgs,
    block: Args.string({ required: true, description: 'the block: its alias or its key' }),
  }
  static override flags = blockFlags
  static override spec = blockSpec

  async run() {
    const { args, flags } = await this.parse(ContentBlockRemove)
    return withPages(async (site) => {
      const list = await blockListOf(site, args.page, args.property, flags.culture ?? null)
      const [item] = list.layout.splice(indexOfBlock(list, args.block), 1)
      list.value.contentData = list.value.contentData.filter((d) => d.key !== item?.contentKey)
      list.value.settingsData = list.value.settingsData.filter((d) => d.key !== item?.settingsKey)
      return saveBlockList(this, site, list, flags, `block "${args.block}" taken off`)
    })
  }
}

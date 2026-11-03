import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import {
  blockArgs,
  blockFlags,
  blockListOf,
  blockSpec,
  checkedAlias,
  elementValuesOf,
  indexOfBlock,
  mergedValues,
  saveBlockList,
  setsOf,
  withPages,
} from '../../../support/blocks.ts'

/** A block's values, settings or alias changed (story 253). */
export default class ContentBlockUpdate extends BaseCommand {
  static override summary = "change a block's values, its settings or its alias"
  static override examples = [
    '<%= config.bin %> content block update /Home blocks sourdough --set heading="Sourdough loaf"',
    '<%= config.bin %> content block update /Home blocks 3f1c…e2 --alias rye',
  ]
  static override args = {
    ...blockArgs,
    block: Args.string({ required: true, description: 'the block: its alias or its key' }),
  }
  static override flags = {
    set: Flags.string({
      summary: 'a value of the block',
      helpValue: '<property>=<value>',
      multiple: true,
    }),
    unset: Flags.string({ summary: 'take a value away', helpValue: '<property>', multiple: true }),
    'settings-set': Flags.string({
      summary: "a value of the block's settings",
      helpValue: '<property>=<value>',
      multiple: true,
    }),
    alias: Flags.string({ summary: 'its alias; "" for none', helpValue: '<alias>' }),
    ...blockFlags,
  }
  static override spec = blockSpec

  async run() {
    const { args, flags } = await this.parse(ContentBlockUpdate)
    const sets = setsOf(flags.set)
    const settingsSets = setsOf(flags['settings-set'])
    if (
      sets.length === 0 &&
      settingsSets.length === 0 &&
      !flags.unset?.length &&
      flags.alias === undefined
    )
      throw new CliError('usage', 'Say what to change: --set, --unset, --settings-set or --alias.')
    return withPages(async (site) => {
      const list = await blockListOf(site, args.page, args.property, flags.culture ?? null)
      const index = indexOfBlock(list, args.block)
      const item = { ...(list.layout[index] as Record<string, unknown>) }
      const data = list.value.contentData.find((d) => d.key === item.contentKey)
      const element = data
        ? await site.lookup.typeByKey('document', String(data.contentTypeKey))
        : undefined
      if (!data || !element)
        throw new CliError('refused', `Nothing was changed: block "${args.block}" has no content.`)
      if (sets.length > 0 || flags.unset?.length)
        data.values = mergedValues(
          data.values,
          await elementValuesOf(site, element, sets, list.page.doc.key),
          flags.unset,
        )
      if (settingsSets.length > 0) {
        const settings = list.value.settingsData.find((d) => d.key === item.settingsKey)
        const settingsType = settings
          ? await site.lookup.typeByKey('document', String(settings.contentTypeKey))
          : undefined
        if (!settings || !settingsType)
          throw new CliError(
            'refused',
            `Nothing was changed: block "${args.block}" has no settings to change.`,
          )
        settings.values = mergedValues(
          settings.values,
          await elementValuesOf(site, settingsType, settingsSets, list.page.doc.key),
        )
      }
      if (flags.alias !== undefined) {
        const alias = checkedAlias(list, flags.alias, index)
        if (alias) item.alias = alias
        else delete item.alias
      }
      list.layout[index] = item
      return saveBlockList(this, site, list, flags, `block "${args.block}"`)
    })
  }
}

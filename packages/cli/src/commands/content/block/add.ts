import { normaliseUuid } from '@crombolo/core'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import {
  blockArgs,
  blockFlags,
  blockListOf,
  blockSpec,
  checkedAlias,
  elementValuesOf,
  isSingle,
  placeFlags,
  placeIn,
  saveBlockList,
  setsOf,
  takeOut,
  withPages,
} from '../../../support/blocks.ts'

/** A block added to a page's block list (story 253). */
export default class ContentBlockAdd extends BaseCommand {
  static override summary = "add a block to a page's block list"
  static override description = [
    'The block goes last unless --before, --after or --first says where. Give it an --alias to name it by later; otherwise it is named by the key this prints.',
    'A single block holds one: the new block replaces the one there.',
    'Saved as a draft; --publish publishes the page too.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content block add /Home blocks --type highlight --alias sourdough --set heading=Sourdough --set detail="Three days from starter to loaf."',
    '<%= config.bin %> content block add /Home blocks --type highlight --set heading=Rye --after sourdough',
  ]
  static override args = blockArgs
  static override flags = {
    type: Flags.string({
      required: true,
      summary: "the block's element type",
      helpValue: '<type>',
    }),
    alias: Flags.string({ summary: 'a name to pick the block out by', helpValue: '<alias>' }),
    set: Flags.string({
      summary: 'a value of the block',
      helpValue: '<property>=<value>',
      multiple: true,
    }),
    'settings-set': Flags.string({
      summary: "a value of the block's settings",
      helpValue: '<property>=<value>',
      multiple: true,
    }),
    ...placeFlags,
    ...blockFlags,
  }
  static override spec = { ...blockSpec, effects: 'non_idempotent' } as const

  async run() {
    const { args, flags } = await this.parse(ContentBlockAdd)
    return withPages(async (site) => {
      const list = await blockListOf(site, args.page, args.property, flags.culture ?? null)
      const element = await site.lookup.typeOf('document', flags.type)
      const offered = element
        ? list.offered.find((o) => o.content === normaliseUuid(element.key))
        : undefined
      if (!element || !offered)
        throw new CliError(
          'refused',
          `Nothing was changed: "${args.property}" offers no "${flags.type}" block.`,
          {
            hint: `\`crombolo types show ${list.page.type.alias}\` and the data type's blocks say what it offers.`,
          },
        )
      const alias = flags.alias === undefined ? undefined : checkedAlias(list, flags.alias)
      const key = crypto.randomUUID()
      const contentData = {
        key,
        contentTypeKey: element.key,
        values: await elementValuesOf(site, element, setsOf(flags.set), list.page.doc.key),
      }
      const item: Record<string, unknown> = { contentKey: key, ...(alias ? { alias } : {}) }
      const settingsSets = setsOf(flags['settings-set'])
      if (settingsSets.length > 0) {
        const settingsType = offered.settings
          ? await site.lookup.typeByKey('document', offered.settings)
          : undefined
        if (!settingsType)
          throw new CliError(
            'refused',
            `Nothing was changed: a "${flags.type}" block here has no settings.`,
          )
        const settingsKey = crypto.randomUUID()
        list.value.settingsData.push({
          key: settingsKey,
          contentTypeKey: settingsType.key,
          values: await elementValuesOf(site, settingsType, settingsSets, list.page.doc.key),
        })
        item.settingsKey = settingsKey
      }
      if (list.editor === 'Umbraco.BlockGrid')
        Object.assign(item, { columnSpan: 12, rowSpan: 1, areas: [] })
      // A Single Block holds one: the new block replaces the one there (story 345).
      if (isSingle(list)) while (list.layout.length > 0) takeOut(list, 0)
      list.value.contentData.push(contentData)
      list.layout.splice(placeIn(list, flags), 0, item)
      const result = await saveBlockList(
        this,
        site,
        list,
        flags,
        `a ${element.alias} block${alias ? ` "${alias}"` : ''}`,
      )
      this.say(`  key      ${key}`)
      return { ...result, block: { key, alias: alias ?? null } }
    })
  }
}

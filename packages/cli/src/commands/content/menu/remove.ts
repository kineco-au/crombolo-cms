import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { needLibraryVerb, withLibrary } from '../../../support/library.ts'
import {
  countOf,
  findItem,
  findMenu,
  menuArgs,
  menuWriteFlags,
  menuWriteSpec,
  saveMenu,
} from '../../../support/menus.ts'

/** An item taken out of a menu (story 361), with the items below it. */
export default class ContentMenuRemove extends BaseCommand {
  static override summary = 'remove a menu item, and the items below it'
  static override description =
    'The menu’s draft changes: --publish takes it live. The pages an item linked to are not touched.'
  static override examples = [
    '<%= config.bin %> content menu remove main "About us/Our team"',
    '<%= config.bin %> content menu remove footer Shop --publish',
  ]
  static override args = {
    ...menuArgs,
    item: Args.string({
      required: true,
      description: 'the item: its labels from the top, or its key',
    }),
  }
  static override flags = menuWriteFlags
  static override access = 'site' as const
  static override section = 'library' as const
  static override spec = {
    ...menuWriteSpec,
    outputFields: [
      ...menuWriteSpec.outputFields,
      { name: 'removed', type: 'integer', description: 'the item and the items below it' },
    ],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentMenuRemove)
    needLibraryVerb('save')
    return withLibrary(async (site) => {
      const menu = await findMenu(site, args.alias)
      const found = findItem(menu, args.item)
      const below = countOf(found.entry) - 1
      found.list.entries.splice(found.list.entries.indexOf(found.entry), 1)
      const changed = await saveMenu(
        this,
        site,
        menu,
        flags,
        `removed "${found.path}"${below > 0 ? ` and the ${below} item(s) below it` : ''}`,
      )
      return {
        key: menu.key,
        alias: menu.alias,
        path: menu.path,
        item: found.entry.layout.contentKey as string,
        removed: below + 1,
        changed,
        published: changed && flags.publish === true,
      }
    })
  }
}

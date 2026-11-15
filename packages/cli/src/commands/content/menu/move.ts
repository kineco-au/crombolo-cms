import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { needLibraryVerb, withLibrary } from '../../../support/library.ts'
import {
  countOf,
  findItem,
  findMenu,
  menuArgs,
  menuWriteFlags,
  menuWriteSpec,
  placeFlags,
  placeItem,
  saveMenu,
} from '../../../support/menus.ts'

/** An item put elsewhere in a menu (story 361), with the items below it. */
export default class ContentMenuMove extends BaseCommand {
  static override summary = 'move a menu item, with the items below it'
  static override description = [
    '--under puts it below another item and --top at the top of the menu; with neither it stays in its list. --first, --before and --after say where in that list.',
    'An item cannot go under itself or an item below it. The menu’s draft changes: --publish takes it live.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content menu move main "About us/Our team" --top --after "About us"',
    '<%= config.bin %> content menu move main Contact --first --publish',
  ]
  static override args = {
    ...menuArgs,
    item: Args.string({
      required: true,
      description: 'the item: its labels from the top, or its key',
    }),
  }
  static override flags = {
    ...placeFlags,
    top: Flags.boolean({ summary: 'put it at the top of the menu' }),
    ...menuWriteFlags,
  }
  static override access = 'site' as const
  static override section = 'library' as const
  static override spec = menuWriteSpec

  async run() {
    const { args, flags } = await this.parse(ContentMenuMove)
    if (
      flags.under === undefined &&
      !flags.top &&
      !flags.first &&
      flags.before === undefined &&
      flags.after === undefined
    )
      throw new CliError('usage', 'Say where: --under, --top, --first, --before or --after.')
    needLibraryVerb('save')
    return withLibrary(async (site) => {
      const menu = await findMenu(site, args.alias)
      const moving = findItem(menu, args.item)
      const under = placeItem(menu, moving.entry, flags, moving)
      const below = countOf(moving.entry) - 1
      const changed = await saveMenu(
        this,
        site,
        menu,
        flags,
        `moved "${moving.path}"${below > 0 ? ` and the ${below} item(s) below it` : ''}${under ? ` under "${under}"` : flags.top ? ' to the top' : ''}`,
      )
      return {
        key: menu.key,
        alias: menu.alias,
        path: menu.path,
        item: moving.entry.layout.contentKey as string,
        changed,
        published: changed && flags.publish === true,
      }
    })
  }
}

import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { needLibraryVerb, withLibrary } from '../../../support/library.ts'
import {
  findMenu,
  menuArgs,
  menuWriteFlags,
  menuWriteSpec,
  newItem,
  placeFlags,
  placeItem,
  saveMenu,
} from '../../../support/menus.ts'

/** An item added to a menu (story 361): a page, a media item, an address or a heading. */
export default class ContentMenuAdd extends BaseCommand {
  static override summary = 'add an item to a menu: a page, a media item, an address, or a heading'
  static override description = [
    'The link is read as content files read one: an address with a scheme (https://…), else a media item’s path, else a page’s path, `/Home/About`. --label is shown instead of the page’s name; with no link, it makes a heading that only holds the items below it.',
    'It goes last at the top of the menu unless --under, --first, --before or --after say otherwise. An item is named by its labels from the top, as `content menu show` prints them.',
    'The menu’s draft changes: --publish takes it live, so templates and the Delivery API follow.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content menu add main /Home/About --label "About us"',
    '<%= config.bin %> content menu add main "/Home/About/Our team" --under "About us" --publish',
    '<%= config.bin %> content menu add footer https://example.org/shop --label Shop --target _blank',
    '<%= config.bin %> content menu add main --label More --before Contact',
  ]
  static override args = {
    ...menuArgs,
    link: Args.string({
      required: false,
      description: 'what it links to: a page path, a media path or an address; none for a heading',
    }),
  }
  static override flags = {
    label: Flags.string({
      summary: "what it says, instead of the page's name",
      helpValue: '<text>',
    }),
    target: Flags.string({
      summary: 'where the link opens: _blank for a new tab',
      helpValue: '_blank',
    }),
    ...placeFlags,
    ...menuWriteFlags,
  }
  static override access = 'site' as const
  static override section = 'library' as const
  static override spec = menuWriteSpec

  async run() {
    const { args, flags } = await this.parse(ContentMenuAdd)
    needLibraryVerb('save')
    return withLibrary(async (site) => {
      const menu = await findMenu(site, args.alias)
      const entry = await newItem(site, menu, args.link, flags.label, flags.target)
      const under = placeItem(menu, entry, flags)
      const changed = await saveMenu(
        this,
        site,
        menu,
        flags,
        `added "${entry.label}"${under ? ` under "${under}"` : ''}`,
      )
      return {
        key: menu.key,
        alias: menu.alias,
        path: menu.path,
        item: changed ? (entry.layout.contentKey as string) : null,
        changed,
        published: changed && flags.publish === true,
      }
    })
  }
}

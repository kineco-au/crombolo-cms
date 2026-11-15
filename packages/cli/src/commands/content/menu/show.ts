import { BaseCommand } from '../../../base.ts'
import { needLibraryVerb, withLibrary } from '../../../support/library.ts'
import { findMenu, itemsJson, menuArgs, sayItems } from '../../../support/menus.ts'

const STATES: Record<string, string> = {
  Draft: 'a draft, not published',
  Published: 'published',
  PublishedPendingChanges: 'published, with changes not published yet',
}

/** A menu's items as a tree (story 361), as its draft has them. */
export default class ContentMenuShow extends BaseCommand {
  static override summary = "a menu's items: each one's label and what it links to"
  static override description = [
    'The menu is named by its alias, the one a template’s `menu()` and the Delivery API use. Its items are those of its draft, each with the items below it; whether the draft has changes not yet published is said first.',
    'An item is named in the other menu commands by its labels from the top, as shown here: `About/Our team`. `-o json` gives each item’s key too, for one whose labels are not enough.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content menu show main',
    '<%= config.bin %> content menu show footer -o json',
  ]
  static override args = menuArgs
  static override access = 'site' as const
  static override section = 'library' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    stdoutSchema: {},
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { args } = await this.parse(ContentMenuShow)
    needLibraryVerb('read')
    return withLibrary(async (site) => {
      const menu = await findMenu(site, args.alias)
      const state = menu.doc.variants[0]?.state ?? 'Draft'
      this.say(`${menu.name}  (${menu.alias})  ${menu.path}`)
      this.say(`  ${STATES[state] ?? state}`)
      if (menu.items.entries.length === 0) this.say('  It has no items yet.')
      else sayItems(this, menu.items)
      return {
        key: menu.key,
        alias: menu.alias,
        name: menu.name,
        path: menu.path,
        state,
        published: state !== 'Draft',
        changes: state !== 'Published',
        items: itemsJson(menu.items),
      }
    })
  }
}

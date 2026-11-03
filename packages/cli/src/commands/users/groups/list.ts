import { BaseCommand } from '../../../base.ts'
import { databaseGroups, siteDefinitions } from '../../../support/site-definitions.ts'

/** The user groups: the site's own, and those made in the back office (story 251). */
export default class UsersGroupsList extends BaseCommand {
  static override summary = "the user groups: the site's own, and those made in the back office"
  static override description =
    "The site's own groups travel with it and the `users groups` commands change them. One made in the back office lives in this environment's database alone: `crombolo users groups export <alias>` makes it one of the site's."
  static override examples = ['<%= config.bin %> users groups list']
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'items',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'alias', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'source', type: 'string' },
            { name: 'users', type: 'integer', nullable: true },
          ],
        },
      },
    ],
  } as const

  async run() {
    await this.parse(this.ctor)
    const { config, loaded } = await siteDefinitions()
    const own = loaded.set.userGroups ?? []
    const database = (await databaseGroups(config)) ?? []
    const users = new Map(database.map((d) => [d.group.alias.toLowerCase(), d.users]))
    const items = [
      ...own.map((g) => ({
        alias: g.alias,
        name: g.name,
        source: 'site',
        users: users.get(g.alias.toLowerCase()) ?? null,
      })),
      ...database
        .filter((d) => !own.some((g) => g.alias.toLowerCase() === d.group.alias.toLowerCase()))
        .map((d) => ({
          alias: d.group.alias,
          name: d.group.name,
          source: 'back office',
          users: d.users,
        })),
    ].sort((a, b) => a.alias.localeCompare(b.alias))
    for (const item of items)
      this.say(
        `  ${item.alias.padEnd(24)} ${item.name.padEnd(28)} ${item.source === 'site' ? "the site's own" : 'made in the back office'}${item.users === null ? '' : `  ${item.users} user(s)`}`,
      )
    if (items.length === 0) this.say('No user groups.')
    return { items }
  }
}

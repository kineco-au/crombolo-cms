import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { permissionName } from '../../../support/names.ts'
import { asDeclared, databaseGroups, siteDefinitions } from '../../../support/site-definitions.ts'

/** One user group: its sections, permissions and languages, and who is in it (story 251). */
export default class UsersGroupsShow extends BaseCommand {
  static override summary = 'one user group: its sections, permissions and languages'
  static override examples = ['<%= config.bin %> users groups show editors']
  static override args = {
    alias: Args.string({ required: true, description: "the group's alias" }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    stdoutSchema: {},
    errors: ['not_found'],
  } as const

  async run() {
    const { args } = await this.parse(UsersGroupsShow)
    const { config, loaded } = await siteDefinitions()
    const wanted = args.alias.toLowerCase()
    const database = (await databaseGroups(config)) ?? []
    const inDatabase = database.find((d) => d.group.alias.toLowerCase() === wanted)
    const own = (loaded.set.userGroups ?? []).find((g) => g.alias.toLowerCase() === wanted)
    const group = own ?? (inDatabase ? asDeclared(inDatabase.group) : undefined)
    if (!group)
      throw new CliError('not_found', `There is no user group "${args.alias}".`, {
        hint: '`crombolo users groups list` lists them.',
      })
    this.say(
      `User group "${group.name}" (${group.alias}), ${own ? "the site's own" : 'made in the back office'}`,
    )
    if (group.description) this.say(`  ${group.description}`)
    this.say(`  sections     ${group.sections.join(', ') || 'none'}`)
    this.say(`  permissions  ${group.permissions.map(permissionName).join(', ') || 'none'}`)
    this.say(
      `  languages    ${group.languages === 'all' ? 'all' : group.languages.join(', ') || 'none'}`,
    )
    if (inDatabase) this.say(`  users        ${inDatabase.users}`)
    if (!own)
      this.say(
        "\n`crombolo users groups export` makes it one of the site's, so the CLI can change it.",
      )
    return { ...group, source: own ? 'site' : 'back office', users: inDatabase?.users ?? null }
  }
}

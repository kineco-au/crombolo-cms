import { ADMIN_GROUP_ALIAS } from '@crombolo/core'
import { writeUserGroup } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import {
  asDeclared,
  databaseGroups,
  groupFile,
  siteDefinitions,
} from '../../../support/site-definitions.ts'
import { commitDefinitionEdit, editSpec } from '../../../support/type-edit.ts'

/** A group made in the back office, made one of the site's own (story 251). */
export default class UsersGroupsExport extends BaseCommand {
  static override summary = "make a group made in the back office one of the site's own"
  static override description =
    'Its sections, permissions and languages go with the site from then on, and the `users groups` commands change it. Who is in it, and where it starts in the tree, stay with each environment.'
  static override examples = ['<%= config.bin %> users groups export reviewers']
  static override args = {
    alias: Args.string({ required: true, description: "the group's alias" }),
  }
  static override flags = {
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
    'no-apply': Flags.boolean({
      summary: 'change it, and leave applying it to `crombolo types sync`',
    }),
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(UsersGroupsExport)
    const { config, loaded } = await siteDefinitions()
    const wanted = args.alias.toLowerCase()
    if (wanted === ADMIN_GROUP_ALIAS.toLowerCase())
      throw new CliError('refused', 'The administrators group stays with each environment.')
    if ((loaded.set.userGroups ?? []).some((g) => g.alias.toLowerCase() === wanted))
      throw new CliError('conflict', `"${args.alias}" is already one of the site's own groups.`)
    const found = ((await databaseGroups(config)) ?? []).find(
      (d) => d.group.alias.toLowerCase() === wanted,
    )
    if (!found)
      throw new CliError(
        'not_found',
        `There is no user group "${args.alias}" on this site's database.`,
        {
          hint: '`crombolo users groups list` lists them.',
        },
      )
    const group = asDeclared(found.group)
    return commitDefinitionEdit(
      this,
      {
        config,
        alias: group.alias,
        file: groupFile(config, loaded.files, group.alias),
        current: '',
        next: writeUserGroup(group),
      },
      [`The user group "${group.name}" (${group.alias}) becomes one of the site's own.`],
      flags,
    )
  }
}

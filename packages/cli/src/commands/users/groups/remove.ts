import { writeUserGroup } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import {
  databaseGroups,
  groupFile,
  moveUsersAndRemove,
  ownGroup,
  siteDefinitions,
} from '../../../support/site-definitions.ts'
import { commitDefinitionEdit, editSpec } from '../../../support/type-edit.ts'

/** A user group taken out of the site (story 251); refused while users are in it, unless they move. */
export default class UsersGroupsRemove extends BaseCommand {
  static override summary = 'remove a user group, moving its users to another'
  static override description =
    "Refused while users are in it, unless --move-users-to names the group they go to. A group made in the back office is refused: `crombolo users groups export <alias>` makes it one of the site's first."
  static override examples = [
    '<%= config.bin %> users groups remove reviewers --move-users-to editors',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the group's alias" }),
  }
  static override flags = {
    'move-users-to': Flags.string({ summary: 'the group its users move to', helpValue: '<group>' }),
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
    'no-apply': Flags.boolean({ summary: 'change it, and leave the database as it is' }),
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(UsersGroupsRemove)
    const { config, loaded } = await siteDefinitions()
    const group = await ownGroup(config, loaded.set.userGroups ?? [], args.alias)
    const database = (await databaseGroups(config)) ?? []
    const users =
      database.find((d) => d.group.alias.toLowerCase() === group.alias.toLowerCase())?.users ?? 0
    const target = flags['move-users-to']
    if (users > 0 && !target)
      throw new CliError(
        'refused',
        `"${group.alias}" has ${users} user(s), so it was not removed.`,
        {
          hint: 'Name the group they go to with --move-users-to <group>.',
        },
      )
    if (target && !database.some((d) => d.group.alias.toLowerCase() === target.toLowerCase()))
      throw new CliError('not_found', `There is no group "${target}" to move its users to.`)
    const outcome = await commitDefinitionEdit(
      this,
      {
        config,
        alias: group.alias,
        file: groupFile(config, loaded.files, group.alias),
        current: writeUserGroup(group),
        next: null,
      },
      [
        `The user group "${group.name}" (${group.alias}) is removed${users > 0 ? `, its ${users} user(s) moving to ${target}` : ''}.`,
      ],
      flags,
    )
    // A sync never deletes a group, so this does, once its users have moved.
    if (outcome.applied) await moveUsersAndRemove(config, group.alias, target)
    return outcome
  }
}

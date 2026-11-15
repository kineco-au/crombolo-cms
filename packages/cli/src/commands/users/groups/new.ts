import { ADMIN_GROUP_ALIAS } from '@crombolo/core'
import { writeUserGroup } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { CliError } from '../../../errors.ts'
import { permissionVerbs, sectionNames } from '../../../support/names.ts'
import { databaseGroups, groupFile, siteDefinitions } from '../../../support/site-definitions.ts'
import { commitDefinitionEdit } from '../../../support/type-edit.ts'
import {
  groupEditSpec,
  placeChangeOf,
  placeFlags,
  placeLines,
  placesAnything,
  refuseUnapplied,
  UserCommand,
  withUsers,
} from '../../../support/users.ts'

/** A user group of the site's own (story 251). */
export default class UsersGroupsNew extends UserCommand {
  static override summary = "add a user group of the site's own"
  static override description =
    "It travels with the site. Who is in it, where in the tree it starts and who owns it are kept with each environment's database: the start node and owner flags set them here once the group is applied."
  static override examples = [
    '<%= config.bin %> users groups new reviewers --name Reviewers --section content --permission content:read --language all',
    '<%= config.bin %> users groups new bloggers --name Bloggers --section content --start-at /Home/Blog --owner editor',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the group's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name', helpValue: '<name>', required: true }),
    description: Flags.string({ summary: 'its description', helpValue: '<text>' }),
    icon: Flags.string({ summary: 'its icon', helpValue: '<icon>' }),
    section: Flags.string({
      summary: 'a section it may open; give each',
      helpValue: '<section>',
      multiple: true,
    }),
    permission: Flags.string({
      summary: 'a permission it holds; give each',
      helpValue: '<permission>',
      multiple: true,
    }),
    language: Flags.string({
      summary: 'a language it may edit, or all; give each',
      helpValue: '<iso|all>',
      multiple: true,
    }),
    ...placeFlags,
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
    'no-apply': Flags.boolean({
      summary: 'change it, and leave applying it to `crombolo types sync`',
    }),
  }
  static override audit = {
    category: 'permission',
    action: 'Save',
    entityType: 'UserGroup',
  } as const
  static override access = 'site' as const
  static override section = 'users' as const
  static override adminOnly = true
  static override spec = groupEditSpec

  async run() {
    const { args, flags } = await this.parse(UsersGroupsNew)
    const place = placeChangeOf(flags)
    refuseUnapplied(place, flags)
    const { config, loaded } = await siteDefinitions()
    const wanted = args.alias.toLowerCase()
    if (wanted === ADMIN_GROUP_ALIAS.toLowerCase())
      throw new CliError('refused', 'The administrators group stays with each environment.')
    if ((loaded.set.userGroups ?? []).some((g) => g.alias.toLowerCase() === wanted))
      throw new CliError('conflict', `The site already has a user group "${args.alias}".`)
    if (((await databaseGroups(config)) ?? []).some((d) => d.group.alias.toLowerCase() === wanted))
      throw new CliError('conflict', `"${args.alias}" was made in the back office.`, {
        hint: `\`crombolo users groups export ${args.alias}\` makes it one of the site's.`,
      })
    const languages = flags.language ?? []
    const text = writeUserGroup({
      alias: args.alias,
      name: flags.name,
      ...(flags.description ? { description: flags.description } : {}),
      ...(flags.icon ? { icon: flags.icon } : {}),
      sections: sectionNames(flags.section) ?? [],
      permissions: permissionVerbs(flags.permission) ?? [],
      languages: languages.includes('all') ? 'all' : languages,
    })
    const outcome = await commitDefinitionEdit(
      this,
      {
        config,
        alias: args.alias,
        file: groupFile(config, loaded.files, args.alias),
        current: '',
        next: text,
      },
      [`The user group "${flags.name}" (${args.alias}) is added.`, ...placeLines(place)],
      flags,
    )
    this.changedNothing = true
    if (!outcome.applied || !placesAnything(place)) return { ...outcome, placed: null }
    // Kept with the database, so set once the group is there (story 356).
    return withUsers({}, async (site) => {
      const placed = await site.placeGroup(args.alias, place, false)
      this.noted(site, placed.group.key, placed.changed.length > 0)
      return { ...outcome, placed: placed.group }
    })
  }
}

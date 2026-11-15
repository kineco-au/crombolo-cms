import { updateUserGroup, writeUserGroup } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { CliError } from '../../../errors.ts'
import { hostedOrHere } from '../../../profiles/choose.ts'
import { permissionVerbs, sectionNames } from '../../../support/names.ts'
import { profileFlags } from '../../../support/remote.ts'
import { groupFile, ownGroup, siteDefinitions } from '../../../support/site-definitions.ts'
import { commitDefinitionEdit, type EditOutcome } from '../../../support/type-edit.ts'
import {
  type GroupPlaceChange,
  type GroupPlaced,
  groupEditSpec,
  placeChangeOf,
  placeFlags,
  placeLines,
  placesAnything,
  refuseUnapplied,
  UserCommand,
  type UserSite,
  withUsers,
} from '../../../support/users.ts'

const many = (summary: string, helpValue: string) =>
  Flags.string({ summary, helpValue, multiple: true })

const FILE_FLAGS = [
  'name',
  'description',
  'icon',
  'section',
  'remove-section',
  'permission',
  'remove-permission',
  'all-languages',
  'language',
  'remove-language',
] as const

/**
 * A user group's name, sections, permissions or languages, in its file (story
 * 251); where it starts and who owns it, with the database (story 356).
 */
export default class UsersGroupsUpdate extends UserCommand {
  static override summary =
    'change a user group: its name, sections, permissions, languages, start nodes or owners'
  static override description = [
    "Its name, sections, permissions and languages are in its file, so a group made in the back office is refused them: `crombolo users groups export <alias>` makes it one of the site's first.",
    "Where it starts and who owns it are kept with this environment's database, for any group; owners are its file's when the file names them. On a hosted site, with --profile, only those change.",
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> users groups update editors --section media --permission content:publish',
    '<%= config.bin %> users groups update translators --no-all-languages --language fr-FR',
    '<%= config.bin %> users groups update writers --start-at /Home/Blog --media-start-at root --owner editors',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the group's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name', helpValue: '<name>' }),
    description: Flags.string({ summary: 'its description; "" for none', helpValue: '<text>' }),
    icon: Flags.string({ summary: 'its icon', helpValue: '<icon>' }),
    section: many('a section it may open', '<section>'),
    'remove-section': many('a section it may no longer open', '<section>'),
    permission: many('a permission it holds', '<permission>'),
    'remove-permission': many('a permission it no longer holds', '<permission>'),
    'all-languages': Flags.boolean({ summary: 'it may edit every language', allowNo: true }),
    language: many('a language it may edit', '<iso>'),
    'remove-language': many('a language it may no longer edit', '<iso>'),
    ...placeFlags,
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
    'no-apply': Flags.boolean({
      summary: 'change it, and leave applying it to `crombolo types sync`',
    }),
    ...profileFlags,
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
    const { args, flags } = await this.parse(UsersGroupsUpdate)
    const place = placeChangeOf(flags)
    const fileFlagged = FILE_FLAGS.some((name) => flags[name] !== undefined)
    if (hostedOrHere(flags)) {
      if (fileFlagged)
        throw new CliError(
          'refused',
          "A group's name, sections, permissions and languages are in the site's files: change them in the site and deploy it.",
          {
            hint: 'On a hosted site, only --start-at, --media-start-at, --library-start-at, --owner and --remove-owner change.',
          },
        )
      if (flags['no-apply']) throw new CliError('usage', '--no-apply is for a site folder.')
      return this.placed(flags, args.alias, place, [], flags['dry-run'])
    }
    const { config, loaded } = await siteDefinitions()
    const declared = (loaded.set.userGroups ?? []).find(
      (g) => g.alias.toLowerCase() === args.alias.toLowerCase(),
    )
    // Owners are the file's when it names them, as the group screen keeps them (story 302).
    const fileOwners = declared?.owners !== undefined
    const ownersChanged = Boolean(place.addOwners || place.removeOwners)
    const database: GroupPlaceChange = fileOwners
      ? { content: place.content, media: place.media, library: place.library }
      : place
    for (const tree of ['content', 'media', 'library'] as const)
      if (database[tree] === undefined) delete database[tree]
    refuseUnapplied(database, flags)
    const lines = placeLines(database)
    if (!fileFlagged && !(fileOwners && ownersChanged))
      return this.placed(flags, args.alias, database, lines, flags['dry-run'])
    // Checked first, so a place that is not there stops the change before its file is written.
    if (placesAnything(database))
      await withUsers(flags, (site) => site.placeGroup(args.alias, database, true))
    const group = await ownGroup(config, loaded.set.userGroups ?? [], args.alias)
    const result = updateUserGroup(group, {
      name: flags.name,
      description: flags.description,
      icon: flags.icon,
      addSections: sectionNames(flags.section),
      removeSections: sectionNames(flags['remove-section']),
      addPermissions: permissionVerbs(flags.permission),
      removePermissions: permissionVerbs(flags['remove-permission']),
      allLanguages: flags['all-languages'],
      addLanguages: flags.language,
      removeLanguages: flags['remove-language'],
      ...(fileOwners ? { addOwners: place.addOwners, removeOwners: place.removeOwners } : {}),
    })
    if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
    const change = [
      `The user group "${group.name}" (${group.alias}):`,
      ...(flags.name ? [`  named "${flags.name}"`] : []),
      ...(flags.section ?? []).map((s) => `  may open ${s}`),
      ...(flags['remove-section'] ?? []).map((s) => `  may no longer open ${s}`),
      ...(flags.permission ?? []).map((p) => `  holds ${p}`),
      ...(flags['remove-permission'] ?? []).map((p) => `  no longer holds ${p}`),
      ...(flags['all-languages'] === undefined
        ? []
        : [flags['all-languages'] ? '  edits every language' : '  edits the languages named']),
      ...(flags.language ?? []).map((l) => `  edits ${l}`),
      ...(flags['remove-language'] ?? []).map((l) => `  no longer edits ${l}`),
      ...(fileOwners
        ? placeLines({ addOwners: place.addOwners, removeOwners: place.removeOwners })
        : []),
      ...lines,
    ]
    const outcome = await commitDefinitionEdit(
      this,
      {
        config,
        alias: group.alias,
        file: groupFile(config, loaded.files, group.alias),
        current: writeUserGroup(group),
        next: writeUserGroup(result.group),
      },
      change,
      flags,
    )
    this.changedNothing = true
    if (!placesAnything(database) || flags['dry-run']) return { ...outcome, placed: null }
    const placed = await withUsers(flags, (site) => this.place(site, args.alias, database, false))
    return { ...outcome, placed: placed.group }
  }

  /** Changes only what the database keeps, saying so first. */
  private async placed(
    flags: Parameters<typeof withUsers>[0],
    alias: string,
    change: GroupPlaceChange,
    lines: string[],
    dryRun: boolean,
  ): Promise<EditOutcome & { placed: GroupPlaced['group'] | null }> {
    if (!placesAnything(change))
      throw new CliError('usage', 'Nothing to change.', {
        hint: '`crombolo users groups update --help` lists what it changes.',
      })
    return withUsers(flags, async (site) => {
      const placed = await this.place(site, alias, change, dryRun)
      this.say(`The user group "${placed.group.name}" (${placed.group.alias}):`)
      for (const line of lines.length > 0 ? lines : placeLines(change)) this.say(line)
      if (dryRun) this.say('\nNothing was changed (--dry-run).')
      else if (placed.changed.length === 0) this.say('  It is already so: nothing changed.')
      return {
        type: placed.group.alias,
        changed: !dryRun && placed.changed.length > 0,
        applied: !dryRun && placed.changed.length > 0,
        findings: [],
        schema: null,
        placed: placed.group,
      }
    })
  }

  /** Where a group starts and who owns it, audited as the group screen's save is. */
  private async place(
    site: UserSite,
    alias: string,
    change: GroupPlaceChange,
    dryRun: boolean,
  ): Promise<GroupPlaced> {
    const placed = await site.placeGroup(alias, change, dryRun)
    this.noted(site, placed.group.key, !dryRun && placed.changed.length > 0)
    return placed
  }
}

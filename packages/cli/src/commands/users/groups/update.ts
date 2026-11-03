import { updateUserGroup, writeUserGroup } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { permissionVerbs, sectionNames } from '../../../support/names.ts'
import { groupFile, ownGroup, siteDefinitions } from '../../../support/site-definitions.ts'
import { commitDefinitionEdit, editSpec } from '../../../support/type-edit.ts'

const many = (summary: string, helpValue: string) =>
  Flags.string({ summary, helpValue, multiple: true })

/** A user group's name, sections, permissions or languages (story 251). */
export default class UsersGroupsUpdate extends BaseCommand {
  static override summary = "change a user group's name, sections, permissions or languages"
  static override description =
    "A group made in the back office is refused: `crombolo users groups export <alias>` makes it one of the site's first."
  static override examples = [
    '<%= config.bin %> users groups update editors --section media --permission content:publish',
    '<%= config.bin %> users groups update translators --no-all-languages --language fr-FR',
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
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
    'no-apply': Flags.boolean({
      summary: 'change it, and leave applying it to `crombolo types sync`',
    }),
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(UsersGroupsUpdate)
    const { config, loaded } = await siteDefinitions()
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
    ]
    return commitDefinitionEdit(
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
  }
}

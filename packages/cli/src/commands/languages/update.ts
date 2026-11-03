import { join } from 'node:path'
import { updateLanguage, writeLanguages } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { siteDefinitions } from '../../support/site-definitions.ts'
import { commitDefinitionEdit, editSpec } from '../../support/type-edit.ts'

/** A language's name, fallback, whether it is mandatory, or that it is the default (story 251). */
export default class LanguagesUpdate extends BaseCommand {
  static override summary =
    "change a language's name, fallback or whether it is mandatory, or make it the default"
  static override examples = [
    '<%= config.bin %> languages update fr-FR --fallback en-US --mandatory',
    '<%= config.bin %> languages update en-GB --default',
  ]
  static override args = {
    iso: Args.string({ required: true, description: 'the language code, such as fr-FR' }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name', helpValue: '<name>' }),
    fallback: Flags.string({
      summary: 'the language shown when this one is empty; none for none',
      helpValue: '<iso|none>',
    }),
    mandatory: Flags.boolean({
      summary: 'a page must be filled in this language to publish',
      allowNo: true,
    }),
    default: Flags.boolean({ summary: 'make it the default language' }),
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
    'no-apply': Flags.boolean({
      summary: 'change it, and leave applying it to `crombolo types sync`',
    }),
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(LanguagesUpdate)
    const { config, loaded } = await siteDefinitions()
    const languages = loaded.set.languages
    const result = updateLanguage(languages, args.iso, {
      name: flags.name,
      fallback:
        flags.fallback === undefined
          ? undefined
          : flags.fallback === 'none'
            ? null
            : flags.fallback,
      mandatory: flags.mandatory,
      default: flags.default ? true : undefined,
    })
    if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
    const change = [
      `The language ${args.iso}:`,
      ...(flags.name ? [`  named "${flags.name}"`] : []),
      ...(flags.fallback === undefined
        ? []
        : [
            flags.fallback === 'none'
              ? '  falls back to nothing'
              : `  falls back to ${flags.fallback}`,
          ]),
      ...(flags.mandatory === undefined
        ? []
        : [flags.mandatory ? '  mandatory' : '  not mandatory']),
      ...(flags.default ? ['  the default language'] : []),
    ]
    return commitDefinitionEdit(
      this,
      {
        config,
        alias: args.iso,
        file: join(config.schemaDir, 'languages.toml'),
        current: languages.length > 0 ? writeLanguages(languages) : '',
        next: writeLanguages(result.languages),
      },
      change,
      flags,
    )
  }
}

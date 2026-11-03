import { join } from 'node:path'
import { LanguageRepository } from '@crombolo/data'
import { removeLanguage, writeLanguages } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import {
  pagesIn,
  siteDefinitions,
  withDatabase,
  withExisting,
} from '../../support/site-definitions.ts'
import { commitDefinitionEdit, editSpec } from '../../support/type-edit.ts'

/** A language taken out of the site (story 251); refused while content varies by it. */
export default class LanguagesRemove extends BaseCommand {
  static override summary = 'remove a language no content is written in'
  static override description =
    'Refused while any page has a version in it, saying how many: removing a language deletes its translations, so there is no forcing it. Refused too for the default language, and one another falls back to.'
  static override examples = ['<%= config.bin %> languages remove de-DE']
  static override args = {
    iso: Args.string({ required: true, description: 'the language code, such as fr-FR' }),
  }
  static override flags = {
    'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
    'no-apply': Flags.boolean({ summary: 'change it, and leave the database as it is' }),
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(LanguagesRemove)
    const { config, loaded } = await siteDefinitions()
    const languages = loaded.set.languages
    const result = removeLanguage(languages, args.iso)
    if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
    const pages = (await withExisting(config, (db) => pagesIn(db, args.iso))) ?? 0
    if (pages > 0)
      throw new CliError(
        'refused',
        `${args.iso} was not removed: ${pages} page(s) have a version in it.`,
        {
          hint: 'Removing a language deletes its translations. Remove those versions first, if they are to go.',
        },
      )
    const outcome = await commitDefinitionEdit(
      this,
      {
        config,
        alias: args.iso,
        file: join(config.schemaDir, 'languages.toml'),
        current: writeLanguages(languages),
        next: writeLanguages(result.languages),
      },
      [`The language ${args.iso} is removed.`],
      flags,
    )
    // A sync adds and updates languages and never deletes one, so this does.
    if (outcome.applied)
      await withDatabase(config, (db) => new LanguageRepository(db).delete(args.iso))
    return outcome
  }
}

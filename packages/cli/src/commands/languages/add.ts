import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type SchemaLanguage, writeLanguages } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { describeSync, here } from '../../support/describe.ts'
import { siteConfig } from '../../support/site.ts'
import { applySchema, loadTypes, needSchemaDir, refuseOwnProblems } from '../../support/types.ts'

/** What a site starts in before it declares any language. */
const STARTING_LANGUAGE: SchemaLanguage = {
  iso: 'en-US',
  name: 'English (United States)',
  default: true,
  mandatory: false,
}

function languageName(iso: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(iso) ?? iso
  } catch {
    return iso
  }
}

export default class LanguagesAdd extends BaseCommand {
  static override summary = 'add a language to languages.toml, then apply it'
  static override examples = [
    '<%= config.bin %> languages add fr-FR --fallback en-US',
    '<%= config.bin %> languages add en-GB --default',
  ]
  static override args = {
    iso: Args.string({ required: true, description: 'the language code, such as fr-FR' }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name; from the code when absent', helpValue: '<name>' }),
    default: Flags.boolean({ summary: 'make it the default language' }),
    mandatory: Flags.boolean({ summary: 'a page must be filled in this language to publish' }),
    fallback: Flags.string({
      summary: 'the language shown when this one is empty',
      helpValue: '<iso>',
    }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'created', type: 'array', items: { type: 'string' } },
      { name: 'languages', type: 'array', items: { type: 'string' } },
      { name: 'schema', type: 'string' },
    ],
    errors: ['not_found', 'conflict', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(LanguagesAdd)
    const config = await siteConfig()
    needSchemaDir(config)
    const loaded = loadTypes(config)
    if (loaded.set.languages.some((l) => l.iso.toLowerCase() === args.iso.toLowerCase()))
      this.fail('conflict', `languages.toml already has ${args.iso}.`)
    // A site with no languages.toml is in English until it says otherwise, so the
    // first file keeps that language beside the new one rather than dropping it.
    const existing =
      loaded.set.languages.length > 0 || flags.default ? loaded.set.languages : [STARTING_LANGUAGE]
    const added: SchemaLanguage = {
      iso: args.iso,
      name: flags.name ?? languageName(args.iso),
      default: flags.default === true,
      mandatory: flags.mandatory === true,
      ...(flags.fallback ? { fallback: flags.fallback } : {}),
    }
    const languages = [
      ...existing.map((l) => (flags.default ? { ...l, default: false } : l)),
      added,
    ]
    refuseOwnProblems({ ...loaded.set, languages }, 'schema/languages')
    const file = join(config.schemaDir, 'languages.toml')
    await writeFile(file, writeLanguages(languages))
    this.say(`  updated  ${here(file)}`)
    const report = await applySchema(this, config)
    return {
      created: [here(file)],
      languages: languages.map((l) => l.iso),
      schema: describeSync(report),
    }
  }
}

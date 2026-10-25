import { BaseCommand } from '../../base.ts'
import { siteConfig } from '../../support/site.ts'
import { loadTypes, needSchemaDir } from '../../support/types.ts'

export default class LanguagesList extends BaseCommand {
  static override summary = 'the languages languages.toml declares'
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'languages',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'iso', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'default', type: 'boolean' },
            { name: 'mandatory', type: 'boolean' },
            { name: 'fallback', type: 'string', nullable: true },
          ],
        },
      },
    ],
  } as const

  async run() {
    await this.parse(this.ctor)
    const config = await siteConfig()
    needSchemaDir(config)
    const languages = loadTypes(config).set.languages.map((l) => ({
      iso: l.iso,
      name: l.name,
      default: l.default,
      mandatory: l.mandatory,
      fallback: l.fallback ?? null,
    }))
    if (languages.length === 0) this.say('No languages.toml; the site is in English (en-US).')
    for (const l of languages)
      this.say(
        `  ${l.iso.padEnd(8)} ${l.name}${l.default ? '  (default)' : ''}${l.mandatory ? '  mandatory' : ''}${l.fallback ? `  falls back to ${l.fallback}` : ''}`,
      )
    return { languages }
  }
}

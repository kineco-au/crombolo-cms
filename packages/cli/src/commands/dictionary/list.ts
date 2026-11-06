import { DictionaryRepository, LanguageRepository } from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { siteConfig } from '../../support/site.ts'

export default class DictionaryList extends BaseCommand {
  static override summary = "the dictionary's items and the languages each is in"
  static override description =
    '--missing lists the items with no translation in a language, or an empty one.'
  static override examples = ['<%= config.bin %> dictionary list --missing fr-FR']
  static override flags = {
    missing: Flags.string({
      summary: 'only the items not translated into this language',
      helpValue: '<iso>',
    }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'items',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'name', type: 'string' },
            { name: 'parent', type: 'string', nullable: true },
            { name: 'languages', type: 'array', items: { type: 'string' } },
          ],
        },
      },
    ],
    errors: ['refused'],
  } as const

  async run() {
    const { flags } = await this.parse(DictionaryList)
    const { db } = await bootstrapDatabase(await siteConfig())
    try {
      const missing = flags.missing?.toLowerCase()
      const languages = await new LanguageRepository(db).all()
      if (missing && !languages.some((l) => l.isoCode.toLowerCase() === missing))
        this.fail(
          'refused',
          `This site has no language ${flags.missing}.`,
          `It has ${languages.map((l) => l.isoCode).join(', ')}.`,
        )
      const all = await new DictionaryRepository(db).all()
      const names = new Map(all.map((item) => [item.key, item.name]))
      const items = all
        .map((item) => ({
          name: item.name,
          parent: (item.parentKey && names.get(item.parentKey)) ?? null,
          languages: item.translations
            .filter((t) => t.translation.trim() !== '')
            .map((t) => t.isoCode),
        }))
        .filter((item) => !missing || !item.languages.some((l) => l.toLowerCase() === missing))
      if (items.length === 0)
        this.say(missing ? `Everything is translated into ${flags.missing}.` : 'No items.')
      for (const item of items)
        this.say(`  ${item.name.padEnd(30)} ${item.languages.join(', ') || '(no translations)'}`)
      return { items }
    } finally {
      await db.close()
    }
  }
}

import { DictionaryRepository, LanguageRepository } from '@crombolo/data'
import { applyDictionaryEntries, bootstrapDatabase } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { siteConfig } from '../../support/site.ts'

export default class DictionarySet extends BaseCommand {
  static override summary = 'one translation of a dictionary item, making the item if it is new'
  static override description =
    'A new item goes at the top of the dictionary unless --parent places it. An item that exists stays where it is.'
  static override examples = [
    '<%= config.bin %> dictionary set Nav.Home --culture fr-FR Accueil --parent Nav',
  ]
  static override args = {
    key: Args.string({ required: true, description: "the item's name" }),
    value: Args.string({ required: true, description: 'the translation' }),
  }
  static override flags = {
    culture: Flags.string({
      required: true,
      summary: 'the language of the translation',
      helpValue: '<iso>',
    }),
    parent: Flags.string({
      summary: 'the item a new item goes under',
      helpValue: '<name>',
    }),
    'dry-run': dryRun,
  }
  static override audit = {
    category: 'settings',
    action: 'Save',
    entityType: 'DictionaryItem',
  } as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'action', type: 'string', description: 'created, updated or unchanged' },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(DictionarySet)
    const config = await siteConfig()
    const dry = flags['dry-run']
    if (dry) this.changedNothing = true
    const { db } = await bootstrapDatabase(config)
    try {
      const languages = await new LanguageRepository(db).all()
      const language = languages.find(
        (l) => l.isoCode.toLowerCase() === flags.culture.toLowerCase(),
      )
      if (!language)
        this.fail(
          'refused',
          `This site has no language ${flags.culture}.`,
          `It has ${languages.map((l) => l.isoCode).join(', ')}.`,
        )
      const repo = new DictionaryRepository(db)
      const parent = flags.parent ? await repo.byName(flags.parent) : undefined
      if (flags.parent && !parent)
        this.fail('not_found', `There is no dictionary item ${flags.parent}.`)
      const change = await applyDictionaryEntries(
        db,
        [
          {
            name: args.key,
            translations: [{ isoCode: language.isoCode, translation: args.value }],
            children: [],
          },
        ],
        {
          parentKey: parent?.key ?? null,
          keepPlace: true,
          dryRun: dry,
          by: `cli:${config.nodeId}`,
        },
      )
      if (!change.ok) this.fail('refused', `refused: ${change.reason}`)
      const action =
        change.created.length > 0 ? 'created' : change.updated.length > 0 ? 'updated' : 'unchanged'
      if (action === 'unchanged') this.changedNothing = true
      this.say(`  ${dry && action !== 'unchanged' ? `would be ${action}` : action}  ${args.key}`)
      this.auditKey = (await repo.byName(args.key))?.key
      return { key: args.key, action, changed: !dry && action !== 'unchanged' }
    } finally {
      await db.close()
    }
  }
}

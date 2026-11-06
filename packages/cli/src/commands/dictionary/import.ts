import { existsSync } from 'node:fs'
import {
  applyDictionaryEntries,
  bootstrapDatabase,
  importDictionaryUdt,
  readDictionaryToml,
  writingDictionary,
} from '@crombolo/server'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { siteConfig } from '../../support/site.ts'

export default class DictionaryImport extends BaseCommand {
  static override summary = 'apply a .udt or .toml file: items upsert, and none is deleted'
  static override description = [
    'A .toml file is written by hand: a table for each item, a string for each translation, a table inside it for each child. Its items are matched by name, and one the file places under another parent moves.',
    "A .udt file is Umbraco's, and its items are matched by key.",
    'A translation for a language this site has not got is skipped, and said so. A language the file does not name is kept.',
  ].join('\n\n')
  static override examples = ['<%= config.bin %> dictionary import dictionary.toml --dry-run']
  static override args = {
    file: Args.string({ required: true, description: 'the .udt or .toml file' }),
  }
  static override flags = { 'dry-run': dryRun }
  static override audit = {
    category: 'settings',
    action: 'Import',
    entityType: 'DictionaryItem',
  } as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'imported', type: 'integer' },
      { name: 'skipped', type: 'array', items: { type: 'string' } },
      {
        name: 'created',
        type: 'array',
        items: { type: 'string' },
        description: 'from a .toml file: the items made',
      },
      {
        name: 'updated',
        type: 'array',
        items: { type: 'string' },
        description: 'from a .toml file: the items changed',
      },
      {
        name: 'moved',
        type: 'array',
        items: { type: 'string' },
        description: 'from a .toml file: the items placed under another parent',
      },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(DictionaryImport)
    if (!existsSync(args.file)) this.fail('not_found', `No file at ${args.file}.`)
    const config = await siteConfig()
    const dry = flags['dry-run']
    if (dry) this.changedNothing = true
    const by = `cli:${config.nodeId}`
    const text = await Bun.file(args.file).text()
    const { db } = await bootstrapDatabase(config)
    try {
      if (!args.file.toLowerCase().endsWith('.toml')) {
        const outcome = await writingDictionary(
          db,
          { dryRun: dry, by },
          (tx) => importDictionaryUdt(tx, text, null),
          (result) => result.imported > 0,
        )
        if (!outcome.ok) this.fail('refused', `refused: ${outcome.reason}`)
        this.say(`  ${dry ? 'would import' : 'imported'} ${outcome.imported} item(s)`)
        this.saySkipped(outcome.skipped)
        return {
          imported: outcome.imported,
          skipped: outcome.skipped,
          created: [],
          updated: [],
          moved: [],
          changed: !dry && outcome.imported > 0,
        }
      }
      const { entries, problems } = readDictionaryToml(text)
      if (problems.length > 0)
        this.fail(
          'refused',
          `${args.file} has ${problems.length} problem(s), so nothing was applied.`,
          undefined,
          problems.map((problem) => problem.message),
        )
      const change = await applyDictionaryEntries(db, entries, { dryRun: dry, by })
      if (!change.ok) this.fail('refused', `refused: ${change.reason}`)
      for (const [action, names] of [
        ['create', change.created],
        ['update', change.updated],
        ['move', change.moved],
      ] as const)
        for (const name of names) this.say(`  ${dry ? 'would ' : ''}${action}  ${name}`)
      this.say(
        `  ${change.created.length} new, ${change.updated.length} changed, ${change.moved.length} moved, ${change.unchanged} as they were`,
      )
      this.saySkipped(change.skipped)
      const count = change.created.length + change.updated.length + change.moved.length
      if (count === 0) this.changedNothing = true
      return {
        imported: count,
        skipped: change.skipped,
        created: change.created,
        updated: change.updated,
        moved: change.moved,
        changed: !dry && count > 0,
      }
    } finally {
      await db.close()
    }
  }

  // Umbraco's own behaviour, and worth saying out loud rather than dropping
  // translations silently: a language this site has not got is skipped.
  private saySkipped(skipped: readonly string[]): void {
    if (skipped.length > 0)
      this.say(`  skipped  translations for ${skipped.join(', ')} — no such language here`)
  }
}

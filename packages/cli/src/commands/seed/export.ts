import { ObjectTypes } from '@crombolo/core'
import { describeRefFailure, resolveNodeRef } from '@crombolo/data'
import { bootstrapDatabase, exportSeed } from '@crombolo/server'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { siteConfig } from '../../support/site.ts'
import { itemsArg, positionals } from '../../support/tree.ts'

export default class SeedExport extends BaseCommand {
  static override summary = 'write seed files from content already in this site'
  static override description =
    'Each page named and the pages below it, into seed/content. Text and toggles are written plainly, a picker as the page it points at, and anything else as its editor stores it. A page keeps its key in the file, so `seed apply` names the same pages again.'
  static override examples = [
    '<%= config.bin %> seed export /Home',
    '<%= config.bin %> seed export /Legal /Docs',
  ]
  static override strict = false
  static override usage = 'seed export PAGE...'
  static override args = { page: itemsArg('content') }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: [{ name: 'written', type: 'array', items: { type: 'string' } }],
    errors: ['not_found'],
  } as const

  async run() {
    const { argv } = await this.parse(SeedExport)
    const config = await siteConfig()
    const { db } = await bootstrapDatabase(config)
    try {
      const roots = []
      for (const ref of positionals(argv)) {
        const resolved = await resolveNodeRef(db, [ObjectTypes.Document], ref)
        if (!resolved.ok) throw new CliError('not_found', describeRefFailure(ref, resolved))
        roots.push(resolved.node)
      }
      const result = await exportSeed(db, config.siteDir, roots)
      for (const file of result.written) this.say(`  wrote    ${file}`)
      return result
    } finally {
      await db.close()
    }
  }
}

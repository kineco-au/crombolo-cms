import { ObjectTypes } from '@crombolo/core'
import { describeRefFailure, NodeRepository, resolveNodeRef } from '@crombolo/data'
import { bootstrapDatabase, exportSeed, MediaFileStore, mediaStoreFor } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { siteConfig } from '../../support/site.ts'
import { positionals } from '../../support/tree.ts'

export default class SeedExport extends BaseCommand {
  static override summary = 'write seed files from content already in this site'
  static override description = [
    'Each page named and the pages below it, into seed/content; --all for every page, every Library element and every media item with its file.',
    'Values are written as a person would write them where seed apply reads that back — rich text as { html }, pickers and links as paths, blocks as tables — and as the editor stores them otherwise. A node keeps its key in its file, so `seed apply` names the same nodes again.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> seed export /Home',
    '<%= config.bin %> seed export --all',
  ]
  static override strict = false
  static override usage = 'seed export [PAGE...] [--all]'
  static override args = {
    page: Args.string({ description: 'a page: a path or a uuid; name more after it' }),
  }
  static override flags = {
    all: Flags.boolean({ summary: 'every page, Library element and media item, with its file' }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: [{ name: 'written', type: 'array', items: { type: 'string' } }],
    errors: ['not_found', 'usage'],
  } as const

  async run() {
    const { argv, flags } = await this.parse(SeedExport)
    const refs = positionals(argv)
    if (refs.length === 0 && !flags.all)
      throw new CliError('usage', 'Name the pages to export, or pass --all.')
    const config = await siteConfig()
    const { db } = await bootstrapDatabase(config)
    try {
      const pages = []
      if (flags.all)
        pages.push(
          ...(
            await new NodeRepository(db).children(
              -1,
              ObjectTypes.Document,
              0,
              Number.MAX_SAFE_INTEGER,
            )
          ).items,
        )
      else
        for (const ref of refs) {
          const resolved = await resolveNodeRef(db, [ObjectTypes.Document], ref)
          if (!resolved.ok) throw new CliError('not_found', describeRefFailure(ref, resolved))
          pages.push(resolved.node)
        }
      const result = await exportSeed(db, config.siteDir, {
        pages,
        library: flags.all,
        media: flags.all,
        files: flags.all ? new MediaFileStore(await mediaStoreFor(config)) : undefined,
      })
      for (const file of result.written) this.say(`  wrote    ${file}`)
      return result
    } finally {
      await db.close()
    }
  }
}

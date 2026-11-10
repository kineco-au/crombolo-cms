import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { bootstrapDatabase, buildCreatedBundle } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { describeBytes, here } from '../../support/describe.ts'
import { siteConfig } from '../../support/site.ts'

/** A Bundle Editor definition built as an extension (story 306), as the back office's download builds it. */
export default class ExtensionBuild extends BaseCommand {
  static override summary = 'build a bundle made in the Bundle Editor as an extension package'
  static override description = [
    "Builds the definition the Bundle Editor (Settings > Bundles > Created) keeps, by its name or id, into the same .tgz the back office's download gives: an extension, to publish or to install with `crombolo extension install`.",
    'A whole site, or a part of it, to move to another environment is a site package instead: `crombolo site build` or `crombolo site export`.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> extension build "Brochure kit"',
    '<%= config.bin %> extension build "Brochure kit" --with-media --out ./brochure-kit.tgz',
  ]
  static override args = {
    name: Args.string({ required: true, description: "the definition's name or id" }),
  }
  static override flags = {
    out: Flags.string({
      summary: 'the file to write; named for the package when left out',
      helpValue: '<file.tgz>',
    }),
    'with-media': Flags.boolean({ summary: 'the media files its picks name' }),
    check: Flags.boolean({ summary: 'build it and say what it holds, writing nothing' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'out', type: 'string', nullable: true },
      { name: 'definition', type: 'string' },
      { name: 'bytes', type: 'integer' },
    ],
    errors: ['not_found', 'usage'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ExtensionBuild)
    const config = await siteConfig()
    const { db } = await bootstrapDatabase(config)
    try {
      const found = await buildCreatedBundle(db, config, args.name, {
        withMedia: flags['with-media'],
      })
      if (!found)
        this.fail(
          'not_found',
          `The Bundle Editor has no bundle named "${args.name}".`,
          'Settings > Bundles > Created lists them.',
        )
      const { definition, built } = found
      if (flags.check) {
        this.changedNothing = true
        this.say(
          `  bundle   ${definition.name}: ${built.fileName}, ${describeBytes(built.bytes.length)}`,
        )
        return { out: null, definition: definition.name, bytes: built.bytes.length }
      }
      const out = resolve(flags.out ?? built.fileName)
      await writeFile(out, built.bytes)
      this.say(`  wrote    ${here(out)} (${describeBytes(built.bytes.length)}), an extension`)
      return { out: here(out), definition: definition.name, bytes: built.bytes.length }
    } finally {
      await db.close()
    }
  }
}

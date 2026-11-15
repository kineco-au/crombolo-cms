import { parseFocalPoint, usedByWords } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { focalFlag, withMediaLibrary } from '../../support/media-library.ts'
import { profileFlags } from '../../support/remote.ts'

const WORDS = { name: 'name', alt: 'alternative text', focal: 'focal point', file: 'file' }

/** A media item's name, alternative text, focal point or file changed, keeping its key (story 355). */
export default class MediaUpdate extends BaseCommand {
  static override summary =
    "change a media item's name, alternative text, focal point or file, keeping what uses it working"
  static override description = [
    'A new file replaces the old one in the same item, so the pages, links and other media that use the item show the new file. The old file is removed.',
    'The change is made as the back office makes it, and the audit log records who made it.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> media update /Gallery/hero.jpg --alt "The harbour at dawn" --focal 0.4,0.6',
    '<%= config.bin %> media update /Gallery/hero.jpg --file ./hero-2026.jpg --profile production',
  ]
  static override args = {
    item: Args.string({ required: true, description: 'the media item: a path or a uuid' }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name in the library', helpValue: '<name>' }),
    alt: Flags.string({ summary: 'its alternative text', helpValue: '<text>' }),
    focal: focalFlag,
    file: Flags.string({ summary: 'a new file for it, from here', helpValue: '<path>' }),
    'dry-run': dryRun,
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'media' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'path', type: 'string' },
      {
        name: 'changed',
        type: 'array',
        items: { type: 'string', enum: ['name', 'alt', 'focal', 'file'] },
      },
      {
        name: 'references',
        type: 'object',
        nullable: true,
        description: 'with --file: what uses it',
      },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MediaUpdate)
    if (
      flags.name === undefined &&
      flags.alt === undefined &&
      flags.focal === undefined &&
      flags.file === undefined
    )
      this.fail('usage', 'Say what to change: --name, --alt, --focal or --file.')
    const focal = flags.focal ? parseFocalPoint(flags.focal) : undefined
    if (flags.focal && !focal)
      this.fail('usage', `--focal takes two numbers from 0 to 1, as 0.4,0.6: not ${flags.focal}.`)
    const dry = flags['dry-run']
    return withMediaLibrary(flags, 'media-library', async (site) => {
      const done = await site.update(
        args.item,
        {
          ...(flags.name !== undefined ? { name: flags.name } : {}),
          ...(flags.alt !== undefined ? { alt: flags.alt } : {}),
          ...(focal ? { focal } : {}),
          ...(flags.file !== undefined ? { file: flags.file } : {}),
        },
        dry,
      )
      if (done.changed.length === 0) this.say(`  ${done.path} already has these.`)
      else
        this.say(
          `  ${dry ? 'Would change' : 'Changed'} the ${done.changed.map((c) => WORDS[c]).join(', ')} of ${done.path}.`,
        )
      if (done.references && done.changed.includes('file'))
        this.say(
          done.references.total === 0
            ? '  Nothing uses it yet.'
            : `  ${usedByWords(done.references)} ${dry ? 'They would keep' : 'They keep'} working: they name the item, not its file.`,
        )
      return done
    })
  }
}

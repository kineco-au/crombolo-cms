import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { withMediaLibrary } from '../../../support/media-library.ts'
import { profileFlags } from '../../../support/remote.ts'

/** The media folders a path names that are missing, made in turn (story 355). */
export default class MediaFolderNew extends BaseCommand {
  static override summary = 'make a media folder, and any folders above it that are missing'
  static override description =
    'Folders already there are left as they are, so running it again changes nothing.'
  static override examples = ['<%= config.bin %> media folder new /Gallery/2026/Spring']
  static override args = {
    path: Args.string({ required: true, description: 'the folder, as /Gallery/2026' }),
  }
  static override flags = { ...profileFlags }
  static override access = 'site' as const
  static override section = 'media' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'path', type: 'string' },
      { name: 'made', type: 'array', items: { type: 'string' } },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MediaFolderNew)
    return withMediaLibrary(flags, 'media-library', async (site) => {
      const done = await site.folders(args.path)
      if (done.made.length === 0) this.say(`  ${done.path} is already there.`)
      for (const path of done.made) this.say(`  made ${path}`)
      return done
    })
  }
}

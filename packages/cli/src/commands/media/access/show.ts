import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { accessFields, accessLines, withMediaLibrary } from '../../../support/media-library.ts'
import { profileFlags } from '../../../support/remote.ts'

/** Who may see and change a media folder or item, as its Permissions dialog shows (story 355). */
export default class MediaAccessShow extends BaseCommand {
  static override summary = 'who can see and change a media folder or item'
  static override examples = ['<%= config.bin %> media access show /Members']
  static override args = {
    item: Args.string({ required: true, description: 'the folder or item: a path or a uuid' }),
  }
  static override flags = { ...profileFlags }
  static override access = 'site' as const
  static override section = 'media' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: accessFields,
    errors: ['not_found', 'refused', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MediaAccessShow)
    return withMediaLibrary(flags, 'media-access', async (site) => {
      const view = await site.access(args.item)
      this.say(`${view.path}`)
      this.say(`  ${view.summary}`)
      this.say('')
      for (const line of accessLines(view)) this.say(line)
      return view
    })
  }
}

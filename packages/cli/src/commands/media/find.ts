import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  listFields,
  mediaLine,
  showingWords,
  withMediaLibrary,
} from '../../support/media-library.ts'
import { profileFlags } from '../../support/remote.ts'

/** Media items by their names, anywhere in the library or below a folder (story 355). */
export default class MediaFind extends BaseCommand {
  static override summary = 'find media items whose names hold some text, a page at a time'
  static override examples = [
    '<%= config.bin %> media find --name hero',
    '<%= config.bin %> media find --name logo --under /Brand --type Image -o json',
  ]
  static override flags = {
    name: Flags.string({ required: true, summary: 'text the name holds', helpValue: '<text>' }),
    under: Flags.string({
      summary: 'only items below this folder',
      helpValue: '<path|uuid>',
    }),
    type: Flags.string({ summary: 'only items of this media type', helpValue: '<alias>' }),
    skip: Flags.integer({ summary: 'how many to skip', min: 0, default: 0 }),
    take: Flags.integer({ summary: 'how many to show', min: 1, max: 100, default: 25 }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'media' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: listFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { flags } = await this.parse(MediaFind)
    return withMediaLibrary(flags, 'media-library', async (site) => {
      const found = await site.find({
        name: flags.name,
        under: flags.under,
        type: flags.type,
        skip: flags.skip,
        take: flags.take,
      })
      if (found.items.length === 0) this.say('  No media matches.')
      for (const item of found.items) this.say(mediaLine(item))
      const showing = showingWords(flags.skip, found.items.length, found.total)
      if (showing) this.say(`\n  ${showing}`)
      return found
    })
  }
}

import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  listFields,
  mediaLine,
  showingWords,
  withMediaLibrary,
} from '../../support/media-library.ts'
import { profileFlags } from '../../support/remote.ts'

/** The items in a media folder, or at the top, a page at a time (story 355). */
export default class MediaList extends BaseCommand {
  static override summary = 'the items in a media folder, or at the top of the library, by name'
  static override examples = [
    '<%= config.bin %> media list --under /Gallery',
    '<%= config.bin %> media list --type Image --skip 25 --profile production',
  ]
  static override flags = {
    under: Flags.string({
      summary: 'the folder to list; the top of the library when not given',
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
    const { flags } = await this.parse(MediaList)
    return withMediaLibrary(flags, 'media-library', async (site) => {
      const found = await site.list({
        under: flags.under,
        type: flags.type,
        skip: flags.skip,
        take: flags.take,
      })
      if (found.items.length === 0)
        this.say(flags.under ? '  This folder is empty.' : '  Nothing here.')
      for (const item of found.items) this.say(mediaLine(item))
      const showing = showingWords(flags.skip, found.items.length, found.total)
      if (showing) this.say(`\n  ${showing}`)
      return found
    })
  }
}

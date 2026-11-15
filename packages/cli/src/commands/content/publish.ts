import { BaseCommand } from '../../base.ts'
import { needSection, refersToLibrary } from '../../support/library.ts'
import { publishElement } from '../../support/library-content.ts'
import { publishArgs, publishFlags, publishPages, publishSpec } from '../../support/publish.ts'

export default class ContentPublish extends BaseCommand {
  static override summary = 'take a page live; --descendants for the branch below it'
  static override description = [
    '--culture per culture; --at and --until schedule it instead.',
    'A Library element, named `library:/…`, is published now. A menu reaches templates and the Delivery API only once it is published.',
  ].join('\n\n')
  static override args = publishArgs
  static override flags = publishFlags
  static override access = 'site' as const
  static override section = ['content', 'library'] as const
  static override spec = publishSpec

  async run() {
    const { args, flags } = await this.parse(ContentPublish)
    if (await refersToLibrary(args.page)) return publishElement(this, true, args.page, flags)
    needSection(false)
    return publishPages(this, true, args.page, flags)
  }
}

import { normaliseUuid } from '@crombolo/core'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { allBlueprints, withBlueprints } from '../../../support/blueprints.ts'

/** The site's blueprints (story 358), as the Settings tree lists them. */
export default class ContentBlueprintList extends BaseCommand {
  static override summary = 'list the blueprints new pages can start from: name, type and folder'
  static override description =
    "A blueprint is a page's values saved as a starting point for new pages of its type. --type lists one type's."
  static override examples = [
    '<%= config.bin %> content blueprint list',
    '<%= config.bin %> content blueprint list --type contentPage',
  ]
  static override flags = {
    type: Flags.string({ summary: "only this page type's", helpValue: '<type>' }),
  }
  static override access = 'site' as const
  static override section = ['content', 'settings'] as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'items',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'key', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'type', type: 'string', description: "its type's alias" },
            { name: 'folder', type: 'string', description: 'empty at the top' },
          ],
        },
      },
    ],
    errors: ['not_found'],
  } as const

  async run() {
    const { flags } = await this.parse(ContentBlueprintList)
    return withBlueprints(async ({ site, port }) => {
      let wanted: Set<string> | undefined
      if (flags.type !== undefined) {
        const type = await site.lookup.typeOf('document', flags.type)
        if (!type || type.isElement)
          throw new CliError('not_found', `The site has no page type called "${flags.type}".`, {
            hint: '`crombolo types list --kind content` lists them.',
          })
        const of = await port.forContentType(type.key, { skip: 0, take: 100_000 })
        wanted = new Set(of.items.map((b) => normaliseUuid(b.key)))
      }
      const aliases = new Map<string, string>()
      const items = []
      for (const b of await allBlueprints(port)) {
        if (wanted && !wanted.has(b.key)) continue
        if (!aliases.has(b.contentTypeKey))
          aliases.set(
            b.contentTypeKey,
            (await site.lookup.typeByKey('document', b.contentTypeKey))?.alias ?? '',
          )
        items.push({
          key: b.key,
          name: b.name,
          type: aliases.get(b.contentTypeKey) ?? '',
          folder: b.folder,
        })
      }
      if (items.length === 0)
        this.say(flags.type ? `"${flags.type}" has no blueprints.` : 'The site has no blueprints.')
      for (const item of items)
        this.say(`  ${item.name}  (${item.type})${item.folder ? `  in ${item.folder}` : ''}`)
      return { items }
    })
  }
}

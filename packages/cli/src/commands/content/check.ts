import { validationPath } from '@crombolo/core'
import { storedBlockProblems } from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { BaseCommand } from '../../base.ts'
import { siteConfig } from '../../support/site.ts'

/** Story 456: the stored pages whose blocks their next save would refuse, and where. */
export default class ContentCheck extends BaseCommand {
  static override summary = 'list the pages whose blocks their next save would refuse'
  static override description = [
    'A save refuses blocks Umbraco would: too few or too many, a block type the property or a grid area does not offer, and a field inside a block left empty or not matching its pattern. Content saved before those rules keeps showing as it is, and stays published, but its next save is refused until it is fixed.',
    'This lists each such page and Library item, with every problem’s path into its value and the editor’s own words for it, so they can be fixed ahead. Exits 20 (problems_found) when there is one.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content check',
    '<%= config.bin %> content check -o json',
  ]
  static override access = 'site' as const
  static override section = ['content', 'library'] as const
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
            { name: 'kind', type: 'string' },
            { name: 'key', type: 'string' },
            { name: 'name', type: 'string' },
            {
              name: 'problems',
              type: 'array',
              items: {
                type: 'object',
                fields: [
                  { name: 'property', type: 'string' },
                  { name: 'culture', type: 'string' },
                  { name: 'path', type: 'string' },
                  { name: 'messages', type: 'array', items: { type: 'string' } },
                ],
              },
            },
          ],
        },
      },
    ],
    errors: [],
    outcomes: ['problems_found'],
  } as const

  async run() {
    await this.parse(ContentCheck)
    const config = await siteConfig()
    const { db } = await bootstrapDatabase(config)
    try {
      const found = await storedBlockProblems(db)
      const items = found.map((item) => ({
        kind: item.kind,
        key: item.key,
        name: item.name,
        problems: item.errors.map((e) => ({
          property: e.alias,
          culture: e.culture,
          path: validationPath(e),
          messages: e.messages,
        })),
      }))
      if (items.length === 0) this.say('Every page’s blocks would be accepted on its next save.')
      for (const item of items) {
        this.say(
          `${item.kind === 'element' ? 'Library item' : 'Page'} "${item.name}" (${item.key})`,
        )
        for (const problem of item.problems)
          this.say(`  ${problem.path}: ${problem.messages.join(' ')}`)
      }
      if (items.length > 0) this.outcome = 'problems_found'
      return { items }
    } finally {
      await db.close()
    }
  }
}

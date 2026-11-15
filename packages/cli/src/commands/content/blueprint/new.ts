import { mayAt } from '@crombolo/content'
import { DocumentPermissions } from '@crombolo/core'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { signedInPerson } from '../../../support/acting.ts'
import { chainOf, withBlueprints } from '../../../support/blueprints.ts'
import { findPage } from '../../../support/pages.ts'
import { OPERATOR } from '../../../support/people.ts'

/** A page's values saved as a blueprint (story 358), as "Create Document Blueprint" saves one. */
export default class ContentBlueprintNew extends BaseCommand {
  static override summary = "save a page's values as a blueprint of its type"
  static override description = [
    "A blueprint is a page's values saved as a starting point for new pages of its type: `content new --blueprint` starts a page from one, as the back office offers one when a page is made.",
    'It keeps the values the page has now, its draft included, and the names it has in its other languages. Its name is the one given, unique among the blueprints of its type.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content blueprint new "Landing page" --from /About',
  ]
  static override args = {
    name: Args.string({ required: true, description: "the blueprint's name" }),
  }
  static override flags = {
    from: Flags.string({
      required: true,
      summary: 'the page whose values it keeps, by path or key',
      helpValue: '<page>',
    }),
  }
  static override audit = {
    category: 'content',
    action: 'Create',
    entityType: 'DocumentBlueprint',
  } as const
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'type', type: 'string', description: "its type's alias" },
      { name: 'from', type: 'string', description: "the page's path" },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'usage', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentBlueprintNew)
    const name = args.name.trim()
    if (!name) throw new CliError('usage', 'Give the blueprint a name.')
    return withBlueprints(async ({ site, port }) => {
      const page = await findPage(site, flags.from)
      const person = signedInPerson()
      if (person) {
        const { chain, trashed } = await chainOf(site, page.doc.key)
        if (!mayAt(person, [DocumentPermissions.Create], chain, trashed))
          throw new CliError('refused', 'You may not make a blueprint from this page.')
      }
      const taken = (await port.forContentType(page.type.key, { skip: 0, take: 100_000 })).items
      if (taken.some((b) => b.name === name))
        throw new CliError(
          'refused',
          `Nothing was made: "${page.type.name}" already has a blueprint called "${name}".`,
          {
            hint: `\`crombolo content blueprint remove "${name}" --type ${page.type.alias}\` frees the name.`,
          },
        )
      const key = crypto.randomUUID()
      const made = await port.fromDocument(
        page.doc.key,
        { key, name, parentKey: null },
        person ?? OPERATOR,
      )
      if (!made.ok) throw new CliError('refused', `Nothing was made: ${made.reason}`)
      this.auditKey = made.key
      this.say(`Saved "${page.path}" as the blueprint "${name}" (${page.type.alias})`)
      return { key: made.key, name, type: page.type.alias, from: page.path, changed: true }
    })
  }
}

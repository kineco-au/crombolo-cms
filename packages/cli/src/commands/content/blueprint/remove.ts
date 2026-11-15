import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { findBlueprint, withBlueprints } from '../../../support/blueprints.ts'
import { confirm } from '../../../support/prompt.ts'

/** A blueprint deleted (story 358), as Settings deletes one: for good, since blueprints have no recycle bin. */
export default class ContentBlueprintRemove extends BaseCommand {
  static override summary = 'delete a blueprint, for good'
  static override description = [
    "A blueprint is a page's values saved as a starting point for new pages of its type. Pages already started from it keep their values.",
    "It is named by its name or its key; --type says which type's, when two types have one of that name. Asks first, unless --yes.",
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content blueprint remove "Landing page" --type contentPage --yes',
  ]
  static override args = {
    name: Args.string({ required: true, description: "the blueprint's name or key" }),
  }
  static override flags = {
    type: Flags.string({ summary: 'the page type it is for', helpValue: '<type>' }),
    yes: Flags.boolean({ summary: "don't ask" }),
  }
  static override audit = {
    category: 'content',
    action: 'Delete',
    entityType: 'DocumentBlueprint',
  } as const
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--yes',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'refused', 'confirmation_required'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentBlueprintRemove)
    return withBlueprints(async ({ site, port }) => {
      let typeKey: string | undefined
      if (flags.type !== undefined) {
        const type = await site.lookup.typeOf('document', flags.type)
        if (!type || type.isElement)
          throw new CliError('not_found', `The site has no page type called "${flags.type}".`, {
            hint: '`crombolo types list --kind content` lists them.',
          })
        typeKey = type.key
      }
      const blueprint = await findBlueprint(port, args.name, typeKey)
      if (!flags.yes)
        await confirm(`  Delete the blueprint "${blueprint.name}", for good? [y/N]`, {
          bypass: '--yes',
        })
      if (!(await port.remove(blueprint.key)))
        throw new CliError('not_found', `There is no blueprint called "${args.name}".`)
      this.auditKey = blueprint.key
      this.say(`  deleted  the blueprint "${blueprint.name}"`)
      return { key: blueprint.key, name: blueprint.name, changed: true }
    })
  }
}

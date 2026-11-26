import { bootstrapDatabase, linkMembersByProperty } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { siteConfig } from '../../support/site.ts'

/** Members here linked to an identity provider from a property they hold (story 432). */
export default class MembersLink extends BaseCommand {
  static override summary = 'link members to an identity provider by an id they hold'
  static override description =
    "Links every member whose property holds an id, and who has no link to the provider yet, so their first sign-in there finds them: an id an Umbraco site kept, such as B2C's aDObjectID, after an import. Run it again as often as needed. An id another member holds is refused, naming both. A provider this site does not declare is linked anyway, and said. Run where the site's database is."
  static override examples = [
    '<%= config.bin %> members link --provider b2c --property aDObjectID --dry-run',
    '<%= config.bin %> members link --provider b2c --property aDObjectID',
  ]
  static override flags = {
    provider: Flags.string({
      summary: "the member identity provider's id in crombolo.config.ts",
      helpValue: '<id>',
      required: true,
    }),
    property: Flags.string({
      summary: 'the member property holding their id there',
      helpValue: '<alias>',
      required: true,
    }),
    'dry-run': Flags.boolean({ summary: 'say what it would link, and write nothing' }),
  }
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'linked', type: 'number' },
      { name: 'already', type: 'number' },
      { name: 'empty', type: 'number' },
      { name: 'held', type: 'array', items: { type: 'object' } },
      { name: 'declared', type: 'boolean' },
    ],
    errors: ['refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { flags } = await this.parse(MembersLink)
    const config = await siteConfig()
    const { db } = await bootstrapDatabase(config)
    try {
      const outcome = await linkMembersByProperty(db, {
        provider: flags.provider,
        property: flags.property,
        declared: config.memberIdentityProviders.map((provider) => provider.oidc.id),
        source: 'cli',
        dryRun: flags['dry-run'],
      })
      if (!outcome.declared)
        this.say(
          `  warning  this site declares no member provider "${flags.provider}": the links are kept, and used once it does`,
        )
      for (const held of outcome.held)
        this.say(
          `  refused  ${held.member}: its ${flags.property} is the ${flags.provider} id of ${held.heldBy} already`,
        )
      this.say(
        `  ${flags['dry-run'] ? 'would link' : 'linked'} ${outcome.linked}, ${outcome.already} linked already, ${outcome.empty} with no ${flags.property}, ${outcome.held.length} refused`,
      )
      if (flags['dry-run'] || outcome.linked === 0) this.changedNothing = true
      return outcome
    } catch (error) {
      throw error instanceof CliError ? error : new CliError('unavailable', String(error))
    } finally {
      await db.close()
    }
  }
}
